/**
 * 约束系统：硬约束检查（H1–H7）+ 软约束罚分（S1–S7，越小越好）。
 *
 * 求解器内部用整数下标 + 增量统计（Sched 状态）提速；
 * 对外另提供基于 project 对象的 UI 辅助函数（手动拖拽的校验/移动/交换）。
 */
import { slotCount, slotsPerDay, unitSizeOf, unitCountOf, DEFAULT_RULES } from './model.js'

// 软约束权重（罚分，负值 = 奖励）
export const W = {
  majorGold: -1.5, // S1 主科落入 上午1-3节 / 下午1-2节
  majorPm: 1.0, // S1 主科排到 下午3-4节 / 晚上
  minorGold: 0.8, // S1 副科占用黄金时段
  minorPm: -0.5, // S1 副科在其余课时
  minorEve: 1.2, // S8 晚上排副科
  essayGood: -2.0, // S9 作文连堂落于 周三至周五 下午1-2节（连堂占 2 节，需压过主科黄金奖励）
  essayBad: 0.8, // S9 作文连堂未落于优先时段
  peBadSlot: 4.0, // S4 体育排在上午末节/下午首节
  peGold: 0.5, // S4 体育挤占黄金时段
  sameDayRepeat: 2.0, // S2 同科目同班一天多单元（仅计超出结构下限部分）
  sameDaySameSession: 1.0, // S2b 同科目同日多单元集中在同一时段段（应分散上/下午）
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
  const asgShared = new Int8Array(nA)
  const asgEssay = new Int8Array(nA)
  const asgWeekly = new Int32Array(nA)
  project.assignments.forEach((a, ai) => {
    asgClass[ai] = classIdx.get(a.classId) ?? -1
    asgTeacher[ai] = teacherIdx.get(a.teacherId) ?? -1
    asgSubject[ai] = subjIdx.get(a.subjectId) ?? -1
    const subj = project.subjects.find((s) => s.id === a.subjectId)
    asgMajor[ai] = subj?.isMajor ? 1 : 0
    asgPe[ai] = subj?.isPe ? 1 : 0
    asgShared[ai] = subj?.roomShared ? 1 : 0
    asgEssay[ai] = /作文/.test(subj?.name ?? '') ? 1 : 0
    asgWeekly[ai] = a.periods ?? 0
  })
  units.forEach((u, i) => {
    unitAsg[i] = u.asg
    unitSize[i] = u.size
  })

  // 节次属性（按绝对槽位展开）：上/下午、上午末节、下午首节
  const periodAm = new Int8Array(nSlots)
  const slotSession = new Int8Array(nSlots)
  const slotBucket = new Int8Array(nSlots) // 时段段：0=早晨+上午 1=下午 2=晚上（同日分布用）
  for (let s = 0; s < nSlots; s++) {
    const se = project.periods[s % ppd].session
    periodAm[s] = se === 'am' ? 1 : 0
    slotSession[s] = se === 'dawn' ? 0 : se === 'am' ? 1 : se === 'pm' ? 2 : 3
    slotBucket[s] = se === 'pm' ? 1 : se === 'eve' ? 2 : 0
  }
  let lastAm = -1
  let firstPm = -1
  for (let i = 0; i < ppd; i++) {
    if (periodAm[i]) lastAm = i
    else if (firstPm === -1) firstPm = i
  }

  // 黄金时段（按节次下标）：主科可排 上午1-3节 + 下午1-2节；晚上另有标记
  const amIdxList = []
  const pmIdxList = []
  const majorGoldIdx = new Uint8Array(ppd)
  const eveIdx = new Uint8Array(ppd)
  for (let i = 0; i < ppd; i++) {
    const s = project.periods[i].session
    if (s === 'am') amIdxList.push(i)
    else if (s === 'pm') pmIdxList.push(i)
    else if (s === 'eve') eveIdx[i] = 1
  }
  for (let k = 0; k < 3 && k < amIdxList.length; k++) majorGoldIdx[amIdxList[k]] = 1
  for (let k = 0; k < 2 && k < pmIdxList.length; k++) majorGoldIdx[pmIdxList[k]] = 1
  const majorGoldPeriod = (p) => majorGoldIdx[p] === 1

  // 同科目全周单元数（超过天数时相邻日分布不可避免，S3 不计该科目）
  const subjWeeklyUnits = new Map()
  project.assignments.forEach((a) => {
    const si = subjIdx.get(a.subjectId) ?? -1
    const subj = project.subjects.find((s) => s.id === a.subjectId)
    if (si >= 0 && subj) {
      subjWeeklyUnits.set(si, (subjWeeklyUnits.get(si) ?? 0) + unitCountOf(a, subj))
    }
  })

  // 每班每科目周单元数（S2 结构下限用：一周内同科必然同日的次数下限 = max(0, 单元数 - 天数)）
  const subjUnitsByClass = new Int32Array(project.classes.length * project.subjects.length)
  project.assignments.forEach((a) => {
    const ci = classIdx.get(a.classId) ?? -1
    const si = subjIdx.get(a.subjectId) ?? -1
    const subj = project.subjects.find((s) => s.id === a.subjectId)
    if (ci >= 0 && si >= 0 && subj) {
      subjUnitsByClass[ci * project.subjects.length + si] += unitCountOf(a, subj)
    }
  })

  // 作文优先窗口（周三至周五 下午1-2节）：需求 ≤ 窗口容量时作为硬约束，否则退回软约束
  const pmPeriodIdx = [] // pm 节次下标（升序）
  for (let i = 0; i < ppd; i++) {
    if (project.periods[i].session === 'pm') pmPeriodIdx.push(i)
  }
  const essayWindowStart = pmPeriodIdx.length >= 2 ? pmPeriodIdx[0] : -1
  const essayWindowDays = Math.max(0, Math.min(5, nDays) - 2)
  let essayHard = essayWindowStart !== -1
  if (essayHard) {
    const essayUnitsByClass = new Int32Array(project.classes.length)
    project.assignments.forEach((a) => {
      const ci = classIdx.get(a.classId) ?? -1
      const subj = project.subjects.find((s) => s.id === a.subjectId)
      if (ci >= 0 && subj && /作文/.test(subj.name)) {
        essayUnitsByClass[ci] += unitCountOf(a, subj)
      }
    })
    for (const n of essayUnitsByClass) {
      if (n > essayWindowDays) {
        essayHard = false
        break
      }
    }
  }

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
    rules: project.rules ? { ...DEFAULT_RULES, ...project.rules } : { ...DEFAULT_RULES },
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
    asgShared,
    asgEssay,
    asgWeekly,
    periodAm,
    slotSession,
    lastAm,
    firstPm,
    majorGoldIdx,
    eveIdx,
    majorGoldPeriod,
    subjWeeklyUnits,
    subjUnitsByClass,
    essayWindowStart,
    essayHard,
    slotDay: slotDayArr,
    slotPeriod: slotPeriodArr,
    slotBucket,
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
    this.roomOccupied = new Int8Array(pb.nSlots) // 共用教室占用（H8）
    // 班级-日：节数（连堂记 2）；班级-日-科目：单元数；班级-日-科目-时段段：单元数；教师-日：节数与占用位掩码
    this.cdPeriods = new Float64Array(pb.nClasses * pb.nDays)
    this.cdSubjUnits = new Float64Array(pb.nClasses * pb.nDays * pb.nSubjects)
    this.cdSubjBucket = new Float64Array(pb.nClasses * pb.nDays * pb.nSubjects * 3)
    this.tdLoad = new Float64Array(pb.nTeachers * pb.nDays)
    this.tdMask = new Int32Array(pb.nTeachers * pb.nDays)
    this.unplaced = []
    /** 腾挪尝试的撤销日志栈（repair 用）：每层 [{u, prev}]，记录 place/remove 前的槽位 */
    this._jstack = null
  }

  fits(u, slot) {
    const pb = this.pb
    const size = pb.unitSize[u]
    if (slot + size > pb.nSlots) return false
    const a = pb.unitAsg[u]
    const c = pb.asgClass[a]
    const t = pb.asgTeacher[a]
    // 规则：早晨时段不自动排课
    if (pb.rules.skipDawn && pb.slotSession[slot] === 0) return false
    // 规则：体育只排下午
    if (pb.rules.pePmOnly && pb.asgPe[a] && pb.slotSession[slot] !== 2) return false
    // 规则：作文连堂硬窗口（需求 ≤ 容量时启用）——只允许落在周三起「下午1-2节」
    if (
      pb.rules.essayPm &&
      pb.essayHard &&
      pb.asgEssay[a] &&
      !(
        pb.slotDay[slot] >= 2 &&
        pb.slotDay[slot] < Math.min(5, pb.nDays) &&
        pb.slotPeriod[slot] === pb.essayWindowStart
      )
    ) {
      return false
    }
    for (let k = 0; k < size; k++) {
      const s = slot + k
      // H7 连堂需相邻且同半天（同一时段类型，避免 pm+eve 被误判为同半天）
      if (pb.slotSession[s] !== pb.slotSession[slot]) return false
      // H1 该班此槽位空闲
      if (this.classSlot[c * pb.nSlots + s] !== -1) return false
      // H2 该教师此槽位空闲（不同教师的课可并行）
      if (this.teacherSlot[t * pb.nSlots + s] !== -1) return false
      // H5 班级不可用时段；H4 教师不可用时段
      if (pb.classBlocked[c * pb.nSlots + s]) return false
      if (pb.teacherBlocked[t * pb.nSlots + s]) return false
      // H8 共用教室：同一时段全校仅可安排一节符合科目
      if (pb.asgShared[a] && this.roomOccupied[s]) return false
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
    const cdBase = (c * pb.nDays + d) * pb.nSubjects + subj
    const js = this._jstack
    if (js) js[js.length - 1].push({ u, prev: this.unitSlot[u] })
    for (let k = 0; k < size; k++) {
      this.classSlot[c * pb.nSlots + slot + k] = u
      this.teacherSlot[t * pb.nSlots + slot + k] = u
      if (pb.asgShared[a]) this.roomOccupied[slot + k] = 1
    }
    this.unitSlot[u] = slot
    this.cdPeriods[c * pb.nDays + d] += size
    this.cdSubjUnits[cdBase] += 1
    this.cdSubjBucket[cdBase * 3 + pb.slotBucket[slot]] += 1
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
    const cdBase = (c * pb.nDays + d) * pb.nSubjects + subj
    const js = this._jstack
    if (js) js[js.length - 1].push({ u, prev: slot })
    for (let k = 0; k < size; k++) {
      this.classSlot[c * pb.nSlots + slot + k] = -1
      this.teacherSlot[t * pb.nSlots + slot + k] = -1
      if (pb.asgShared[a]) this.roomOccupied[slot + k] = 0
    }
    this.unitSlot[u] = -1
    this.cdPeriods[c * pb.nDays + d] -= size
    this.cdSubjUnits[cdBase] -= 1
    this.cdSubjBucket[cdBase * 3 + pb.slotBucket[slot]] -= 1
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

/** 单元的 S1/S4/S8 时段偏好罚分（按首槽节次计）；按 pb.rules 门控是否启用 */
export function placementPen(pb, a, p) {
  let pen = 0
  const r = pb.rules ?? { majorGold: true, minorPm: true, peAvoid: true }
  const am = pb.periodAm[p]
  const gold = pb.majorGoldIdx[p] === 1
  const eve = pb.eveIdx[p] === 1
  if (pb.asgMajor[a]) {
    if (r.majorGold) {
      if (gold) pen += W.majorGold // 上午1-3节 / 下午1-2节（奖）
      else if (!am) pen += W.majorPm // 下午3-4节 / 晚上（罚）
    }
  } else {
    if (r.minorPm) {
      if (gold) pen += W.minorGold // 副科占用黄金时段（罚）
      else if (!eve) pen += W.minorPm // 副科在其余课时（奖）
    }
    if (r.minorEve && eve) pen += W.minorEve // 晚上排副科（罚）
    if (r.peAvoid && pb.asgPe[a] && gold) pen += W.peGold
  }
  if (r.peAvoid && pb.asgPe[a] && ((am && p === pb.lastAm) || (!am && p === pb.firstPm))) {
    pen += W.peBadSlot
  }
  return pen
}

/** 全局软约束罚分（越小越好） */
export function fullPenalty(pb, st) {
  const pbL = pb
  let pen = 0
  // S1/S4/S8：逐单元时段偏好
  for (let u = 0; u < pbL.nUnits; u++) {
    const s = st.unitSlot[u]
    if (s !== -1) pen += placementPen(pbL, pbL.unitAsg[u], pbL.slotPeriod[s])
  }
  // S9：作文（连堂）优先 周三至周五 下午第1-2节（按首槽所在日/节计算）
  if (pbL.rules?.essayPm) {
    for (let u = 0; u < pbL.nUnits; u++) {
      const s = st.unitSlot[u]
      if (s === -1) continue
      const a = pbL.unitAsg[u]
      if (!pbL.asgEssay[a]) continue
      const d = pbL.slotDay[s]
      const p = pbL.slotPeriod[s]
      const inPm12 = !pbL.periodAm[p] && pbL.majorGoldIdx[p] === 1
      if (inPm12 && d >= 2 && d < Math.min(5, pbL.nDays)) pen += W.essayGood
      else pen += W.essayBad
    }
  }
  // S2 / S2b / S7：班级-日
  for (let c = 0; c < pbL.nClasses; c++) {
    for (let d = 0; d < pbL.nDays; d++) {
      pen += Math.abs(st.cdPeriods[c * pbL.nDays + d] - pbL.classAvgPeriods[c]) * W.dayDeviation
      const base = (c * pbL.nDays + d) * pbL.nSubjects
      for (let subj = 0; subj < pbL.nSubjects; subj++) {
        const cnt = st.cdSubjUnits[base + subj]
        if (cnt < 2) continue
        // S2b：同日多单元全部落在同一时段段（早晨+上午 / 下午 / 晚上）→ 罚
        const b0 = st.cdSubjBucket[(base + subj) * 3]
        const b1 = st.cdSubjBucket[(base + subj) * 3 + 1]
        const b2 = st.cdSubjBucket[(base + subj) * 3 + 2]
        if (b0 === cnt || b1 === cnt || b2 === cnt) pen += W.sameDaySameSession
      }
    }
  }
  // S2：同科目同日多单元，仅计超出结构下限（max(0, 周单元数 - 天数)）的部分
  for (let c = 0; c < pbL.nClasses; c++) {
    for (let subj = 0; subj < pbL.nSubjects; subj++) {
      const weekly = pbL.subjUnitsByClass[c * pbL.nSubjects + subj]
      if (!weekly) continue
      const floor = Math.max(0, weekly - pbL.nDays)
      if (!floor) {
        // 无结构性压力：任何同日多单元都计罚
        for (let d = 0; d < pbL.nDays; d++) {
          const cnt = st.cdSubjUnits[(c * pbL.nDays + d) * pbL.nSubjects + subj]
          if (cnt > 1) pen += (cnt - 1) * W.sameDayRepeat
        }
        continue
      }
      let excess = 0
      for (let d = 0; d < pbL.nDays; d++) {
        const cnt = st.cdSubjUnits[(c * pbL.nDays + d) * pbL.nSubjects + subj]
        if (cnt > 1) excess += cnt - 1
      }
      if (excess > floor) pen += (excess - floor) * W.sameDayRepeat
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
