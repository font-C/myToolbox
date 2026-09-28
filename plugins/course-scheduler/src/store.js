/**
 * 排课方案全局状态（Pinia）。
 * project 即数据模型（见 solver/model.js 的 emptyProject），课表结果内嵌于 project.schedule。
 */
import { defineStore } from 'pinia'
import {
  emptyProject,
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
  removeUnit as solverRemove,
  missingPeriodsOf,
  checkScheduleIntegrity,
} from './solver/manual.js'
import { loadSampleProject } from './sample.js'
import { sessionLoad, sessionSave } from './io.js'

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
    confirm(text, { danger = false } = {}) {
      this.confirmBox = { text, danger }
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
      sessionSave(this.project)
    },

    restoreSession() {
      const saved = sessionLoad()
      if (saved) this.project = saved
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
      const s = { id: uid('s'), name, isMajor: false, isPe: false, double: false, weekly: 2, ...props }
      this.project.subjects.push(s)
      this.persist()
      return s
    },
    updateSubject(id, patch) {
      const s = this.project.subjects.find((x) => x.id === id)
      if (!s) return
      Object.assign(s, patch)
      // 周课时变化后，已排单元若超出新课时数，移出多余单元
      if (patch.weekly !== undefined) {
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
      this.notify('已载入示例数据（初一 4 个班）', 'ok')
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
