/**
 * 方案持久化与导入导出。
 * - 方案文件：JSON（经 broker 对话框 + 授权读写，自定义协议下 localStorage 不可靠）
 * - 会话防丢：sessionStorage 尽力而为（try/catch）
 * - 导出：xlsx（SheetJS）/ CSV（UTF-8 BOM）
 * - 导入：粘贴文本解析（教师/班级/科目/任务）
 */
import * as XLSX from 'xlsx'
import { toolbox } from '@toolbox/plugin-sdk'
import { emptyProject, guessSubjectProps, DEFAULT_RULES } from './solver/model.js'

const SESSION_KEY = 'course-scheduler.session'

// ---------- 会话缓存（尽力而为） ----------

export function sessionSave(project) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(project))
  } catch {
    /* 自定义协议下可能不可用，忽略 */
  }
}

export function sessionLoad() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return normalizeProject(JSON.parse(raw))
  } catch {
    return null
  }
}

// ---------- 方案文件（JSON） ----------

export function serializeProject(project) {
  return JSON.stringify({ app: 'course-scheduler', version: 1, ...project }, null, 2)
}

export function normalizeProject(raw) {
  const base = emptyProject()
  if (!raw || typeof raw !== 'object') return base
  const p = { ...base, ...raw }
  p.days = Array.isArray(p.days) && p.days.length ? p.days : base.days
  p.periods = Array.isArray(p.periods) && p.periods.length ? p.periods : base.periods
  for (const key of ['grades', 'classes', 'teachers', 'subjects', 'assignments']) {
    if (!Array.isArray(p[key])) p[key] = []
  }
  if (typeof p.classBlocked !== 'object' || !p.classBlocked) p.classBlocked = {}
  if (typeof p.schedule !== 'object' || !p.schedule) p.schedule = {}
  if (typeof p.rules !== 'object' || !p.rules) p.rules = { ...DEFAULT_RULES }
  else p.rules = { ...DEFAULT_RULES, ...p.rules }
  for (const s of p.subjects) {
    if (!('gradeId' in s)) s.gradeId = null
    if (typeof s.roomShared !== 'boolean') s.roomShared = false
  }
  // 清理指向已删实体的课表项
  const ids = new Set(p.assignments.map((a) => a.id))
  for (const key of Object.keys(p.schedule)) {
    if (!ids.has(key)) delete p.schedule[key]
  }
  return p
}

export async function savePlanFile(project) {
  const bytes = new TextEncoder().encode(serializeProject(project))
  const path = await toolbox.pickSaveFile({
    defaultName: '排课方案.json',
    filters: [{ name: '排课方案', extensions: ['json'] }],
    bytes,
  })
  return path ? { ok: true, path } : { ok: false, canceled: true }
}

export async function openPlanFile() {
  const files = await toolbox.pickOpenFile({
    filters: [{ name: '排课方案', extensions: ['json'] }],
  })
  if (!files.length) return { ok: false, canceled: true }
  const text = new TextDecoder().decode(files[0].bytes)
  return { ok: true, project: normalizeProject(JSON.parse(text)), path: files[0].path }
}

// ---------- 导出 ----------

function cellText(project, assignmentId) {
  const a = project.assignments.find((x) => x.id === assignmentId)
  if (!a) return ''
  const subj = project.subjects.find((s) => s.id === a.subjectId)
  const teacher = project.teachers.find((t) => t.id === a.teacherId)
  const cls = project.classes.find((c) => c.id === a.classId)
  return `${subj?.name ?? '?'} ${teacher?.name ?? '?'}${cls && subj?.double ? '（连堂）' : ''}`
}

/** 槽位 -> 首槽在此的 assignmentId（连堂占首槽） */
function slotStartMap(project) {
  const map = {}
  for (const [aid, slots] of Object.entries(project.schedule ?? {})) {
    for (const s of slots) map[s] = aid
  }
  return map
}

function gradeNameOf(project, cls) {
  return project.grades.find((g) => g.id === cls.gradeId)?.name ?? ''
}

/** 三张工作表：总课表 / 班级课表 / 教师课表 */
export function buildWorkbook(project) {
  const ppd = project.periods.length
  const days = project.days
  const nSlots = days.length * ppd
  const startMap = slotStartMap(project)

  const wb = XLSX.utils.book_new()

  // --- 总课表 ---
  const head1 = ['年级', '班级']
  const head2 = ['', '']
  const merges = []
  days.forEach((d, di) => {
    head1.push(d)
    for (let i = 1; i < ppd; i++) head1.push('')
    merges.push({
      s: { r: 0, c: 2 + di * ppd },
      e: { r: 0, c: 1 + (di + 1) * ppd },
    })
    for (const p of project.periods) head2.push(p.label)
  })
  merges.push({ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } })
  merges.push({ s: { r: 0, c: 1 }, e: { r: 1, c: 1 } })
  const masterAoa = [head1, head2]
  for (const cls of project.classes) {
    const row = [gradeNameOf(project, cls), cls.name]
    for (let s = 0; s < nSlots; s++) row.push(startMap[s] ? cellText(project, startMap[s]) : '')
    masterAoa.push(row)
  }
  const wsMaster = XLSX.utils.aoa_to_sheet(masterAoa)
  wsMaster['!merges'] = merges
  wsMaster['!cols'] = [{ wch: 8 }, { wch: 10 }, ...Array(nSlots).fill({ wch: 13 })]
  XLSX.utils.book_append_sheet(wb, wsMaster, '总课表')

  // --- 班级课表（逐班块状堆叠） ---
  const classAoa = []
  project.classes.forEach((cls, idx) => {
    if (idx > 0) classAoa.push([])
    classAoa.push([`${gradeNameOf(project, cls)} ${cls.name}`])
    classAoa.push(['节次', ...days])
    for (let p = 0; p < ppd; p++) {
      const row = [project.periods[p].label]
      for (let d = 0; d < days.length; d++) {
        const s = d * ppd + p
        row.push(startMap[s] ? cellText(project, startMap[s]) : '')
      }
      classAoa.push(row)
    }
  })
  const wsClass = XLSX.utils.aoa_to_sheet(classAoa)
  wsClass['!cols'] = [{ wch: 10 }, ...Array(days.length).fill({ wch: 18 })]
  XLSX.utils.book_append_sheet(wb, wsClass, '班级课表')

  // --- 教师课表 ---
  const teacherAoa = []
  project.teachers.forEach((t, idx) => {
    if (idx > 0) teacherAoa.push([])
    teacherAoa.push([t.name])
    teacherAoa.push(['节次', ...days])
    for (let p = 0; p < ppd; p++) {
      const row = [project.periods[p].label]
      for (let d = 0; d < days.length; d++) {
        const s = d * ppd + p
        const aid = startMap[s]
        if (!aid) {
          row.push('')
          continue
        }
        const a = project.assignments.find((x) => x.id === aid)
        if (a?.teacherId !== t.id) {
          row.push('')
          continue
        }
        const cls = project.classes.find((c) => c.id === a.classId)
        row.push(cls ? cls.name : '')
      }
      teacherAoa.push(row)
    }
  })
  const wsTeacher = XLSX.utils.aoa_to_sheet(teacherAoa)
  wsTeacher['!cols'] = [{ wch: 10 }, ...Array(days.length).fill({ wch: 14 })]
  XLSX.utils.book_append_sheet(wb, wsTeacher, '教师课表')

  return wb
}

export async function exportXlsx(project) {
  const wb = buildWorkbook(project)
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const path = await toolbox.pickSaveFile({
    defaultName: '课表.xlsx',
    filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
    bytes,
  })
  return path ? { ok: true, path } : { ok: false, canceled: true }
}

function csvEscape(v) {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildMasterCsv(project) {
  const ppd = project.periods.length
  const startMap = slotStartMap(project)
  const lines = []
  lines.push(['年级', '班级', ...project.days.flatMap((d) => project.periods.map((p) => `${d}${p.label}`))].map(csvEscape).join(','))
  for (const cls of project.classes) {
    const row = [gradeNameOf(project, cls), cls.name]
    for (let s = 0; s < project.days.length * ppd; s++) {
      row.push(startMap[s] ? cellText(project, startMap[s]) : '')
    }
    lines.push(row.map(csvEscape).join(','))
  }
  return '\uFEFF' + lines.join('\r\n')
}

export async function exportCsv(project) {
  const bytes = new TextEncoder().encode(buildMasterCsv(project))
  const path = await toolbox.pickSaveFile({
    defaultName: '课表.csv',
    filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
    bytes,
  })
  return path ? { ok: true, path } : { ok: false, canceled: true }
}

// ---------- 粘贴导入 ----------

function parseLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function splitLine(line) {
  return line
    .split(/\t|,|，/)
    .map((c) => c.trim())
    .filter(Boolean)
}

export function parseTeachers(text) {
  const seen = new Set()
  const items = []
  const errors = []
  parseLines(text).forEach((line, i) => {
    const name = splitLine(line)[0]
    if (!name) return
    if (seen.has(name)) {
      errors.push(`第 ${i + 1} 行：教师「${name}」重复`)
      return
    }
    seen.add(name)
    items.push({ name })
  })
  return { items, errors }
}

export function parseClasses(text) {
  const items = []
  const errors = []
  parseLines(text).forEach((line, i) => {
    const cols = splitLine(line)
    if (!cols.length) return
    if (cols.length >= 2) items.push({ grade: cols[0], name: cols[1] })
    else items.push({ grade: null, name: cols[0] })
    if (cols.length > 2) errors.push(`第 ${i + 1} 行：多余列已忽略`)
  })
  return { items, errors }
}

export function parseSubjects(text, grades = []) {
  const gradeByName = new Map(grades.map((g) => [g.name, g]))
  const seen = new Set()
  const items = []
  const errors = []
  parseLines(text).forEach((line, i) => {
    const cols = splitLine(line)
    const name = cols[0]
    if (!name) return
    // 每行：科目 [<Tab>周课时] [<Tab>年级]
    let gradeId = null
    if (cols[2]) {
      const g = gradeByName.get(cols[2])
      if (g) gradeId = g.id
      else errors.push(`第 ${i + 1} 行：找不到年级「${cols[2]}」`)
    }
    const key = `${name}::${gradeId ?? ''}`
    if (seen.has(key)) {
      errors.push(`第 ${i + 1} 行：科目「${name}」${gradeId ? '在该年级已定义' : ''}重复`)
      return
    }
    seen.add(key)
    const props = guessSubjectProps(name)
    const weekly = Number(cols[1])
    if (Number.isFinite(weekly) && weekly > 0) props.weekly = Math.round(weekly)
    items.push({ name, gradeId, ...props })
  })
  return { items, errors }
}

/** 任务行：班级 [sep] 科目 [sep] 教师 [sep 周课时?]，名称按精确匹配解析 */
export function parseAssignments(text, project) {
  const items = []
  const errors = []
  const classByName = new Map(project.classes.map((c) => [c.name, c]))
  const subjByName = new Map(project.subjects.map((s) => [s.name, s]))
  const teacherByName = new Map(project.teachers.map((t) => [t.name, t]))
  parseLines(text).forEach((line, i) => {
    const cols = splitLine(line)
    if (cols.length < 3) {
      errors.push(`第 ${i + 1} 行：需为「班级<Tab>科目<Tab>教师[<Tab>周课时]」`)
      return
    }
    const [clsName, subjName, teacherName, periodsRaw] = cols
    const cls = classByName.get(clsName)
    if (!cls) {
      errors.push(`第 ${i + 1} 行：找不到班级「${clsName}」`)
      return
    }
    const subj = subjByName.get(subjName)
    if (subj && subj.gradeId && subj.gradeId !== cls.gradeId) {
      // 同名科目按年级区分：优先取与该班年级匹配（或全局）的那一个
      const matched = project.subjects.find(
        (s) => s.name === subjName && (!s.gradeId || s.gradeId === cls.gradeId)
      )
      if (matched) items.push({
        classId: cls.id,
        subjectId: matched.id,
        teacherId: teacher.id,
        periods: Number.isFinite(periods) && periods > 0 ? Math.round(periods) : matched.weekly,
      })
      else errors.push(`第 ${i + 1} 行：科目「${subjName}」不适用于班级「${clsName}」的年级`)
      return
    }
    if (!subj) {
      errors.push(`第 ${i + 1} 行：找不到科目「${subjName}」`)
      return
    }
    const teacher = teacherByName.get(teacherName)
    if (!teacher) {
      errors.push(`第 ${i + 1} 行：找不到教师「${teacherName}」`)
      return
    }
    const periods = Number(periodsRaw)
    items.push({
      classId: cls.id,
      subjectId: subj.id,
      teacherId: teacher.id,
      periods: Number.isFinite(periods) && periods > 0 ? Math.round(periods) : subj.weekly,
    })
  })
  return { items, errors }
}
