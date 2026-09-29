/**
 * 示例数据：七/八/九年级各 5 个班。
 * 科目按年级拆分（gradeId=null 表示所有年级）：语文/数学/英语周课时 8，作文连堂，
 * 物理覆盖八/九年级、化学限九年级，电脑（七八年级共用教室）/音乐（七八年级）。
 * 配晚间时段以容纳 41 节/周。
 */
import { emptyProject, defaultPeriods, uid } from './solver/model.js'

export function loadSampleProject() {
  const p = emptyProject()
  p.periods = defaultPeriods() // 早1 + 上午4 + 下午4 + 晚上2 = 11 节/天 = 55 槽
  const ppd = p.periods.length // 11

  // ---- 年级与班级：七/八/九年级各 5 班 ----
  const addGrade = (name) => {
    const g = { id: uid('g'), name }
    p.grades.push(g)
    return g
  }
  const g7 = addGrade('七年级')
  const g8 = addGrade('八年级')
  const g9 = addGrade('九年级')
  const gradeClasses = [
    [g7, ['七（1）班', '七（2）班', '七（3）班', '七（4）班', '七（5）班']],
    [g8, ['八（1）班', '八（2）班', '八（3）班', '八（4）班', '八（5）班']],
    [g9, ['九（1）班', '九（2）班', '九（3）班', '九（4）班', '九（5）班']],
  ]
  for (const [g, names] of gradeClasses) {
    for (const n of names) p.classes.push({ id: uid('c'), name: n, gradeId: g.id })
  }

  // ---- 科目（多年级科目按年级拆分为多条，gradeId=null = 所有年级）----
  const subj = (name, props) => {
    const s = {
      id: uid('s'), name, gradeId: null,
      isMajor: false, isPe: false, double: false, weekly: 2, roomShared: false,
      ...props,
    }
    p.subjects.push(s)
    return s
  }
  const S = {}
  S.语文 = subj('语文', { isMajor: true, weekly: 8 })
  S.数学 = subj('数学', { isMajor: true, weekly: 8 })
  S.英语 = subj('英语', { isMajor: true, weekly: 8 })
  S.作文 = subj('作文', { double: true, weekly: 2 }) // 连堂
  S.英阅 = subj('英阅', { weekly: 1 })
  S.政治 = subj('政治', { weekly: 2 })
  S.历史 = subj('历史', { weekly: 2 })
  S.地理7 = subj('地理', { weekly: 2, gradeId: g7.id })
  S.生物7 = subj('生物', { weekly: 2, gradeId: g7.id })
  S.物理8 = subj('物理', { weekly: 5, gradeId: g8.id })
  S.物理9 = subj('物理', { weekly: 5, gradeId: g9.id })
  S.化学9 = subj('化学', { weekly: 5, gradeId: g9.id })
  S.体育 = subj('体育', { isPe: true, weekly: 2 })
  S.电脑7 = subj('电脑', { weekly: 2, gradeId: g7.id, roomShared: true }) // 共用教室
  S.电脑8 = subj('电脑', { weekly: 2, gradeId: g8.id, roomShared: true }) // 共用教室
  S.音乐7 = subj('音乐', { weekly: 1, gradeId: g7.id })
  S.音乐8 = subj('音乐', { weekly: 1, gradeId: g8.id })

  // ---- 教师池（主科多师带班，副科 1~2 师带全年级/对应年级）----
  const teacherPool = {
    语文: ['王琳', '李雪', '刘梅', '赵蕾', '孙红', '周燕', '吴倩', '郑静'],
    数学: ['张雄', '刘强', '陈康', '王斌', '李虎', '朱峰', '赵博', '钱锐'],
    英语: ['陈琳', '赵飞', '陈静', '李娜', '王丽', '张婷', '刘芳', '杨露'],
    政治: ['孙政'],
    历史: ['周仪'],
    地理: ['吴山'],
    生物: ['郑禾'],
    物理: ['付力学', '毕国物'],
    化学: ['钱化'],
    体育: ['杨体', '黄动'],
    电脑: ['徐机'],
    音乐: ['何音'],
  }
  const teacherByName = {}
  for (const [subjName, names] of Object.entries(teacherPool)) {
    for (const n of names) {
      const t = { id: uid('t'), name: n, unavailable: [] }
      p.teachers.push(t)
      teacherByName[n] = t
    }
  }
  const poolOf = (k) => teacherPool[k]

  // ---- 每个年级的科目清单（顺序即任务列顺序）----
  const subjectSet = {
    [g7.id]: ['语文', '数学', '英语', '作文', '英阅', '政治', '历史', '地理', '生物', '体育', '电脑', '音乐'],
    [g8.id]: ['语文', '数学', '英语', '作文', '英阅', '政治', '历史', '物理', '体育', '电脑', '音乐'],
    [g9.id]: ['语文', '数学', '英语', '作文', '英阅', '政治', '历史', '物理', '化学', '体育'],
  }
  const subjOf = (cls, name) => {
    if (name === '物理') return cls.gradeId === g9.id ? S.物理9 : S.物理8
    if (name === '电脑') return cls.gradeId === g8.id ? S.电脑8 : S.电脑7
    if (name === '音乐') return cls.gradeId === g8.id ? S.音乐8 : S.音乐7
    if (name === '地理') return S.地理7
    if (name === '生物') return S.生物7
    if (name === '化学') return S.化学9
    return S[name]
  }

  // 作文/英阅 由该班语文/英语老师兼带（跨科目），其余按池轮转
  p.classes.forEach((cls, idx) => {
    const subjNames = subjectSet[cls.gradeId]
    for (const sn of subjNames) {
      const s = subjOf(cls, sn)
      let teacherName
      if (sn === '作文') teacherName = poolOf('语文')[idx % poolOf('语文').length]
      else if (sn === '英阅') teacherName = poolOf('英语')[idx % poolOf('英语').length]
      else {
        const pair = poolOf(sn)
        teacherName = pair[idx % pair.length]
      }
      p.assignments.push({
        id: uid('a'),
        classId: cls.id,
        subjectId: s.id,
        teacherId: teacherByName[teacherName].id,
        periods: s.weekly,
      })
    }
  })

  // 周三下午第 1 节全校活动（班级不可用）
  const wedPmFirst = 2 * ppd + 5 // 周三(day2)·下午第1节(index5)
  for (const c of p.classes) p.classBlocked[c.id] = [wedPmFirst]
  // 徐老师（电脑）周二上午第 1-2 节教研（教师不可用）
  const tueAm1 = 1 * ppd + 1 // 周二(day1)·上午第1节(index1)
  teacherByName['徐机'].unavailable = [tueAm1, tueAm1 + 1]

  return p
}