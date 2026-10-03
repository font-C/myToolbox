/**
 * 排课方案全局状态（Pinia）。
 * project 即数据模型（见 solver/model.js 的 emptyProject），课表结果内嵌于 project.schedule。
 */
import { defineStore } from 'pinia'
import {
  emptyProject,
  DEFAULT_RULES,
  slotCount,
  slotsPerDay,
  uid,
  validateProblem,
  unitCountOf,
  unitSizeOf,
  assignmentLabel,
} from './solver/model.js'
import { solve } from './solver/solve.js'
import {
  canPlaceUnit,
  buildSlotMaps,
  moveUnit as solverMove,
  swapUnits as solverSwap,
  forceSwapUnits as solverSwapForce,
  removeUnit as solverRemove,
  missingPeriodsOf,
  checkScheduleIntegrity,
} from './solver/manual.js'
import { loadSampleProject } from './sample.js'
import { storageLoad, storageSaveDebounced } from './io.js'

export const usePlannerStore = defineStore('planner', {
  state: () => ({
    project: emptyProject(),
    /** 最近一次自动排课结果报告 */
    lastResult: null,
    /** 轻提示（toast） */
    toast: null,
    _toastTimer: null,
    /** 确认框（Promise 风格） */
    confirmBox: null,
    _confirmResolve: null,
    /** 宿主存储恢复完成后才允许写入，防止恢复过程中的旧数据覆盖 */
    _hydrated: false,
  }),

  getters: {
    ppd: (s) => slotsPerDay(s.project),
    nSlots: (s) => slotCount(s.project),
    integrityIssues: (s) => checkScheduleIntegrity(s.project),
    /** 未排满的任务（含完全未排） */
    incompleteAssignments(state) {
      return state.project.assignments
        .map((a) => ({ a, missing: missingPeriodsOf(state.project, a) }))
        .filter((x) => x.missing > 0)
    },
    problemErrors: (s) => validateProblem(s.project),
  },

  actions: {
    notify(text, kind = 'info') {
      this.toast = { text, kind, at: Date.now() }
      clearTimeout(this._toastTimer)
      this._toastTimer = setTimeout(() => (this.toast = null), 2600)
    },

    /** Promise 风格确认框：await store.confirm('确定清空？') */
    confirm(text, { danger = false, okText = '确定', cancelText = '取消' } = {}) {
      this.confirmBox = { text, danger, okText, cancelText }
      return new Promise((resolve) => {
        this._confirmResolve?.(false)
        this._confirmResolve = resolve
      })
    },
    resolveConfirm(ok) {
      this.confirmBox = null
      this._confirmResolve?.(ok)
      this._confirmResolve = null
    },

    persist() {
      if (!this._hydrated) return
      storageSaveDebounced(this.project)
    },

    /** 从宿主存储恢复上次方案（应用重启后数据仍在）。 */
    async restoreSession() {
      try {
        const saved = await storageLoad()
        if (saved) this.project = saved
      } finally {
        this._hydrated = true
      }
    },

    // ---- 时间结构 ----
    applyTimegrid(days, periods, { keepSchedule = false } = {}) {
      this.project.days = days
      this.project.periods = periods
      if (!keepSchedule) this.clearSchedule()
      this.persist()
    },

    // ---- 班级 / 年级 ----
    addGrade(name) {
      const g = { id: uid('g'), name }
      this.project.grades.push(g)
      this.persist()
      return g
    },
    removeGrade(gradeId) {
      const classIds = this.project.classes.filter((c) => c.gradeId === gradeId).map((c) => c.id)
      for (const cid of classIds) this.removeClass(cid)
      this.project.grades = this.project.grades.filter((g) => g.id !== gradeId)
      this.persist()
    },
    addClass(name, gradeId) {
      const c = { id: uid('c'), name, gradeId: gradeId ?? null }
      this.project.classes.push(c)
      this.persist()
      return c
    },
    /** 批量生成班级（names 为已排好序的名称），仅持久化一次 */
    bulkAddClasses(names, gradeId) {
      const created = names.map((name) => ({ id: uid('c'), name, gradeId: gradeId ?? null }))
      this.project.classes.push(...created)
      this.persist()
      return created
    },
    updateClass(id, patch) {
      const c = this.project.classes.find((x) => x.id === id)
      if (c) Object.assign(c, patch)
      this.persist()
    },
    removeClass(classId) {
      const affected = this.project.assignments.filter((a) => a.classId === classId)
      for (const a of affected) this.removeAssignment(a.id)
      delete this.project.classBlocked[classId]
      this.project.classes = this.project.classes.filter((c) => c.id !== classId)
      this.persist()
    },
    toggleClassBlocked(classId, slot) {
      const list = (this.project.classBlocked[classId] ??= [])
      const i = list.indexOf(slot)
      if (i === -1) list.push(slot)
      else list.splice(i, 1)
      // 已排在该时段的单元自动移出（变为未排）
      if (i === -1) this.evictUnitsAt(null, classId, slot)
      this.persist()
    },

    // ---- 教师 ----
    addTeacher(name) {
      const t = { id: uid('t'), name, unavailable: [] }
      this.project.teachers.push(t)
      this.persist()
      return t
    },
    updateTeacher(id, patch) {
      const t = this.project.teachers.find((x) => x.id === id)
      if (t) Object.assign(t, patch)
      this.persist()
    },
    removeTeacher(teacherId) {
      const affected = this.project.assignments.filter((a) => a.teacherId === teacherId)
      for (const a of affected) this.removeAssignment(a.id)
      this.project.teachers = this.project.teachers.filter((t) => t.id !== teacherId)
      this.persist()
    },
    toggleTeacherUnavailable(teacherId, slot) {
      const t = this.project.teachers.find((x) => x.id === teacherId)
      if (!t) return
      const i = (t.unavailable ??= []).indexOf(slot)
      if (i === -1) {
        t.unavailable.push(slot)
        // 该教师排在此时段的单元自动移出
        this.evictUnitsAt(teacherId, null, slot)
      } else {
        t.unavailable.splice(i, 1)
      }
      this.persist()
    },

    // ---- 科目 ----
    addSubject(name, props = {}) {
      const s = { id: uid('s'), name, gradeId: null, roomShared: false, isMajor: false, isPe: false, double: false, weekly: 2, ...props }
      this.project.subjects.push(s)
      this.persist()
      return s
    },
    updateSubject(id, patch) {
      const s = this.project.subjects.find((x) => x.id === id)
      if (!s) return
      Object.assign(s, patch)
      // 周课时变化后：先同步该科目所有任务的 periods，再移出超出新课时数的多余单元
      if (patch.weekly !== undefined) {
        for (const a of this.project.assignments) {
          if (a.subjectId === id) a.periods = s.weekly
        }
        for (const a of this.project.assignments) {
          if (a.subjectId !== id) continue
          const need = unitCountOf(a, s)
          const slots = this.project.schedule[a.id]
          if (slots && slots.length > need) {
            slots.splice(need)
            this.notify(`「${s.name}」课时调整，部分已排单元已移出`)
          }
        }
      }
      this.persist()
    },
    removeSubject(subjectId) {
      const affected = this.project.assignments.filter((a) => a.subjectId === subjectId)
      for (const a of affected) this.removeAssignment(a.id)
      this.project.subjects = this.project.subjects.filter((s) => s.id !== subjectId)
      this.persist()
    },

    // ---- 教学任务 ----
    addAssignment(classId, subjectId, teacherId, periods) {
      const subj = this.project.subjects.find((s) => s.id === subjectId)
      const a = {
        id: uid('a'),
        classId,
        subjectId,
        teacherId,
        periods: periods ?? subj?.weekly ?? 1,
      }
      this.project.assignments.push(a)
      this.persist()
      return a
    },
    updateAssignment(id, patch) {
      const a = this.project.assignments.find((x) => x.id === id)
      if (!a) return
      Object.assign(a, patch)
      if (patch.periods !== undefined) {
        const subj = this.project.subjects.find((s) => s.id === a.subjectId)
        const need = unitCountOf(a, subj)
        const slots = this.project.schedule[id]
        if (slots && slots.length > need) slots.splice(need)
      }
      this.persist()
    },
    removeAssignment(assignmentId) {
      delete this.project.schedule[assignmentId]
      this.project.assignments = this.project.assignments.filter((a) => a.id !== assignmentId)
      this.persist()
    },

    /**
     * 按「科目 × 年级」自动生成教学任务的班级+科目组合（只需再配教师）。
     * - 保留仍适用的既有任务（含已配教师）
     * - 补齐缺失的（班级,科目），教师留空待配
     * - 清理不再适用的任务并移出课表
     */
    syncAssignmentsFromSubjects() {
      const p = this.project
      const expect = new Set()
      for (const c of p.classes) {
        for (const s of p.subjects) {
          if (!s.gradeId || s.gradeId === c.gradeId) expect.add(`${c.id}::${s.id}`)
        }
      }
      const key = (a) => `${a.classId}::${a.subjectId}`
      const present = new Set()
      const next = []
      let removed = 0
      for (const a of p.assignments) {
        const k = key(a)
        if (expect.has(k)) {
          next.push(a)
          present.add(k)
        } else {
          delete p.schedule[a.id]
          removed++
        }
      }
      let added = 0
      for (const k of expect) {
        if (present.has(k)) continue
        const [classId, subjectId] = k.split('::')
        const subj = p.subjects.find((s) => s.id === subjectId)
        next.push({ id: uid('a'), classId, subjectId, teacherId: null, periods: subj?.weekly ?? 1 })
        added++
      }
      p.assignments = next
      this.lastResult = null
      this.persist()
      this.notify(`已按科目生成任务：新增 ${added} 条，移除 ${removed} 条`, added || removed ? 'ok' : 'info')
    },

    // ---- 排课规则开关 ----
    toggleRule(key) {
      if (!this.project.rules) this.project.rules = { ...DEFAULT_RULES }
      this.project.rules[key] = !this.project.rules[key]
      this.lastResult = null
      this.persist()
    },

    // ---- 课表操作 ----
    clearSchedule() {
      this.project.schedule = {}
      this.lastResult = null
      this.persist()
    },
    applySolve(quality) {
      const res = solve(this.project, { quality })
      this.project.schedule = res.schedule
      this.lastResult = { ...res, quality, at: Date.now() }
      this.persist()
      if (res.ok) this.notify(`排课完成（质量分 ${res.penalty}，越低越好）`, 'ok')
      else this.notify(res.message, 'warn')
      return res
    },
    doMoveUnit(assignmentId, unitIndex, targetSlot) {
      const res = solverMove(this.project, assignmentId, unitIndex, targetSlot)
      if (res.ok) this.persist()
      return res
    },
    doSwapUnits(aId, aUnit, bId, bUnit) {
      const res = solverSwap(this.project, aId, aUnit, bId, bUnit)
      if (res.ok) this.persist()
      return res
    },
    doSwapUnitsForce(aId, aUnit, bId, bUnit) {
      const res = solverSwapForce(this.project, aId, aUnit, bId, bUnit)
      if (res.ok) this.persist()
      return res
    },
    doRemoveUnit(assignmentId, unitIndex) {
      solverRemove(this.project, assignmentId, unitIndex)
      this.persist()
    },
    /** 放置一个未排单元到 targetSlot */
    doPlaceUnit(assignmentId, targetSlot) {
      const maps = buildSlotMaps(this.project)
      const res = canPlaceUnit(this.project, assignmentId, targetSlot, maps)
      if (!res.ok) return res
      ;(this.project.schedule[assignmentId] ??= []).push(targetSlot)
      this.project.schedule[assignmentId].sort((x, y) => x - y)
      this.persist()
      return { ok: true, reason: '', size: res.size }
    },
    /** 点击未排任务自动寻找空位 */
    autoPlace(assignmentId) {
      for (let slot = 0; slot < this.nSlots; slot++) {
        const res = this.doPlaceUnit(assignmentId, slot)
        if (res.ok) return res
      }
      return { ok: false, reason: '没有满足约束的空位' }
    },
    /** 教师/班级不可用时段变化后，移除冲突的已排单元 */
    evictUnitsAt(teacherId, classId, slot) {
      const removed = []
      for (const a of this.project.assignments) {
        if (teacherId && a.teacherId !== teacherId) continue
        if (classId && a.classId !== classId) continue
        const subj = this.project.subjects.find((s) => s.id === a.subjectId)
        const size = unitSizeOf(subj)
        const slots = this.project.schedule[a.id]
        if (!slots) continue
        for (let i = slots.length - 1; i >= 0; i--) {
          const start = slots[i]
          for (let k = 0; k < size; k++) {
            if (start + k === slot) {
              slots.splice(i, 1)
              removed.push(assignmentLabel(this.project, a))
              break
            }
          }
        }
      }
      if (removed.length) this.notify(`已自动移出 ${removed.length} 个冲突单元`, 'warn')
    },

    // ---- 方案级 ----
    loadSample() {
      this.project = loadSampleProject()
      this.lastResult = null
      this.persist()
      this.notify(`已载入示例数据（${this.project.grades.length} 个年级 ${this.project.classes.length} 个班）`, 'ok')
    },
    newProject() {
      this.project = emptyProject()
      this.lastResult = null
      this.persist()
    },
    replaceProject(p) {
      this.project = p
      this.lastResult = null
      this.persist()
    },
  },
})
