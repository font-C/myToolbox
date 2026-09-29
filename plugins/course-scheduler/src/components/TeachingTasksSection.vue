<script setup>
import { usePlannerStore } from '../store.js'

const store = usePlannerStore()

const gradeNameOf = (c) =>
  store.project.grades.find((g) => g.id === c.gradeId)?.name ?? ''
const tasksOfClass = (classId) =>
  store.project.assignments.filter((a) => a.classId === classId)
const subjName = (subjectId) =>
  store.project.subjects.find((s) => s.id === subjectId)?.name ?? '？'
const teacherIdOf = (a) => a.teacherId ?? ''

function sync() {
  store.syncAssignmentsFromSubjects()
}
function setTeacher(a, e) {
  store.updateAssignment(a.id, { teacherId: e.target.value || null })
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <h2 class="page__title">教学任务</h2>
      <p class="page__desc">
        每个班自动开出它所在年级适用的全部科目（由「科目」页的年级定义决定），您只需为每条任务指定授课教师。
        点击「按科目生成」可随科目/班级变化重建组合，已配教师会保留。
      </p>
    </header>

    <div class="card">
      <div class="card__toolbar">
        <div class="card__title">
          教学任务
          <span class="card__sub">未配教师 {{ store.project.assignments.filter((a) => !a.teacherId).length }} 条</span>
        </div>
        <div class="toolbar-btns">
          <button class="btn btn--primary" @click="sync">按科目生成</button>
        </div>
      </div>

      <template v-if="store.project.classes.length && store.project.subjects.length">
        <table v-if="store.project.teachers.length" class="table">
          <thead>
            <tr>
              <th class="col1">班级</th>
              <th>科目</th>
              <th>教师</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="c in store.project.classes" :key="c.id">
              <tr class="group-row">
                <td colspan="3">
                  <span class="group-name">{{ c.name }}</span>
                  <span class="group-grade">{{ gradeNameOf(c) }}</span>
                </td>
              </tr>
              <tr
                v-for="a in tasksOfClass(c.id)"
                :key="a.id"
                class="task-row"
                :class="{ 'task-row--noperson': !a.teacherId }"
              >
                <td class="col1"></td>
                <td class="cell-subject">{{ subjName(a.subjectId) }}</td>
                <td>
                  <select class="input select" :value="teacherIdOf(a)" @change="setTeacher(a, $event)">
                    <option value="">（请选择教师）</option>
                    <option v-for="t in store.project.teachers" :key="t.id" :value="t.id">{{ t.name }}</option>
                  </select>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <div v-else class="empty">还没有教师，请先到「教师」页添加</div>
      </template>
      <div v-else class="empty">
        请先在「班级」与「科目」页完成定义，再到这里按科目生成教学任务
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { max-width: 800px; padding: 24px 28px 40px; }
.page__head { margin-bottom: 16px; }
.page__title { margin: 0; font-size: 20px; }
.page__desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--c-text-muted);
  line-height: 1.6;
}
.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 14px;
}
.card__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.card__title { font-size: 14px; font-weight: 600; }
.card__sub { margin-left: 8px; font-size: 12px; font-weight: 400; color: #d97706; }
.toolbar-btns { display: flex; gap: 8px; }
.table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.table th, .table td {
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid var(--c-border);
}
.group-row td { border-bottom: 1px dashed var(--c-border); }
.group-name { font-weight: 600; }
.group-grade { margin-left: 8px; font-size: 12px; color: var(--c-text-muted); }
.col1 { width: 33%; }
.cell-subject { width: 34%; white-space: nowrap; }
.task-row--noperson .cell-subject { color: #d97706; }
.empty { padding: 18px; text-align: center; color: var(--c-text-muted); font-size: 13px; }
.input {
  border: 1px solid var(--c-border);
  border-radius: 8px;
  padding: 5px 9px;
  font-size: 13px;
  background: var(--c-surface);
  color: var(--c-text);
  outline: none;
}
.input:focus { border-color: var(--c-primary); }
.select { min-width: 160px; }
</style>