/**
 * 约束系统：硬约束检查（H1–H7）+ 软约束罚分（S1–S7，越小越好）。
 *
 * 求解器内部用整数下标 + 增量统计（Sched 状态）提速；
 * 对外另提供基于 project 对象的 UI 辅助函数（手动拖拽的校验/移动/交换）。
 */
import { slotCount, slotsPerDay, unitSizeOf, unitCountOf } from './model.js'

// 软约束权重（罚分，负值 = 奖励）
export const W = {
  majorGold: -1.5, // S1 主科落入上午前两节
  majorPm: 1.0, // S1 主科排到下午
  minorGold: 0.8, // S1 副科占用黄金时段
  minorPm: -0.5, // S1 副科在下午
  peBadSlot: 4.0, // S4 体育排在上午末节/下午首节
  peGold: 0.5, // S4 体育挤占黄金时段
  sameDayRepeat: 2.0, // S2 同科目同班一天出现多个单元
  dayDeviation: 0.6, // S7 班级每天节数偏离均值
  adjacentDay: 0.8, // S3 同科目相邻两天连续出现
  teacherLoadDev: 0.25, // S5 教师日课量偏离均值
  teacherGap: 0.5, // S6 教师夹心空堂
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export { mulberry32 }

/**
 * 构建求解问题快照（纯整数下标，与 UI 数据解耦）。
 */
export function buildProblem(project) {
  const nSlots = slotCount(project)
  const ppd = slotsPerDay(project)
  const nDays = project.days.length

  const classIdx = new Map(project.classes.map((c, i) => [c.id, i]))
  const teacherIdx = new Map(project.teachers.map((t, i) => [t.id, i]))
  const subjIdx = new Map(project.subjects.map((s, i) => [s.id, i]))

  // 教师不可用 / 班级不可用位矩阵（H4 / H5）
  const teacherBlocked = new Int8Array(project.teachers.length * nSlots)
  const teacherBlockedCount = new Int32Array(project.teachers.length)
  project.teachers.forEach((t, ti) => {
    for (const s of t.unavailable ?? []) {
      if (s >= 0 && s < nSlots) {
        teacherBlocked[ti * nSlots + s] = 1
        teacherBlockedCount[ti]++
      }
    }
  })
  const classBlocked = new Int8Array(project.classes.length * nSlots)
  project.classes.forEach((c, ci) => {
    for (const s of project.classBlocked[c.id] ?? []) {
      if (s >= 0 && s < nSlots) classBlocked[ci * nSlots + s] = 1
    }
  })

  // 任务展开为排课单元（连堂科目每单元 2 节）
  const units = []
  project.assignments.forEach((a, ai) => {
    const subj = project.subjects.find((s) => s.id === a.subjectId)
    if (!subj || !classIdx.has(a.classId) || !teacherIdx.has(a.teacherId)) return
    const size = unitSizeOf(subj)
    const n = unitCountOf(a, subj)
    for (let k = 0; k < n; k++) units.push({ asg: ai, size })
  })
  const nUnits = units.length

  const unitAsg = new Int32Array(nUnits)
  const unitSize = new Int32Array(nUnits)
  const nA = project.assignments.length
  const asgClass = new Int32Array(nA).fill(-1)
  const asgTeacher = new Int32Array(nA).fill(-1)
  const asgSubject = new Int32Array(nA).fill(-1)
  const asgMajor = new Int8Array(nA)
  const asgPe = new Int8Array(nA)
  const asgWeekly = new Int32Array(nA)
  project.assignments.forEach((a, ai) => {
    asgClass[ai] = classIdx.get(a.classId) ?? -1
    asgTeacher[ai] = teacherIdx.get(a.teacherId) ?? -1
    asgSubject[ai] = subjIdx.get(a.subjectId) ?? -1
    const subj = project.subjects.find((s) => s.id === a.subjectId)
    asgMajor[ai] = subj?.isMajor ? 1 : 0
    asgPe[ai] = subj?.isPe ? 1 : 0
    asgWeekly[ai] = a.periods ?? 0
  })
  units.forEach((u, i) => {
    unitAsg[i] = u.asg
    unitSize[i] = u.size
  })

  // 节次属性（按绝对槽位展开）：上/下午、上午末节、下午首节、黄金时段（上午前两节）
  const periodAm = new Int8Array(nSlots)
  for (let s = 0; s < nSlots; s++) {
    periodAm[s] = project.periods[s % ppd].session === 'am' ? 1 : 0
  }
  let lastAm = -1
  let firstPm = -1
  for (let i = 0; i < ppd; i++) {
    if (periodAm[i]) lastAm = i
    else if (firstPm === -1) firstPm = i
  }
  const goldEnd = Math.min(2, lastAm + 1)

  // 同科目全周单元数（超过天数时相邻日分布不可避免，S3 不计该科目）
  const subjWeeklyUnits = new Map()
  project.assignments.forEach((a) => {
    const si = subjIdx.get(a.subjectId) ?? -1
    const subj = project.subjects.find((s) => s.id === a.subjectId)
    if (si >= 0 && subj) {
      subjWeeklyUnits.set(si, (subjWeeklyUnits.get(si) ?? 0) + unitCountOf(a, subj))
    }
  })

  // 槽位 -> (day, period)
  const slotDayArr = new Int32Array(nSlots)
  const slotPeriodArr = new Int32Array(nSlots)
  for (let s = 0; s < nSlots; s++) {
    slotDayArr[s] = Math.floor(s / ppd)
    slotPeriodArr[s] = s % ppd
  }

  // 班级周总节数 / 教师周总节数（S5、S7 均值基准）
  const classAvgPeriods = new Float64Array(project.classes.length)
  project.assignments.forEach((a) => {
    const ci = classIdx.get(a.classId)
    if (ci >= 0) classAvgPeriods[ci] += a.periods ?? 0
  })
  for (let ci = 0; ci < project.classes.length; ci++) classAvgPeriods[ci] /= nDays
  const teacherAvgPeriods = new Float64Array(project.teachers.length)
  project.assignments.forEach((a) => {
    const ti = teacherIdx.get(a.teacherId)
    if (ti >= 0) teacherAvgPeriods[ti] += a.periods ?? 0
  })
  for (let ti = 0; ti < project.teachers.length; ti++) teacherAvgPeriods[ti] /= nDays

  return {
    nSlots,
    ppd,
    nDays,
    nClasses: project.classes.length,
    nTeachers: project.teachers.length,
    nSubjects: project.subjects.length,
    teacherBlocked,
    teacherBlockedCount,
    classBlocked,
    nUnits,
    unitAsg,
    unitSize,
    asgClass,
    asgTeacher,
    asgSubject,
    asgMajor,
    asgPe,
    asgWeekly,
    periodAm,
    lastAm,
    firstPm,
    goldEnd,
    subjWeeklyUnits,
    slotDay: slotDayArr,
    slotPeriod: slotPeriodArr,
    classAvgPeriods,
    teacherAvgPeriods,
  }
}

/**
 * 排课状态：班级×槽位 与 教师×槽位 两张占用矩阵（不同班级不同教师的课可并行于同一槽位）
 * + 增量统计（罚分聚合直接读这些统计，无需重扫全部槽位）。
 */
export class Sched {
  constructor(pb) {
    this.pb = pb
    this.classSlot = new Int32Array(pb.nClasses * pb.nSlots).fill(-1) // (class,slot) -> unit
    this.teacherSlot = new Int32Array(pb.nTeachers * pb.nSlots).fill(-1) // (teacher,slot) -> unit
    this.unitSlot = new Int32Array(pb.nUnits).fill(-1) // unit -> 首槽
    // 班级-日：节数（连堂记 2）；班级-日-科目：单元数；教师-日：节数与占用位掩码
    this.cdPeriods = new Float64Array(pb.nClasses * pb.nDays)
    this.cdSubjUnits = new Float64Array(pb.nClasses * pb.nDays * pb.nSubjects)
    this.tdLoad = new Float64Array(pb.nTeachers * pb.nDays)
    this.tdMask = new Int32Array(pb.nTeachers * pb.nDays)
    this.unplaced = []
  }

  fits(u, slot) {
    const pb = this.pb
    const size = pb.unitSize[u]
    if (slot + size > pb.nSlots) return false
    const a = pb.unitAsg[u]
    const c = pb.asgClass[a]
    const t = pb.asgTeacher[a]
    for (let k = 0; k < size; k++) {
      const s = slot + k
      // H7 连堂需相邻且同半天
      if (pb.periodAm[s] !== pb.periodAm[slot]) return false
      // H1 该班此槽位空闲
      if (this.classSlot[c * pb.nSlots + s] !== -1) return false
      // H2 该教师此槽位空闲（不同教师的课可并行）
      if (this.teacherSlot[t * pb.nSlots + s] !== -1) return false
      // H5 班级不可用时段；H4 教师不可用时段
      if (pb.classBlocked[c * pb.nSlots + s]) return false
      if (pb.teacherBlocked[t * pb.nSlots + s]) return false
    }
    return true
  }

  place(u, slot) {
    const pb = this.pb
    const a = pb.unitAsg[u]
    const c = pb.asgClass[a]
    const t = pb.asgTeacher[a]
    const subj = pb.asgSubject[a]
    const d = pb.slotDay[slot]
    const size = pb.unitSize[u]
    for (let k = 0; k < size; k++) {
      this.classSlot[c * pb.nSlots + slot + k] = u
      this.teacherSlot[t * pb.nSlots + slot + k] = u
    }
    this.unitSlot[u] = slot
    this.cdPeriods[c * pb.nDays + d] += size
    this.cdSubjUnits[(c * pb.nDays + d) * pb.nSubjects + subj] += 1
    this.tdLoad[t * pb.nDays + d] += size
    this.tdMask[t * pb.nDays + d] |= 1 << pb.slotPeriod[slot]
  }

  remove(u) {
    const pb = this.pb
    const slot = this.unitSlot[u]
    if (slot === -1) return
    const a = pb.unitAsg[u]
    const c = pb.asgClass[a]
    const t = pb.asgTeacher[a]
    const subj = pb.asgSubject[a]
    const d = pb.slotDay[slot]
    const size = pb.unitSize[u]
    for (let k = 0; k < size; k++) {
      this.classSlot[c * pb.nSlots + slot + k] = -1
      this.teacherSlot[t * pb.nSlots + slot + k] = -1
    }
    this.unitSlot[u] = -1
    this.cdPeriods[c * pb.nDays + d] -= size
    this.cdSubjUnits[(c * pb.nDays + d) * pb.nSubjects + subj] -= 1
    this.tdLoad[t * pb.nDays + d] -= size
    this.tdMask[t * pb.nDays + d] &= ~(1 << pb.slotPeriod[slot])
  }

  placedUnits() {
    const out = []
    for (let u = 0; u < this.pb.nUnits; u++) if (this.unitSlot[u] !== -1) out.push(u)
    return out
  }
}

function popcount(x) {
  let n = 0
  while (x) {
    x &= x - 1
    n++
  }
  return n
}

/** 单元的 S1/S4 时段偏好罚分（按首槽节次计） */
export function placementPen(pb, a, p) {
  let pen = 0
  const am = pb.periodAm[p]
  const inGold = am && p < pb.goldEnd
  if (pb.asgMajor[a]) {
    if (inGold) pen += W.majorGold
    else if (!am) pen += W.majorPm
  } else {
    if (inGold) pen += W.minorGold + (pb.asgPe[a] ? W.peGold : 0)
    else if (!am) pen += W.minorPm
  }
  if (pb.asgPe[a] && ((am && p === pb.lastAm) || (!am && p === pb.firstPm))) {
    pen += W.peBadSlot
  }
  return pen
}

/** 全局软约束罚分（越小越好） */
export function fullPenalty(pb, st) {
  const pbL = pb
  let pen = 0
  // S1/S4：逐单元时段偏好
  for (let u = 0; u < pbL.nUnits; u++) {
    const s = st.unitSlot[u]
    if (s !== -1) pen += placementPen(pbL, pbL.unitAsg[u], pbL.slotPeriod[s])
  }
  // S2 / S7：班级-日
  for (let c = 0; c < pbL.nClasses; c++) {
    for (let d = 0; d < pbL.nDays; d++) {
      pen += Math.abs(st.cdPeriods[c * pbL.nDays + d] - pbL.classAvgPeriods[c]) * W.dayDeviation
      const base = (c * pbL.nDays + d) * pbL.nSubjects
      for (let subj = 0; subj < pbL.nSubjects; subj++) {
        const cnt = st.cdSubjUnits[base + subj]
        if (cnt > 1) pen += (cnt - 1) * W.sameDayRepeat
      }
    }
  }
  // S3：同科目相邻日连排（周单元数 ≤ 天数才考核）
  for (let c = 0; c < pbL.nClasses; c++) {
    for (let subj = 0; subj < pbL.nSubjects; subj++) {
      if ((pbL.subjWeeklyUnits.get(subj) ?? 0) > pbL.nDays) continue
      let prev = 0
      for (let d = 0; d < pbL.nDays; d++) {
        const cnt = st.cdSubjUnits[(c * pbL.nDays + d) * pbL.nSubjects + subj]
        if (cnt > 0 && prev > 0) pen += W.adjacentDay
        prev = cnt
      }
    }
  }
  // S5 / S6：教师-日
  for (let t = 0; t < pbL.nTeachers; t++) {
    for (let d = 0; d < pbL.nDays; d++) {
      pen += Math.abs(st.tdLoad[t * pbL.nDays + d] - pbL.teacherAvgPeriods[t]) * W.teacherLoadDev
      const mask = st.tdMask[t * pbL.nDays + d]
      if (mask) {
        const occupied = popcount(mask)
        const lo = Math.log2(mask & -mask) | 0
        const hi = 31 - Math.clz32(mask)
        pen += (hi - lo + 1 - occupied) * W.teacherGap
      }
    }
  }
  return pen
}
