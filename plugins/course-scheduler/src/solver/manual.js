/**
 * 手动调课辅助：基于 project 对象（UI 数据）的占用映射与单元级移动/交换校验。
 * 与求解器共用同一套硬约束语义（H1/H2/H4/H5/H7）。
 * 占用结构：班级×槽位、教师×槽位 两张映射（不同班级不同教师的课可并行于同一槽位）。
 */
import { slotCount, slotsPerDay, unitSizeOf, unitCountOf } from './model.js'

function no(reason) {
  return { ok: false, reason }
}

/**
 * 占用映射：classSlot["classId:slot"] / teacherSlot["teacherId:slot"] -> assignmentId。
 */
export function buildSlotMaps(project) {
  const classSlot = new Map()
  const teacherSlot = new Map()
  for (const [aid, slots] of Object.entries(project.schedule ?? {})) {
    const a = project.assignments.find((x) => x.id === aid)
    if (!a) continue
    const subj = project.subjects.find((s) => s.id === a.subjectId)
    const size = unitSizeOf(subj)
    for (const start of slots) {
      for (let k = 0; k < size; k++) {
        classSlot.set(`${a.classId}:${start + k}`, aid)
        teacherSlot.set(`${a.teacherId}:${start + k}`, aid)
      }
    }
  }
  return { classSlot, teacherSlot }
}

/** 从映射中摘除某单元（占用键删除） */
function stripUnit(maps, a, startSlot, size) {
  for (let k = 0; k < size; k++) {
    maps.classSlot.delete(`${a.classId}:${startSlot + k}`)
    maps.teacherSlot.delete(`${a.teacherId}:${startSlot + k}`)
  }
}

/**
 * 单元能否放到 targetSlot。maps 可传入复用（调用方负责先摘除相关单元）。
 */
export function canPlaceUnit(project, assignmentId, targetSlot, maps, { ignoreSizeCheck = false } = {}) {
  const a = project.assignments.find((x) => x.id === assignmentId)
  if (!a) return no('任务不存在')
  const subj = project.subjects.find((s) => s.id === a.subjectId)
  if (!subj) return no('科目不存在')
  const size = unitSizeOf(subj)
  const ppd = slotsPerDay(project)
  const nSlots = slotCount(project)
  if (!Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot >= nSlots) {
    return no('目标位置超出课表')
  }
  const p = targetSlot % ppd // 当天节次下标
  if (!ignoreSizeCheck) {
    if (p + size > ppd) return no('当天剩余节次不足')
    if (size === 2 && project.periods[p].session !== project.periods[p + 1].session) {
      return no('连堂需同半天内相邻两节')
    }
  }
  maps ??= buildSlotMaps(project)
  const teacherUnavailable = new Set(
    project.teachers.find((t) => t.id === a.teacherId)?.unavailable ?? []
  )
  const classBlocked = new Set(project.classBlocked[a.classId] ?? [])
  for (let k = 0; k < size; k++) {
    const s = targetSlot + k
    if (maps.classSlot.has(`${a.classId}:${s}`)) return no('班级该时段已有课程')
    if (maps.teacherSlot.has(`${a.teacherId}:${s}`)) return no('教师该时段已有课')
    if (classBlocked.has(s)) return no('班级该时段不可用')
    if (teacherUnavailable.has(s)) return no('教师该时段不可用')
  }
  return { ok: true, reason: '', size }
}

/** 移动单元到 targetSlot（成功则原地修改 schedule） */
export function moveUnit(project, assignmentId, unitIndex, targetSlot) {
  const a = project.assignments.find((x) => x.id === assignmentId)
  if (!a) return no('任务不存在')
  const arr = project.schedule[assignmentId] ?? []
  const cur = arr[unitIndex]
  const maps = buildSlotMaps(project)
  const subj = project.subjects.find((s) => s.id === a.subjectId)
  const size = unitSizeOf(subj)
  if (cur !== undefined) stripUnit(maps, a, cur, size)
  const check = canPlaceUnit(project, assignmentId, targetSlot, maps)
  if (!check.ok) return check
  arr[unitIndex] = targetSlot
  arr.sort((x, y) => x - y)
  return { ok: true, reason: '' }
}

/** 交换两个单元（需单元节数相同）；成功则原地修改 schedule */
export function swapUnits(project, aId, aUnit, bId, bUnit) {
  const a = project.assignments.find((x) => x.id === aId)
  const b = project.assignments.find((x) => x.id === bId)
  if (!a || !b) return no('任务不存在')
  const subjA = project.subjects.find((s) => s.id === a.subjectId)
  const subjB = project.subjects.find((s) => s.id === b.subjectId)
  const sizeA = unitSizeOf(subjA)
  const sizeB = unitSizeOf(subjB)
  if (sizeA !== sizeB) return no('连堂与单节课程无法直接互换')

  const arrA = project.schedule[aId] ?? []
  const arrB = project.schedule[bId] ?? []
  const slotA = arrA[aUnit]
  const slotB = arrB[bUnit]
  if (slotA === undefined || slotB === undefined) return no('单元不存在')

  const maps = buildSlotMaps(project)
  stripUnit(maps, a, slotA, sizeA)
  stripUnit(maps, b, slotB, sizeB)
  const checkA = canPlaceUnit(project, aId, slotB, maps)
  const checkB = checkA.ok ? canPlaceUnit(project, bId, slotA, maps) : null
  if (!checkA.ok || !checkB.ok) return checkA.ok ? checkB : checkA

  const sorted = (xs) => [...xs].sort((x, y) => x - y)
  project.schedule[aId] = sorted(arrA.map((v, i) => (i === aUnit ? slotB : v)))
  project.schedule[bId] = sorted(arrB.map((v, i) => (i === bUnit ? slotA : v)))
  return { ok: true, reason: '' }
}

/** 从课表移除单元（变为未排） */
export function removeUnit(project, assignmentId, unitIndex) {
  const arr = project.schedule[assignmentId]
  if (arr && unitIndex >= 0 && unitIndex < arr.length) arr.splice(unitIndex, 1)
}

/** 任务已排节数（schedule 中单元数 × 单元节数） */
export function placedPeriodsOf(project, assignment) {
  const subj = project.subjects.find((s) => s.id === assignment.subjectId)
  const size = unitSizeOf(subj)
  return (project.schedule[assignment.id]?.length ?? 0) * size
}

/** 任务缺失的节数（应排 - 已排） */
export function missingPeriodsOf(project, assignment) {
  const subj = project.subjects.find((s) => s.id === assignment.subjectId)
  const need = unitCountOf(assignment, subj) * unitSizeOf(subj)
  return need - placedPeriodsOf(project, assignment)
}

/**
 * 全课表硬约束完整性检查（H1/H2/H4/H5/H7），返回问题列表。
 * 手动操作本身已被拦截，此函数用于防御与文件导入后的校验。
 */
export function checkScheduleIntegrity(project) {
  const issues = []
  const ppd = slotsPerDay(project)
  for (const [aid, slots] of Object.entries(project.schedule ?? {})) {
    const a = project.assignments.find((x) => x.id === aid)
    if (!a) continue
    const subj = project.subjects.find((s) => s.id === a.subjectId)
    const size = unitSizeOf(subj)
    const teacherUnavailable = new Set(
      project.teachers.find((t) => t.id === a.teacherId)?.unavailable ?? []
    )
    const classBlocked = new Set(project.classBlocked[a.classId] ?? [])
    for (const start of slots) {
      if (!Number.isInteger(start) || start < 0) {
        issues.push(`任务 ${aid} 存在非法槽位 ${start}`)
        continue
      }
      const p = start % ppd
      if (p + size > ppd) issues.push(`任务 ${aid} 单元跨天边界（槽 ${start}）`)
      else if (size === 2 && project.periods[p].session !== project.periods[p + 1].session) {
        issues.push(`任务 ${aid} 连堂跨越上下午（槽 ${start}）`)
      }
      for (let k = 0; k < size; k++) {
        const s = start + k
        if (classBlocked.has(s)) issues.push(`任务 ${aid} 排在班级不可用时段 ${s}`)
        if (teacherUnavailable.has(s)) issues.push(`任务 ${aid} 排在教师不可用时段 ${s}`)
      }
    }
  }
  // H1/H2：重建占用表查冲突
  const classSlot = new Map()
  const teacherSlot = new Map()
  for (const [aid, slots] of Object.entries(project.schedule ?? {})) {
    const a = project.assignments.find((x) => x.id === aid)
    if (!a) continue
    const subj = project.subjects.find((s) => s.id === a.subjectId)
    const size = unitSizeOf(subj)
    for (const start of slots) {
      for (let k = 0; k < size; k++) {
        const s = start + k
        const ck = `${a.classId}:${s}`
        if (classSlot.has(ck)) issues.push(`班级在槽位 ${s} 冲突（${classSlot.get(ck)} / ${aid}）`)
        else classSlot.set(ck, aid)
        const tk = `${a.teacherId}:${s}`
        if (teacherSlot.has(tk)) issues.push(`教师在槽位 ${s} 冲突（${teacherSlot.get(tk)} / ${aid}）`)
        else teacherSlot.set(tk, aid)
      }
    }
  }
  return issues
}
