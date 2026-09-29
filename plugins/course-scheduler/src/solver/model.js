/**
 * 排课数据模型与公共工具。
 *
 * 时间结构：days（星期名数组）× periods（节次数组，label + session 'am'|'pm'）。
 * 时段槽 slot = dayIndex * periods.length + periodIndex，全部用一维下标参与运算。
 */

export const SESSION_DAWN = 'dawn'
export const SESSION_AM = 'am'
export const SESSION_PM = 'pm'
export const SESSION_EVE = 'eve'

/** 一天内的时段类型（按时间先后排列）及其展示名/样式标记 */
export const SESSIONS = [
  { id: SESSION_DAWN, label: '早晨', cls: 'tag--dawn', th: 'th--dawn', color: '#f0abfc' },
  { id: SESSION_AM, label: '上午', cls: 'tag--am', th: 'th--am', color: '#1d4ed8' },
  { id: SESSION_PM, label: '下午', cls: 'tag--pm', th: 'th--pm', color: '#b45309' },
  { id: SESSION_EVE, label: '晚上', cls: 'tag--eve', th: 'th--eve', color: '#7c3aed' },
]
export function sessionInfo(id) {
  return SESSIONS.find((s) => s.id === id) ?? SESSIONS[1]
}
/** session 在一天中的先后序号 */
export function sessionOrder(id) {
  return SESSIONS.findIndex((s) => s.id === id)
}

let uidSeed = 0
export function uid(prefix) {
  return `${prefix}${Date.now().toString(36)}${(uidSeed++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

export const DEFAULT_DAYS = ['周一', '周二', '周三', '周四', '周五']

/** 常见学段预设：上午节数 / 下午节数 */
export function periodsFromPreset(am, pm) {
  const periods = []
  for (let i = 1; i <= am; i++) periods.push({ label: `第${i}节`, session: SESSION_AM })
  for (let i = 1; i <= pm; i++) periods.push({ label: `下午第${i}节`, session: SESSION_PM })
  return periods
}

/** 空白方案默认：早晨1 + 上午4 + 下午4 + 晚上2 */
export function defaultPeriods() {
  const periods = []
  for (const [count, session] of [
    [1, SESSION_DAWN],
    [4, SESSION_AM],
    [4, SESSION_PM],
    [2, SESSION_EVE],
  ]) {
    const info = sessionInfo(session)
    for (let i = 1; i <= count; i++) periods.push({ label: `${info.label}第${i}节`, session })
  }
  return periods
}

/** 科目默认周课时与属性猜测（用于快速录入，均可手动改） */
export function guessSubjectProps(name) {
  const n = (name || '').trim()
  if (/体育/.test(n)) return { isMajor: false, isPe: true, double: false, weekly: 3 }
  if (/^(语文|数学|英语|外语)$/.test(n)) return { isMajor: true, isPe: false, double: false, weekly: 5 }
  if (/(信息|信息技术|机)/.test(n)) return { isMajor: false, isPe: false, double: true, weekly: 2 }
  if (/(实验|劳动)/.test(n)) return { isMajor: false, isPe: false, double: false, weekly: 1 }
  return { isMajor: false, isPe: false, double: false, weekly: 2 }
}

/** 排课规则开关默认值（软约束是否启用） */
export const DEFAULT_RULES = {
  majorGold: true, // 主科优先 上午1-3节 / 下午1-2节
  minorPm: true, // 副科避开黄金时段，排在其余课时
  peAvoid: true, // 体育避开午间饭点与黄金时段
  essayPm: true, // 作文（连堂）优先 周三至周五 下午第1-2节
  minorEve: true, // 晚上少排副科
  pePmOnly: true, // 体育只排下午（不排早晨/上午/晚上；对自动排课与手动调课生效）
  skipDawn: true, // 早晨时段不自动排课（留作早读/晨会；手动调整不受限）
}

/** 空白方案 */
export function emptyProject() {
  return {
    days: [...DEFAULT_DAYS],
    periods: defaultPeriods(),
    grades: [],
    classes: [],
    teachers: [],
    subjects: [],
    assignments: [],
    /** 班级不可用时段：classId -> [slot] */
    classBlocked: {},
    /** 课表结果：assignmentId -> [slot...]（每单元占 1 或 2 个相邻槽） */
    schedule: {},
    /** 排课规则开关（软约束是否启用） */
    rules: { ...DEFAULT_RULES },
  }
}

export function slotCount(project) {
  return project.days.length * project.periods.length
}

export function slotsPerDay(project) {
  return project.periods.length
}

export function slotDay(slot, ppd) {
  return Math.floor(slot / ppd)
}

export function slotPeriod(slot, ppd) {
  return slot % ppd
}

/** 单元节数：连堂科目每个单元占 2 节，普通科目占 1 节 */
export function unitSizeOf(subject) {
  return subject?.double ? 2 : 1
}

/** 任务拆分后的单元数 */
export function unitCountOf(assignment, subject) {
  if (!subject) return 0
  const size = unitSizeOf(subject)
  return Math.floor((assignment.periods || 0) / size)
}

/**
 * 校验方案数据，返回错误消息数组（空数组 = 合法，可排课）。
 */
export function validateProblem(p) {
  const errs = []
  if (!p.periods.length) errs.push('请先在「时间结构」中设置节次')
  if (!p.days.length) errs.push('请先在「时间结构」中设置上课日')
  if (!p.classes.length) errs.push('请先添加班级')
  if (!p.teachers.length) errs.push('请先添加教师')
  if (!p.subjects.length) errs.push('请先添加科目')
  if (!p.assignments.length) errs.push('请先设置教学任务（班级-科目-教师）')

  const classIds = new Set(p.classes.map((c) => c.id))
  const teacherIds = new Set(p.teachers.map((t) => t.id))
  const subjectIds = new Set(p.subjects.map((s) => s.id))

  for (const a of p.assignments) {
    const name = `${classNameOf(p, a.classId)}·${subjectNameOf(p, a.subjectId)}`
    if (!classIds.has(a.classId) || !subjectIds.has(a.subjectId) || !teacherIds.has(a.teacherId)) {
      errs.push(`任务「${name}」引用了已删除的班级/科目/教师，请修复`)
      continue
    }
    const subj = p.subjects.find((s) => s.id === a.subjectId)
    const size = unitSizeOf(subj)
    if (!a.periods || a.periods <= 0) errs.push(`任务「${name}」周课时为 0`)
    else if (a.periods % size !== 0) {
      errs.push(`「${subj.name}」为连堂科目，任务「${name}」周课时须为偶数（当前 ${a.periods}）`)
    }
  }
  return errs
}

export function classNameOf(p, id) {
  return p.classes.find((c) => c.id === id)?.name ?? '?'
}
export function teacherNameOf(p, id) {
  return p.teachers.find((t) => t.id === id)?.name ?? '?'
}
export function subjectNameOf(p, id) {
  return p.subjects.find((s) => s.id === id)?.name ?? '?'
}

/** 任务展示名：班级·科目·教师 */
export function assignmentLabel(p, a) {
  return `${classNameOf(p, a.classId)} · ${subjectNameOf(p, a.subjectId)} · ${teacherNameOf(p, a.teacherId)}`
}

/** 某任务所有单元的槽位数组（从 schedule 展开）；unitSize 依据科目 */
export function assignmentUnits(project, assignment) {
  const subj = project.subjects.find((s) => s.id === assignment.subjectId)
  const size = unitSizeOf(subj)
  const slots = project.schedule[assignment.id] ?? []
  const units = []
  for (let i = 0; i < slots.length; i += size) units.push(slots.slice(i, i + size))
  return units
}
