/**
 * 排课求解器：贪心（难排优先 + 启发式选位）→ 未排单元修复（腾挪重排）→ 局部爬山（热点驱动
 * 的移动/交换 + 随机重启，取软约束罚分最小的完整解）。全部硬约束与规则开关由 Sched.fits 保证。
 */
import { buildProblem, Sched, fullPenalty, placementPen, mulberry32, W } from './constraints.js'
import { validateProblem, unitSizeOf } from './model.js'

const PRESETS = {
  fast: { restarts: 4, climbIters: 1500 },
  standard: { restarts: 8, climbIters: 4000 },
  fine: { restarts: 16, climbIters: 10000 },
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
    repair(pb, st, rng) // 尽力把贪心未排的单元腾挪塞入
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
    // 作文连堂最优先（窗口时段稀缺，先占位）；其余按连堂 > 周课时多 > 教师不可用多
    keys[u] =
      pb.unitSize[u] * 1000 +
      (pb.rules.essayPm && pb.asgEssay[a] ? 2000 : 0) +
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

/** 作文连堂是否落在优先时段（周三至周五 下午1-2节） */
function essayInWindow(pb, a, slot) {
  const d = pb.slotDay[slot]
  const p = pb.slotPeriod[slot]
  return (
    !pb.periodAm[p] && pb.majorGoldIdx[p] === 1 && d >= 2 && d < Math.min(5, pb.nDays)
  )
}

/** 贪心选位的启发式代价：S1/S4/S9 时段偏好 + 对 S2/S3/S5/S6/S7 的即时影响 */
export function greedyCost(pb, st, u, slot) {
  const a = pb.unitAsg[u]
  const c = pb.asgClass[a]
  const t = pb.asgTeacher[a]
  const subj = pb.asgSubject[a]
  const d = pb.slotDay[slot]
  const size = pb.unitSize[u]
  let pen = placementPen(pb, a, pb.slotPeriod[slot])

  // S9：作文连堂优先时段
  if (pb.rules.essayPm && pb.asgEssay[a]) {
    pen += essayInWindow(pb, a, slot) ? W.essayGood : W.essayBad
  }

  // S2：该班当天已有同科目单元（贪心阶段不区分结构下限，尽量分散）
  const cdBase = (c * pb.nDays + d) * pb.nSubjects + subj
  if (st.cdSubjUnits[cdBase] > 0) pen += W.sameDayRepeat

  // S2b：同日同科目尽量分属不同时段段
  if (st.cdSubjBucket[cdBase * 3 + pb.slotBucket[slot]] > 0) pen += W.sameDaySameSession

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

// ---- 未排单元修复：直接找空位，失败则腾挪占用者（有界深度腾挪链 + 日志式撤销） ----

function journalStart(st) {
  ;(st._jstack ??= []).push([])
}
/** 撤销并弹出当前层日志 */
function journalUndo(st) {
  const j = st._jstack?.pop()
  if (j === undefined) return
  const outer = st._jstack?.length ? st._jstack : null
  st._jstack = null // 撤销过程本身不再记录
  for (let i = j.length - 1; i >= 0; i--) {
    const { u, prev } = j[i]
    if (st.unitSlot[u] !== -1) st.remove(u)
    if (prev !== -1) st.place(u, prev)
  }
  st._jstack = outer
}
/** 提交当前层日志：合并进上一层（成功路径的 mutations 由外层失败时统一撤销） */
function journalCommit(st) {
  const j = st._jstack?.pop()
  if (!j) {
    st._jstack = st._jstack?.length ? st._jstack : null
    return
  }
  const outer = st._jstack?.length ? st._jstack[st._jstack.length - 1] : null
  if (outer) outer.push(...j)
  st._jstack = st._jstack?.length ? st._jstack : null
}

/**
 * 尽力把 st.unplaced 中的单元全部安排进课表。
 * 对每个未排单元：先随机起点找空位；失败则按「挪走占用者的代价」挑选候选格腾挪，
 * 被挪单元放不下时递归腾挪（有界深度）。失败自动按日志回滚，返回是否全部排完。
 */
function repair(pb, st, rng) {
  if (!st.unplaced.length) return true
  const pending = [...st.unplaced]
  st.unplaced = []
  const failed = []
  for (const u of pending) {
    if (!repairUnit(pb, st, u, rng)) failed.push(u)
  }
  st.unplaced = failed
  return failed.length === 0
}

function repairUnit(pb, st, u, rng, depth = 2) {
  const start = (rng() * pb.nSlots) | 0
  // 1) 直接找空位
  for (let i = 0; i < pb.nSlots; i++) {
    const s = (start + i) % pb.nSlots
    if (st.fits(u, s)) {
      st.place(u, s)
      return true
    }
  }
  // 2) 腾挪：按「挪走占用者的代价」升序挑候选格（位置差的单元先挪，保护落位好的——
  //    如已在优先窗口的作文连堂罚分为很负，自然不会被选中）；
  //    被挪单元自己放不下时递归腾挪（受 depth 限制），形成腾挪链
  const size = pb.unitSize[u]
  const cands = []
  for (let i = 0; i < pb.nSlots; i++) {
    const s = (start + i) % pb.nSlots
    if (s + size > pb.nSlots) continue
    if (pb.rules.skipDawn && pb.slotSession[s] === 0) continue
    const occ = occupantsAt(pb, st, u, s)
    if (!occ.length) continue // 空位都放不下 → 被不可用/规则挡住，跳过
    let cost = 0
    for (const v of occ) cost += unitPenAt(pb, st, v)
    cands.push({ s, occ, cost })
  }
  cands.sort((x, y) => x.cost - y.cost)
  // 候选预算：外层多试几格，内层收紧，避免大规模场景递归失控
  const topK = depth >= 2 ? 10 : 6
  for (const { s, occ } of cands.slice(0, topK)) {
    journalStart(st)
    let committed = false
    for (const v of occ) st.remove(v)
    if (st.fits(u, s)) {
      st.place(u, s)
      let allOk = true
      for (const v of occ) {
        const vs = findFit(pb, st, v, rng)
        if (vs !== -1) {
          st.place(v, vs)
        } else if (depth > 0 && repairUnit(pb, st, v, rng, depth - 1)) {
          // 递归腾挪成功，v 已落位
        } else {
          allOk = false
          break
        }
      }
      if (allOk) committed = true
    }
    if (committed) journalCommit(st)
    else journalUndo(st)
    if (committed) return true
  }
  return false
}

/** 单元当前所在位置的时段偏好罚分（越高说明位置越差、越适合被挪走） */
function unitPenAt(pb, st, v) {
  const s = st.unitSlot[v]
  if (s === -1) return 0
  const a = pb.unitAsg[v]
  let pen = placementPen(pb, a, pb.slotPeriod[s])
  if (pb.rules.essayPm && pb.asgEssay[a]) {
    pen += essayInWindow(pb, a, s) ? W.essayGood : W.essayBad
  }
  return pen
}

/** 占据 u（班级/教师维度）在 slot..slot+size-1 上的单元集合 */
function occupantsAt(pb, st, u, slot) {
  const a = pb.unitAsg[u]
  const c = pb.asgClass[a]
  const t = pb.asgTeacher[a]
  const size = pb.unitSize[u]
  const set = new Set()
  for (let k = 0; k < size; k++) {
    const s = slot + k
    const v1 = st.classSlot[c * pb.nSlots + s]
    if (v1 !== -1) set.add(v1)
    const v2 = st.teacherSlot[t * pb.nSlots + s]
    if (v2 !== -1) set.add(v2)
  }
  return [...set]
}

function findFit(pb, st, u, rng) {
  const start = (rng() * pb.nSlots) | 0
  for (let i = 0; i < pb.nSlots; i++) {
    const s = (start + i) % pb.nSlots
    if (st.fits(u, s)) return s
  }
  return -1
}

// ---- 爬山：热点驱动的移动/交换 ----

/** 收集当前罚分热点相关的单元：S2 超额 / S3 相邻 / S6 教师空档 / S9 作文未中窗 */
function hotspotPool(pb, st) {
  const pool = []
  const seen = new Set()
  const pushUnit = (u) => {
    if (!seen.has(u) && st.unitSlot[u] !== -1) {
      pool.push(u)
      seen.add(u)
    }
  }
  // S9：未落入优先时段的作文单元
  if (pb.rules.essayPm) {
    for (let u = 0; u < pb.nUnits; u++) {
      const a = pb.unitAsg[u]
      if (!pb.asgEssay[a]) continue
      if (!essayInWindow(pb, a, st.unitSlot[u])) pushUnit(u)
    }
  }
  for (let c = 0; c < pb.nClasses; c++) {
    for (let s = 0; s < pb.nSubjects; s++) {
      const weekly = pb.subjUnitsByClass[c * pb.nSubjects + s]
      if (!weekly) continue
      let hotspot = false
      const floor = Math.max(0, weekly - pb.nDays)
      if (floor) {
        let excess = 0
        for (let d = 0; d < pb.nDays; d++) {
          const cnt = st.cdSubjUnits[(c * pb.nDays + d) * pb.nSubjects + s]
          if (cnt > 1) excess += cnt - 1
        }
        hotspot = excess > floor
      } else {
        for (let d = 0; d < pb.nDays; d++) {
          if (st.cdSubjUnits[(c * pb.nDays + d) * pb.nSubjects + s] > 1) {
            hotspot = true
            break
          }
        }
      }
      if (!hotspot && weekly <= pb.nDays) {
        for (let d = 0; d + 1 < pb.nDays; d++) {
          if (
            st.cdSubjUnits[(c * pb.nDays + d) * pb.nSubjects + s] > 0 &&
            st.cdSubjUnits[(c * pb.nDays + d + 1) * pb.nSubjects + s] > 0
          ) {
            hotspot = true
            break
          }
        }
      }
      if (!hotspot) continue
      for (let u = 0; u < pb.nUnits; u++) {
        const a = pb.unitAsg[u]
        if (pb.asgClass[a] === c && pb.asgSubject[a] === s) pushUnit(u)
      }
    }
  }
  // 教师空档：每位有空档的教师抽一个单元入池
  for (let t = 0; t < pb.nTeachers; t++) {
    let hasGap = false
    for (let d = 0; d < pb.nDays && !hasGap; d++) {
      const mask = st.tdMask[t * pb.nDays + d]
      if (!mask) continue
      let occ = 0
      for (let m = mask; m; m &= m - 1) occ++
      const lo = Math.log2(mask & -mask) | 0
      const hi = 31 - Math.clz32(mask)
      hasGap = hi - lo + 1 > occ
    }
    if (!hasGap) continue
    for (let u = 0; u < pb.nUnits; u++) {
      if (pb.asgTeacher[pb.unitAsg[u]] === t) {
        pushUnit(u)
        break
      }
    }
  }
  return pool
}

/** 爬山：移动或交换单元，罚分更低才接受；返回最新全局罚分 */
function climb(pb, st, iters, rng) {
  if (st.unplaced.length || !pb.nUnits) return fullPenalty(pb, st)
  let penCur = fullPenalty(pb, st)
  let pool = hotspotPool(pb, st)
  const refresh = Math.max(150, (iters / 10) | 0)
  for (let i = 0; i < iters; i++) {
    if (i % refresh === 0) pool = hotspotPool(pb, st)
    const u =
      pool.length && rng() < 0.7 ? pool[(rng() * pool.length) | 0] : (rng() * pb.nUnits) | 0
    if (st.unitSlot[u] === -1) continue
    penCur =
      rng() < 0.4 ? climbSwap(pb, st, u, rng, penCur) : climbMove(pb, st, u, rng, penCur)
    // 作文连堂未落窗：单节交换无法腾位，需要「双节挤入 + 换出者另置」的复合移动
    if (
      pb.rules.essayPm &&
      pb.asgEssay[pb.unitAsg[u]] &&
      pb.unitSize[u] === 2 &&
      !essayInWindow(pb, pb.unitAsg[u], st.unitSlot[u])
    ) {
      penCur = climbEssayDisplace(pb, st, u, rng, penCur)
    }
  }
  return penCur
}

/**
 * 作文连堂复合移动：把未落窗的连堂挤入周三起「下午1-2节」的相邻两节，
 * 原占据该两节的单节单元安置到连堂腾出的旧位或其他空位；罚分更低才接受。
 */
function climbEssayDisplace(pb, st, u, rng, penCur) {
  const old = st.unitSlot[u]
  const a = pb.unitAsg[u]
  if (pb.unitSize[u] !== 2 || old === -1) return penCur
  const pmIdx = []
  for (let i = 0; i < pb.ppd; i++) {
    if (!pb.periodAm[i] && pb.majorGoldIdx[i] === 1) pmIdx.push(i)
  }
  if (pmIdx.length < 2) return penCur
  const c = pb.asgClass[a]
  const t = pb.asgTeacher[a]
  const dayEnd = Math.min(5, pb.nDays)
  for (let d = 2; d < dayEnd; d++) {
    const s1 = d * pb.ppd + pmIdx[0]
    const s2 = s1 + 1
    // 收集占据该两节的单元（班级与教师维度）；连堂占位无法挤入
    const blockers = new Set()
    for (const s of [s1, s2]) {
      const v1 = st.classSlot[c * pb.nSlots + s]
      if (v1 !== -1) blockers.add(v1)
      const v2 = st.teacherSlot[t * pb.nSlots + s]
      if (v2 !== -1) blockers.add(v2)
    }
    if (!blockers.size || blockers.size > 2) continue
    let ok = true
    for (const v of blockers) {
      if (pb.unitSize[v] !== 1) {
        ok = false
        break
      }
    }
    if (!ok) continue
    const bl = [...blockers]
    const saved = bl.map((v) => st.unitSlot[v])
    for (const v of bl) st.remove(v)
    st.remove(u)
    if (!st.fits(u, s1)) {
      st.place(u, old)
      bl.forEach((v, k) => st.place(v, saved[k]))
      continue
    }
    st.place(u, s1)
    let allOk = true
    let oldSlotUsed = false
    for (const v of bl) {
      let target = -1
      if (!oldSlotUsed) {
        for (const os of [old, old + 1]) {
          if (os === s1 || os === s1 + 1 || os >= pb.nSlots) continue
          if (st.fits(v, os)) {
            target = os
            oldSlotUsed = true
            break
          }
        }
      }
      if (target === -1) target = findFit(pb, st, v, rng)
      if (target === -1) {
        allOk = false
        break
      }
      st.place(v, target)
    }
    if (allOk) {
      const pen = fullPenalty(pb, st)
      if (pen < penCur - 1e-9) return pen
    }
    // 回滚（未接受或安置失败）
    st.remove(u)
    for (const v of bl) {
      if (st.unitSlot[v] !== -1) st.remove(v)
    }
    st.place(u, old)
    bl.forEach((v, k) => st.place(v, saved[k]))
  }
  return penCur
}

/** 移动单元到更优空位；返回接受后的全局罚分（未接受返回 penCur） */
function climbMove(pb, st, u, rng, penCur) {
  const old = st.unitSlot[u]
  st.remove(u)
  let bestSlot = -1
  let bestPen = penCur
  for (let k = 0; k < 3; k++) {
    const slot = (rng() * pb.nSlots) | 0
    if (!st.fits(u, slot)) continue
    st.place(u, slot)
    const pen = fullPenalty(pb, st)
    if (pen < bestPen - 1e-9) {
      bestPen = pen
      bestSlot = slot
    }
    st.remove(u)
  }
  if (bestSlot !== -1) {
    st.place(u, bestSlot)
    return bestPen
  }
  st.place(u, old)
  return penCur
}

/** 交换两个单元的位置；返回接受后的全局罚分（未接受返回 penCur） */
function climbSwap(pb, st, u, rng, penCur) {
  const old = st.unitSlot[u]
  // 找同尺寸、不同任务的搭档
  let v = -1
  for (let tries = 0; tries < 4; tries++) {
    const cand = (rng() * pb.nUnits) | 0
    if (
      cand !== u &&
      st.unitSlot[cand] !== -1 &&
      pb.unitSize[cand] === pb.unitSize[u] &&
      pb.unitAsg[cand] !== pb.unitAsg[u]
    ) {
      v = cand
      break
    }
  }
  if (v === -1) return penCur
  const oldV = st.unitSlot[v]
  st.remove(u)
  st.remove(v)
  if (st.fits(u, oldV) && st.fits(v, old)) {
    st.place(u, oldV)
    st.place(v, old)
    const pen = fullPenalty(pb, st)
    if (pen < penCur - 1e-9) return pen
    // 回滚到交换前
    st.remove(u)
    st.remove(v)
    st.place(u, old)
    st.place(v, oldV)
  } else {
    st.place(u, old)
    st.place(v, oldV)
  }
  return penCur
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

/** 未排任务的原因分析（考虑规则开关下的可用时段口径） */
function unplacedReport(project, pb, st) {
  const rules = pb.rules
  const seen = new Map()
  for (const u of st.unplaced) {
    const a = project.assignments[pb.unitAsg[u]]
    if (!a || seen.has(a.id)) continue
    const subj = project.subjects.find((s) => s.id === a.subjectId)
    const need = unitSizeOf(subj)
    const ti = pb.asgTeacher[pb.unitAsg[u]]
    const ci = pb.asgClass[pb.unitAsg[u]]
    const usable = (s) => {
      if (rules.skipDawn && pb.slotSession[s] === 0) return false
      if (rules.pePmOnly && pb.asgPe[pb.unitAsg[u]] && pb.slotSession[s] !== 2) return false
      return true
    }
    let teacherFree = 0
    for (let s = 0; s < pb.nSlots; s++) {
      if (usable(s) && !pb.teacherBlocked[ti * pb.nSlots + s]) teacherFree++
    }
    let classFree = 0
    for (let s = 0; s < pb.nSlots; s++) {
      if (usable(s) && !pb.classBlocked[ci * pb.nSlots + s]) classFree++
    }
    let reason
    if (teacherFree < need) reason = `教师可用时段不足（规则内仅 ${teacherFree} 节）`
    else if (classFree < need) reason = `班级可用时段不足（规则内仅 ${classFree} 节）`
    else reason = '与已排课程冲突，可在「课表」页手动安排'
    seen.set(a.id, reason)
  }
  return [...seen.entries()].map(([assignmentId, reason]) => ({ assignmentId, reason }))
}
