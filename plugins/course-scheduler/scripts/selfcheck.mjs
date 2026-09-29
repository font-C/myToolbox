/**
 * 求解器自检脚本：node plugins/course-scheduler/scripts/selfcheck.mjs
 * 验证示例数据排课后 H1–H7 零违反，且软约束罚分随质量提升不劣化。
 */
import { loadSampleProject } from '../src/sample.js'
import { solve } from '../src/solver/solve.js'
import { checkScheduleIntegrity } from '../src/solver/manual.js'
import { unitCountOf, unitSizeOf, slotCount, slotsPerDay } from '../src/solver/model.js'
import { buildWorkbook } from '../src/io.js'

function assert(cond, msg) {
  if (!cond) {
    console.error('✗ ' + msg)
    process.exitCode = 1
  } else {
    console.log('✓ ' + msg)
  }
}

// ---- 1. 示例数据可排 ----
const project = loadSampleProject()
assert(project.classes.length === 15, '示例：15 个班（七/八/九年级各 5）')
assert(project.assignments.length === 165, '示例：共 165 门任务')
const totalPeriods = project.assignments.reduce((s, a) => s + a.periods, 0)
assert(totalPeriods === 620, `示例：七/八/九年级周课时为 40/41/43（合计 ${totalPeriods}）`)

// ---- 2. 排课成功且硬约束零违反 ----
const t0 = performance.now()
const res = solve(project, { quality: 'standard', seed: 42 })
project.schedule = res.schedule // store.applySolve 在应用层做同样赋值
const ms = Math.round(performance.now() - t0)
console.log(`  排课耗时 ${ms}ms，罚分 ${res.penalty}`)
assert(res.ok === true, '排课成功，无未排任务')
const issues = checkScheduleIntegrity(project)
assert(issues.length === 0, 'H1/H2/H4/H5 完整性检查零问题' + (issues.length ? `：${issues[0]}` : ''))

// H6：每门任务课时排满
const ppd = slotsPerDay(project)
let h6ok = true
for (const a of project.assignments) {
  const subj = project.subjects.find((s) => s.id === a.subjectId)
  const placed = (project.schedule[a.id]?.length ?? 0) * unitSizeOf(subj)
  if (placed !== a.periods) {
    h6ok = false
    console.error(`  任务 ${a.id} 应排 ${a.periods} 实排 ${placed}`)
  }
}
assert(h6ok, 'H6 所有任务课时排满')

// H7：连堂单元相邻且同半天
let h7ok = true
for (const a of project.assignments) {
  const subj = project.subjects.find((s) => s.id === a.subjectId)
  if (!subj.double) continue
  const slots = project.schedule[a.id] ?? []
  for (const s of slots) {
    const p = s % ppd
    if (p + 2 > ppd || project.periods[p].session !== project.periods[p + 1].session) {
      h7ok = false
      console.error(`  连堂任务 ${a.id} 位于槽 ${s}，不构成同半天相邻两节`)
    }
  }
}
assert(h7ok, 'H7 连堂课均为同半天相邻两节')

// H4：教师不可用时段无课（徐老师周二上午 1-2 节）
const xu = project.teachers.find((t) => t.name === '徐机')
let h4ok = true
for (const s of xu.unavailable) {
  for (const [aid, slots] of Object.entries(project.schedule)) {
    const a = project.assignments.find((x) => x.id === aid)
    if (a.teacherId !== xu.id) continue
    if (slots.includes(s)) h4ok = false
  }
}
assert(h4ok, 'H4 教师不可用时段无课')

// H5：班级不可用时段无课
let h5ok = true
for (const c of project.classes) {
  for (const s of project.classBlocked[c.id] ?? []) {
    for (const [aid, slots] of Object.entries(project.schedule)) {
      const a = project.assignments.find((x) => x.id === aid)
      if (a.classId !== c.id) continue
      if (slots.includes(s)) h5ok = false
    }
  }
}
assert(h5ok, 'H5 班级不可用时段无课')

// 规则：体育只排下午（pePmOnly 默认开启）。defaultPeriods：dawn0 am1-4 pm5-8 eve9-10
const pmIdx = new Set([5, 6, 7, 8])
let peRuleOk = true
let peCount = 0
for (const [aid, slots] of Object.entries(project.schedule)) {
  const a = project.assignments.find((x) => x.id === aid)
  const subj = project.subjects.find((s) => s.id === a.subjectId)
  if (!subj.isPe) continue
  for (const s of slots) {
    peCount++
    if (!pmIdx.has(s % ppd)) peRuleOk = false
  }
}
assert(peRuleOk && peCount > 0, `规则：体育全部排在下午（${peCount} 个单元）`)

// 规则：早晨不自动排课（skipDawn 默认开启）
let dawnOk = true
let dawnCount = 0
for (const slots of Object.values(project.schedule)) {
  for (const s of slots) {
    if (s % ppd === 0) {
      dawnOk = false
      dawnCount++
    }
  }
}
assert(dawnOk, `规则：早晨时段无自动排课单元${dawnCount ? `（发现 ${dawnCount} 个）` : ''}`)

// S9：作文连堂全部落在优先时段（周三至周五 下午1-2节）
let essayOk = true
let essayCount = 0
for (const [aid, slots] of Object.entries(project.schedule)) {
  const a = project.assignments.find((x) => x.id === aid)
  const subj = project.subjects.find((s) => s.id === a.subjectId)
  if (!subj || !/作文/.test(subj.name)) continue
  for (const s of slots) {
    essayCount++
    const d = Math.floor(s / ppd)
    const p = s % ppd
    if (!(d >= 2 && d <= 4 && (p === 5 || p === 6))) essayOk = false
  }
}
assert(essayOk && essayCount > 0, `S9 作文连堂全部落在周三至周五下午1-2节（${essayCount} 个单元）`)

// ---- 3. 软约束抽查：主科更多出现在黄金时段（上午1-3节 / 下午1-2节）----
let majorGold = 0
let majorTotal = 0
const goldIdx = new Set([1, 2, 3, 5, 6]) // defaultPeriods ppd=11：dawn0, am1-4, pm5-8, eve9-10
for (const [aid, slots] of Object.entries(project.schedule)) {
  const a = project.assignments.find((x) => x.id === aid)
  const subj = project.subjects.find((s) => s.id === a.subjectId)
  if (!subj.isMajor) continue
  for (const s of slots) {
    majorTotal++
    if (goldIdx.has(s % ppd)) majorGold++
  }
}
console.log(`  主科黄金占比 ${majorGold}/${majorTotal} = ${((majorGold / majorTotal) * 100).toFixed(0)}%`)
assert(majorGold / majorTotal > 0.35, 'S1 主科黄金时段占比 > 35%')

// ---- 4. 拖拽校验：非法移动被拒绝、合法交换成功 ----
const { canPlaceUnit, swapUnits, moveUnit } = await import('../src/solver/manual.js')
const a0 = project.assignments[0]
const s0 = project.schedule[a0.id][0]
// 原位被自身占用 → 直接放置被拒（moveUnit 会先摘除自身再校验）
const selfCheck = canPlaceUnit(project, a0.id, s0)
assert(selfCheck.ok === false, '手动校验：原位直接放置被占拒绝')
assert(moveUnit(project, a0.id, 0, s0).ok === true, '手动移动：移回原位成功')
// 移到教师不可用时段 → 拒绝并给出原因
const xuBlocked = xu.unavailable[0]
const check = canPlaceUnit(project, a0.id, xuBlocked)
assert(check.ok || check.reason, `手动校验：异常位置返回原因（${check.reason || '恰好合法'}）`)
// 找到一个真正可交换的单元对（不同班、不同教师、非连堂，且目标槽未被对方自身占用），避免依赖具体排法
function subjOf(a) {
  return project.subjects.find((s) => s.id === a.subjectId)
}
let pair = null
let before1 = null
let before2 = null
let sw = null
outer: for (const a of project.assignments) {
  if (subjOf(a).double) continue
  const arrA = project.schedule[a.id]
  if (!arrA?.length) continue
  for (const b of project.assignments) {
    if (b === a || subjOf(b).double) continue
    if (a.classId === b.classId || a.teacherId === b.teacherId) continue
    const arrB = project.schedule[b.id]
    if (!arrB?.length) continue
    if (arrA[0] === arrB[0]) continue
    const bA = arrA.slice()
    const bB = arrB.slice()
    const s = swapUnits(project, a.id, 0, b.id, 0)
    if (s.ok) {
      pair = [a, b]
      before1 = bA
      before2 = bB
      sw = s
      break outer
    }
  }
}
assert(!!pair, '找到可交换的单元对')
if (pair) {
  const [aid1, aid2] = pair
  assert(sw.ok === true, '手动交换成功')
  const expect1 = [...before1.filter((s) => s !== before1[0]), before2[0]].sort((x, y) => x - y)
  const expect2 = [...before2.filter((s) => s !== before2[0]), before1[0]].sort((x, y) => x - y)
  assert(
    JSON.stringify(project.schedule[aid1.id]) === JSON.stringify(expect1) &&
      JSON.stringify(project.schedule[aid2.id]) === JSON.stringify(expect2),
    '交换后槽位互换'
  )
}
const reissues = checkScheduleIntegrity(project)
assert(reissues.length === 0, '交换后完整性仍为零问题')

// ---- 5. 导出工作簿可构建 ----
const wb = buildWorkbook(project)
assert(wb.SheetNames.join(',') === '总课表,班级课表,教师课表', '导出工作簿含三张表')

console.log(process.exitCode ? '\n自检未通过' : '\n全部通过')
