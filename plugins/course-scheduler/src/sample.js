/**
 * 示例数据：初一年级 4 个班，教师跨班带课，用于快速体验与求解器自检。
 */
import { emptyProject, periodsFromPreset, uid } from './solver/model.js'

export function loadSampleProject() {
  const p = emptyProject()
  p.periods = periodsFromPreset(4, 4) // 上午4节 + 下午4节，共 35 槽

  const grade = { id: uid('g'), name: '七年级' }
  p.grades.push(grade)
  for (const n of ['七（1）班', '七（2）班', '七（3）班', '七（4）班']) {
    p.classes.push({ id: uid('c'), name: n, gradeId: grade.id })
  }

  const subjects = [
    ['语文', { isMajor: true, weekly: 5 }],
    ['数学', { isMajor: true, weekly: 5 }],
    ['英语', { isMajor: true, weekly: 5 }],
    ['道德与法治', { weekly: 2 }],
    ['历史', { weekly: 2 }],
    ['地理', { weekly: 2 }],
    ['生物', { weekly: 2 }],
    ['体育', { isPe: true, weekly: 3 }],
    ['信息技术', { double: true, weekly: 2 }],
    ['音乐', { weekly: 1 }],
    ['美术', { weekly: 1 }],
    ['班会', { weekly: 1 }],
  ]
  const subjByName = {}
  for (const [name, props] of subjects) {
    const s = { id: uid('s'), name, isMajor: false, isPe: false, double: false, weekly: 2, ...props }
    p.subjects.push(s)
    subjByName[name] = s
  }

  // 教师：主科各 2 人（每人带 2 个班），其余 1 人带全年级
  const teacherPlan = [
    ['语文', ['王老师', '李老师']],
    ['数学', ['张老师', '刘老师']],
    ['英语', ['陈老师', '赵老师']],
    ['道德与法治', ['孙老师']],
    ['历史', ['周老师']],
    ['地理', ['吴老师']],
    ['生物', ['郑老师']],
    ['体育', ['杨老师', '黄老师']],
    ['信息技术', ['徐老师']],
    ['音乐', ['何老师']],
    ['美术', ['高老师']],
    ['班会', ['班主任']],
  ]
  const teacherByName = {}
  for (const [subjName, names] of teacherPlan) {
    for (const n of names) {
      const t = { id: uid('t'), name: n, unavailable: [] }
      p.teachers.push(t)
      teacherByName[n] = t
    }
  }

  // 班主任 = 该班语文老师（班会由其承担），体现教师跨科目场景
  const chineseTeachers = ['王老师', '李老师']
  const clsTeachers = {}
  p.classes.forEach((c, i) => {
    clsTeachers[c.id] = chineseTeachers[i % 2]
  })

  // 分配任务：主科两位教师轮流带班，其余科目全年级一位教师
  const classAssign = {}
  for (const c of p.classes) classAssign[c.id] = []
  for (const c of p.classes) {
    for (const [name] of subjects) {
      let teacherName
      if (name === '班会') teacherName = clsTeachers[c.id]
      else {
        const pair = teacherPlan.find(([sn]) => sn === name)[1]
        teacherName = pair[p.classes.indexOf(c) % pair.length]
      }
      p.assignments.push({
        id: uid('a'),
        classId: c.id,
        subjectId: subjByName[name].id,
        teacherId: teacherByName[teacherName].id,
        periods: subjByName[name].weekly,
      })
    }
  }

  // 周三下午第 1 节全校班会/活动（班级不可用）
  const wedPmFirst = 2 * p.periods.length + 4
  for (const c of p.classes) p.classBlocked[c.id] = [wedPmFirst]
  // 徐老师周二上午不可用（教研）
  const tueAm1 = 1 * p.periods.length + 0
  teacherByName['徐老师'].unavailable = [tueAm1, tueAm1 + 1]

  return p
}
