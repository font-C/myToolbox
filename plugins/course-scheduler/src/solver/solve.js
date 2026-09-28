/**
 * 排课求解器：贪心（难排优先 + 启发式选位）+ 随机重启 + 局部爬山（移动单元改善软约束）。
 * 全部硬约束由 Sched.fits 保证；软约束以 fullPenalty 度量，多次重启取最优完整解。
 */
import { buildProblem, Sched, fullPenalty, placementPen, mulberry32, W } from './constraints.js'
import { validateProblem, unitCountOf, unitSizeOf } from './model.js'

const PRESETS = {
  fast: { restarts: 4, climbIters: 300 },
  standard: { restarts: 8, climbIters: 600 },
  fine: { restarts: 16, climbIters: 1200 },
}

/**
 * @param {object} project UI 数据对象
 * @param {{quality?: 'fast'|'standard'|'fine', seed?: number}} opts
 * @returns {{ok: boolean, schedule: Object<string, number[]>, penalty: number,
 *            unplaced: {assignmentId: string, reason: string}[], message: string}}
 */
export function solve(project, opts = {}) {
  const errs = validateProblem(project)
  if (errs.length) {
    return { ok: false, schedule: {}, penalty: 0, unplaced: [], message: errs.join('；') }
  }

  const pb = buildProblem(project)
  const { restarts, climbIters } = PRESETS[opts.quality ?? 'standard']
  const rng = mulberry32(opts.seed ?? (Date.now() & 0x7fffffff))

  let best = null
  let bestPen = Infinity
  let lastAttempt = null

  for (let r = 0; r < restarts; r++) {
    const st = greedy(pb, rng)
    if (st.unplaced.length === 0) {
      climb(pb, st, climbIters, rng)
      const pen = fullPenalty(pb, st)
      if (pen < bestPen) {
        bestPen = pen
        best = st
      }
    }
    lastAttempt = st
  }

  if (best) {
    return {
      ok: true,
      schedule: extractSchedule(project, pb, best),
      penalty: Math.round(bestPen * 100) / 100,
      unplaced: [],
      message: '排课成功，全部任务已安排',
    }
  }
  return {
    ok: false,
    schedule: extractSchedule(project, pb, lastAttempt),
    penalty: 0,
    unplaced: unplacedReport(project, pb, lastAttempt),
    message: '存在无法安排的任务，请参考未排原因调整后重试',
  }
}

/** 单元放置难度：连堂 > 周课时多 > 教师不可用时段多，随机扰动打散同级 */
function greedy(pb, rng) {
  const st = new Sched(pb)
  const order = new Array(pb.nUnits)
  const keys = new Float64Array(pb.nUnits)
  for (let u = 0; u < pb.nUnits; u++) {
    order[u] = u
    const a = pb.unitAsg[u]
    keys[u] =
      pb.unitSize[u] * 1000 +
      pb.asgWeekly[a] * 10 +
      pb.teacherBlockedCount[pb.asgTeacher[a]] * 2 +
      rng() * 4
  }
  order.sort((x, y) => keys[y] - keys[x])

  for (const u of order) {
    let bestSlot = -1
    let bestCost = Infinity
    for (let slot = 0; slot < pb.nSlots; slot++) {
      if (!st.fits(u, slot)) continue
      const cost = greedyCost(pb, st, u, slot) + rng() * 1.2
      if (cost < bestCost) {
        bestCost = cost
        bestSlot = slot
      }
    }
    if (bestSlot === -1) st.unplaced.push(u)
    else st.place(u, bestSlot)
  }
  return st
}

/** 贪心选位的启发式代价：S1/S4 时段偏好 + 对 S2/S3/S5/S6/S7 的即时影响 */
export function greedyCost(pb, st, u, slot) {
  const a = pb.unitAsg[u]
  const c = pb.asgClass[a]
  const t = pb.asgTeacher[a]
  const subj = pb.asgSubject[a]
  const d = pb.slotDay[slot]
  const size = pb.unitSize[u]
  let pen = placementPen(pb, a, pb.slotPeriod[slot])

  // S2：该班当天已有同科目单元
  const cdBase = (c * pb.nDays + d) * pb.nSubjects
  if (st.cdSubjUnits[cdBase + subj] > 0) pen += W.sameDayRepeat

  // S3：相邻天已有同科目
  if ((pb.subjWeeklyUnits.get(subj) ?? 0) <= pb.nDays) {
    if (d > 0 && st.cdSubjUnits[(c * pb.nDays + d - 1) * pb.nSubjects + subj] > 0) pen += W.adjacentDay
    if (
      d < pb.nDays - 1 &&
      st.cdSubjUnits[(c * pb.nDays + d + 1) * pb.nSubjects + subj] > 0
    )
      pen += W.adjacentDay
  }

  // S7：班级当天节数偏离
  const cdIdx = c * pb.nDays + d
  pen +=
    (Math.abs(st.cdPeriods[cdIdx] + size - pb.classAvgPeriods[c]) -
      Math.abs(st.cdPeriods[cdIdx] - pb.classAvgPeriods[c])) *
    W.dayDeviation

  // S5：教师当天节数偏离
  const tdIdx = t * pb.nDays + d
  pen +=
    (Math.abs(st.tdLoad[tdIdx] + size - pb.teacherAvgPeriods[t]) -
      Math.abs(st.tdLoad[tdIdx] - pb.teacherAvgPeriods[t])) *
    W.teacherLoadDev

  // S6：教师当天新增空档（新掩码的首末跨度变化）
  const mask = st.tdMask[tdIdx]
  const newMask = mask | (1 << pb.slotPeriod[slot])
  pen += (spanGaps(newMask) - spanGaps(mask)) * W.teacherGap

  return pen
}

function spanGaps(mask) {
  if (!mask) return 0
  const lo = Math.log2(mask & -mask) | 0
  const hi = 31 - Math.clz32(mask)
  let occupied = 0
  let m = mask
  while (m) {
    m &= m - 1
    occupied++
  }
  return hi - lo + 1 - occupied
}

/** 爬山：随机取已排单元，尝试移动到随机空位，罚分更低才接受 */
function climb(pb, st, iters, rng) {
  if (st.unplaced.length) return
  const placed = st.placedUnits()
  if (!placed.length) return
  let penCur = fullPenalty(pb, st)
  for (let i = 0; i < iters; i++) {
    const u = placed[(rng() * placed.length) | 0]
    const old = st.unitSlot[u]
    for (let k = 0; k < 2; k++) {
      const slot = (rng() * pb.nSlots) | 0
      if (slot === old || !st.fits(u, slot)) continue
      st.remove(u)
      st.place(u, slot)
      const pen = fullPenalty(pb, st)
      if (pen < penCur - 1e-9) {
        penCur = pen
        break // 改善：保持新位置
      }
      st.remove(u)
      st.place(u, old) // 无改善：移回原位
    }
  }
}

/** 从求解状态映射回 UI 的 schedule：assignmentId -> 单元首槽数组（按槽位升序） */
function extractSchedule(project, pb, st) {
  const out = {}
  for (const a of project.assignments) out[a.id] = []
  for (let u = 0; u < pb.nUnits; u++) {
    const s = st.unitSlot[u]
    if (s === -1) continue
    const a = project.assignments[pb.unitAsg[u]]
    if (a) out[a.id].push(s)
  }
  for (const id of Object.keys(out)) out[id].sort((x, y) => x - y)
  return out
}

/** 未排任务的原因分析 */
function unplacedReport(project, pb, st) {
  const seen = new Map()
  for (const u of st.unplaced) {
    const a = project.assignments[pb.unitAsg[u]]
    if (!a || seen.has(a.id)) continue
    const subj = project.subjects.find((s) => s.id === a.subjectId)
    const need = unitSizeOf(subj)
    const ti = pb.asgTeacher[pb.unitAsg[u]]
    const ci = pb.asgClass[pb.unitAsg[u]]
    let teacherFree = 0
    for (let s = 0; s < pb.nSlots; s++) {
      if (!pb.teacherBlocked[ti * pb.nSlots + s]) teacherFree++
    }
    let classFree = 0
    for (let s = 0; s < pb.nSlots; s++) {
      if (!pb.classBlocked[ci * pb.nSlots + s]) classFree++
    }
    let reason
    if (teacherFree < need) reason = `教师可用时段不足（仅 ${teacherFree} 节）`
    else if (classFree < need) reason = `班级可用时段不足（仅 ${classFree} 节）`
    else reason = '与已排课程冲突，可在「课表」页手动安排'
    seen.set(a.id, reason)
  }
  return [...seen.entries()].map(([assignmentId, reason]) => ({ assignmentId, reason }))
}
