/**
 * 求解质量分析：分解各项软约束指标，多规模性能与完整性验证。
 * 用法：node scripts/analyze.mjs
 */
import { loadSampleProject } from '../src/sample.js'
import { solve } from '../src/solver/solve.js'
import { buildProblem, Sched, fullPenalty, placementPen, W, mulberry32 } from '../src/solver/constraints.js'
import { emptyProject, periodsFromPreset, defaultPeriods, uid, unitSizeOf, unitCountOf } from '../src/solver/model.js'
import { checkScheduleIntegrity } from '../src/solver/manual.js'

/** 从 project.schedule 重建 Sched 状态（与 buildProblem 单元展开顺序一致） */
function rebuildSched(project) {
  const pb = buildProblem(project)
  const st = new Sched(pb)
  let ui = 0
  for (const a of project.assignments) {
    const subj = project.subjects.find((s) => s.id === a.subjectId)
    const n = unitCountOf(a, subj)
    const slots = project.schedule[a.id] ?? []
    for (let k = 0; k < n; k++, ui++) {
      if (slots[k] !== undefined) st.place(ui, slots[k])
      else st.unplaced.push(ui)
    }
  }
  return { pb, st }
}

function breakdown(project) {
  const { pb, st } = rebuildSched(project)
  const ppd = pb.ppd
  const res = { total: fullPenalty(pb, st) }

  // S1/S4/S9
  let majorGold = 0, majorTotal = 0, majorBad = 0, minorGold = 0, minorTotal = 0, minorEve = 0
  let peBad = 0, peTotal = 0, peGoldHit = 0
  let s1s4 = 0
  for (let u = 0; u < pb.nUnits; u++) {
    const s = st.unitSlot[u]
    if (s === -1) continue
    const a = pb.unitAsg[u]
    const p = pb.slotPeriod[s]
    s1s4 += placementPen(pb, a, p)
    const gold = pb.majorGoldIdx[p] === 1
    const eve = pb.eveIdx[p] === 1
    if (pb.asgMajor[a]) {
      majorTotal++
      if (gold) majorGold++
      else if (!pb.periodAm[s] && !eve) majorBad++
    } else {
      minorTotal++
      if (gold) minorGold++
      if (eve) minorEve++
    }
    if (pb.asgPe[a]) {
      peTotal++
      if (gold) peGoldHit++
      if ((pb.periodAm[s] && p === pb.lastAm) || (!pb.periodAm[s] && p === pb.firstPm)) peBad++
    }
  }
  res.s1 = { s1s4, majorGold, majorTotal, majorBad, minorGold, minorTotal, minorEve }
  res.s4 = { peBad, peTotal, peGoldHit }

  // S9 作文
  let essayGood = 0, essayTotal = 0
  if (pb.rules.essayPm) {
    for (let u = 0; u < pb.nUnits; u++) {
      const s = st.unitSlot[u]
      if (s === -1) continue
      if (!pb.asgEssay[pb.unitAsg[u]]) continue
      essayTotal++
      const d = pb.slotDay[s]
      const p = pb.slotPeriod[s]
      if (!pb.periodAm[p] && pb.majorGoldIdx[p] === 1 && d >= 2 && d < Math.min(5, pb.nDays)) essayGood++
    }
  }
  res.s9 = { essayGood, essayTotal }

  // S2 / S3 / S7
  let s2 = 0, s2count = 0, s3 = 0, s3count = 0, s7 = 0
  for (let c = 0; c < pb.nClasses; c++) {
    for (let d = 0; d < pb.nDays; d++) {
      s7 += Math.abs(st.cdPeriods[c * pb.nDays + d] - pb.classAvgPeriods[c]) * W.dayDeviation
      for (let subj = 0; subj < pb.nSubjects; subj++) {
        const cnt = st.cdSubjUnits[(c * pb.nDays + d) * pb.nSubjects + subj]
        if (cnt > 1) { s2 += (cnt - 1) * W.sameDayRepeat; s2count++ }
      }
    }
  }
  for (let c = 0; c < pb.nClasses; c++) {
    for (let subj = 0; subj < pb.nSubjects; subj++) {
      if ((pb.subjWeeklyUnits.get(subj) ?? 0) > pb.nDays) continue
      let prev = 0
      for (let d = 0; d < pb.nDays; d++) {
        const cnt = st.cdSubjUnits[(c * pb.nDays + d) * pb.nSubjects + subj]
        if (cnt > 0 && prev > 0) { s3 += W.adjacentDay; s3count++ }
        prev = cnt
      }
    }
  }
  res.s2 = { pen: s2, count: s2count }
  res.s3 = { pen: s3, count: s3count }
  res.s7 = { pen: s7 }

  // S5 / S6
  let s5 = 0, s6 = 0, gapTotal = 0, gapMax = 0, teachersWithGaps = 0
  for (let t = 0; t < pb.nTeachers; t++) {
    let tGap = 0
    for (let d = 0; d < pb.nDays; d++) {
      s5 += Math.abs(st.tdLoad[t * pb.nDays + d] - pb.teacherAvgPeriods[t]) * W.teacherLoadDev
      const mask = st.tdMask[t * pb.nDays + d]
      if (mask) {
        let occ = 0
        for (let m = mask; m; m &= m - 1) occ++
        const lo = Math.log2(mask & -mask) | 0
        const hi = 31 - Math.clz32(mask)
        const g = hi - lo + 1 - occ
        s6 += g * W.teacherGap
        tGap += g
      }
    }
    gapTotal += tGap
    gapMax = Math.max(gapMax, tGap)
    if (tGap > 0) teachersWithGaps++
  }
  res.s5 = { pen: s5 }
  res.s6 = { pen: s6, gapTotal, gapMax, teachersWithGaps, nTeachers: pb.nTeachers }
  return res
}

function report(name, ms, r, b, issues) {
  const line = (x) => console.log('  ' + x)
  console.log(`\n【${name}】耗时 ${ms}ms ok=${r.ok} 完整性问题=${issues.length} 总罚分 ${b.total.toFixed(1)}`)
  line(`S1 主科黄金 ${b.s1.majorGold}/${b.s1.majorTotal}(${Math.round((100 * b.s1.majorGold) / Math.max(1, b.s1.majorTotal))}%) 主科劣段 ${b.s1.majorBad} 副科占黄金 ${b.s1.minorGold}/${b.s1.minorTotal} 副科晚间 ${b.s1.minorEve}`)
  line(`S2 同科同日多单元: ${b.s2.count} 处 (${b.s2.pen})`)
  line(`S3 相邻日同科: ${b.s3.count} 处 (${b.s3.pen})`)
  line(`S4 体育: 饭点 ${b.s4.peBad}/${b.s4.peTotal} 黄金 ${b.s4.peGoldHit}`)
  line(`S5 教师日均衡: ${b.s5.pen}  S6 空档 ${b.s6.gapTotal} 段/上限单师 ${b.s6.gapMax} (${b.s6.teachersWithGaps}/${b.s6.nTeachers} 师有空档) ${b.s6.pen}`)
  line(`S7 班级日均衡: ${b.s7.pen}  S9 作文优段 ${b.s9.essayGood}/${b.s9.essayTotal}`)
  if (issues.length) line('⚠ ' + issues.slice(0, 3).join(' | '))
}

// ---- 基准：示例（15 班全校）----
{
  const p = loadSampleProject()
  const units = p.assignments.reduce((s, a) => s + a.periods, 0)
  console.log(`示例规模：${p.classes.length} 班 / ${p.teachers.length} 师 / ${p.assignments.length} 任务 / 每周 ${units} 节 / ${p.days.length}×${p.periods.length}=${p.days.length * p.periods.length} 槽`)
  for (const q of ['fast', 'standard', 'fine']) {
    const proj = loadSampleProject()
    const t0 = performance.now()
    const r = solve(proj, { quality: q, seed: 42 })
    const ms = Math.round(performance.now() - t0)
    proj.schedule = r.schedule
    report(`示例 ${q}`, ms, r, breakdown(proj), checkScheduleIntegrity(proj))
  }
}

// ---- 多规模压力 ----
function bigProject(nClasses, perDay = null) {
  const p = emptyProject()
  p.periods = perDay ?? periodsFromPreset(4, 4)
  const grade = { id: uid('g'), name: '七年级' }
  p.grades.push(grade)
  for (let i = 1; i <= nClasses; i++) p.classes.push({ id: uid('c'), name: `七(${i})班`, gradeId: grade.id })
  const defs = [
    ['语文', 5, true], ['数学', 5, true], ['英语', 5, true],
    ['道法', 2], ['历史', 2], ['地理', 2], ['生物', 2],
    ['体育', 3], ['信息', 2], ['音乐', 1], ['美术', 1], ['班会', 1],
  ]
  const subjByName = {}
  for (const [name, weekly, isMajor] of defs) {
    const s = { id: uid('s'), name, isMajor: !!isMajor, isPe: name === '体育', double: name === '信息', weekly }
    p.subjects.push(s)
    subjByName[name] = s
  }
  const pools = {}
  for (const [name, weekly, isMajor] of defs) {
    const need = nClasses * weekly
    const perTeacher = isMajor ? 10 : name === '体育' ? 8 : need
    const n = Math.ceil(need / perTeacher)
    pools[name] = []
    for (let i = 0; i < n; i++) {
      const t = { id: uid('t'), name: `${name}师${n > 1 ? i + 1 : ''}`, unavailable: [] }
      p.teachers.push(t)
      pools[name].push(t)
    }
  }
  for (const c of p.classes) {
    for (const [name, weekly] of defs) {
      const pool = pools[name]
      p.assignments.push({ id: uid('a'), classId: c.id, subjectId: subjByName[name].id, teacherId: pool[p.classes.indexOf(c) % pool.length].id, periods: weekly })
    }
  }
  return p
}

for (const n of [8, 16, 30]) {
  const p = bigProject(n)
  const units = p.assignments.reduce((s, a) => s + a.periods, 0)
  const t0 = performance.now()
  const r = solve(p, { quality: 'standard', seed: 42 })
  const ms = Math.round(performance.now() - t0)
  p.schedule = r.schedule
  report(`${n} 班(${units}节) standard`, ms, r, breakdown(p), checkScheduleIntegrity(p))
}

// ---- 教师不可用密集场景 ----
{
  const p = bigProject(16)
  const rng = mulberry32(7)
  for (const t of p.teachers) {
    const day = Math.floor(rng() * 5)
    t.unavailable = [day * p.periods.length, day * p.periods.length + 1, day * p.periods.length + 2, day * p.periods.length + 3]
  }
  const t0 = performance.now()
  const r = solve(p, { quality: 'standard', seed: 42 })
  const ms = Math.round(performance.now() - t0)
  p.schedule = r.schedule
  report('16 班+教师半天教研 standard', ms, r, breakdown(p), checkScheduleIntegrity(p))
}

// ---- 满载场景（槽位利用率高）----
{
  // 每班周 34 节 / 40 槽 = 85% 利用率
  const p = bigProject(12)
  for (const a of p.assignments) {
    const subj = p.subjects.find((s) => s.id === a.subjectId)
    if (subj.isMajor) a.periods = 6
    if (subj.name === '班会') a.periods = 1
  }
  const units = p.assignments.reduce((s, a) => s + a.periods, 0)
  const cap = 12 * 40
  console.log(`\n满载场景利用率 ${(100 * units / cap).toFixed(0)}%`)
  const t0 = performance.now()
  const r = solve(p, { quality: 'standard', seed: 42 })
  const ms = Math.round(performance.now() - t0)
  p.schedule = r.schedule
  report('12 班满载 standard', ms, r, breakdown(p), checkScheduleIntegrity(p))
}
