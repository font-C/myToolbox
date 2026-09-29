<script setup>
import { ref, computed } from 'vue'
import { usePlannerStore } from '../store.js'
import { parseTeachers } from '../io.js'

const store = usePlannerStore()
const selectedTeacherId = ref('')
const newTeacherName = ref('')
const tImportOpen = ref(false)
const tImportText = ref('')
const tImportReport = ref(null)

function toggleTeacherImport() {
  tImportOpen.value = !tImportOpen.value
  tImportText.value = ''
  tImportReport.value = null
}
function runTeacherImport() {
  tImportReport.value = parseTeachers(tImportText.value)
}
function applyTeacherImport() {
  if (!tImportReport.value) return
  const { items } = tImportReport.value
  let added = 0
  for (const it of items) {
    if (!store.project.teachers.some((t) => t.name === it.name)) {
      store.addTeacher(it.name)
      added++
    }
  }
  store.notify(`已导入 ${added} 位教师`, 'ok')
  toggleTeacherImport()
}

const selectedTeacher = computed(() =>
  store.project.teachers.find((t) => t.id === selectedTeacherId.value)
)
/** 该教师承担的任务 */
const teacherTasks = computed(() => {
  if (!selectedTeacher.value) return []
  return store.project.assignments.filter((a) => a.teacherId === selectedTeacher.value.id)
})
const taskLabel = (a) => {
  const cls = store.project.classes.find((c) => c.id === a.classId)?.name ?? '?'
  const subj = store.project.subjects.find((s) => s.id === a.subjectId)?.name ?? '?'
  return `${cls}·${subj}（${a.periods}节）`
}

function addTeacher() {
  const name = newTeacherName.value.trim()
  if (!name) {
    store.notify('请输入教师姓名', 'warn')
    return
  }
  const t = store.addTeacher(name)
  newTeacherName.value = ''
  selectedTeacherId.value = t.id
}
function removeTeacher(t) {
  store
    .confirm(
      `删除教师「${t.name}」会同时删除其全部教学任务与课表，确定？`,
      { danger: true }
    )
    .then((ok) => {
      if (ok) {
        if (selectedTeacherId.value === t.id) selectedTeacherId.value = ''
        store.removeTeacher(t.id)
      }
    })
}

function slotBlocked(teacherId, slot) {
  return (store.project.teachers.find((t) => t.id === teacherId)?.unavailable ?? []).includes(slot)
}
function toggleBlocked(teacherId, slot) {
  store.toggleTeacherUnavailable(teacherId, slot)
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <h2 class="page__title">教师</h2>
      <p class="page__desc">
        管理教师名单与不可用时段（教研活动、请假等）。同一时段每位教师只能在一个班上课。
      </p>
    </header>

    <div class="card">
      <div class="card__toolbar">
        <div class="card__title">教师列表（{{ store.project.teachers.length }}）</div>
        <button class="btn" @click="toggleTeacherImport">
          {{ tImportOpen ? '收起' : '批量导入' }}
        </button>
      </div>
      <div class="add-row">
        <input
          v-model="newTeacherName"
          class="input"
          placeholder="教师姓名"
          @keyup.enter="addTeacher"
        />
        <button class="btn btn--primary" @click="addTeacher">＋ 教师</button>
      </div>

      <div v-if="tImportOpen" class="import-box">
        <div class="import-box__hint">每行一位教师姓名，例如：</div>
        <textarea v-model="tImportText" class="textarea" rows="5" placeholder="王老师&#10;李老师&#10;张老师"></textarea>
        <div class="import-box__actions">
          <button class="btn" @click="runTeacherImport">解析</button>
          <button
            v-if="tImportReport && tImportReport.items.length"
            class="btn btn--primary"
            @click="applyTeacherImport"
          >
            导入 {{ tImportReport.items.length }} 位
          </button>
        </div>
        <div v-if="tImportReport && tImportReport.errors.length" class="import-errors">
          <div v-for="(e, i) in tImportReport.errors" :key="i" class="import-errors__item">⚠ {{ e }}</div>
        </div>
      </div>
      <table v-if="store.project.teachers.length" class="table">
        <thead>
          <tr>
            <th>姓名</th>
            <th>承担任务</th>
            <th>周课时</th>
            <th>不可用时段</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in store.project.teachers"
            :key="t.id"
            :class="{ 'row--active': selectedTeacherId === t.id }"
            @click="selectedTeacherId = t.id"
          >
            <td>
              <input
                class="input input--plain"
                :value="t.name"
                @change="store.updateTeacher(t.id, { name: $event.target.value.trim() || t.name })"
                @click.stop
              />
            </td>
            <td class="muted">
              {{
                store.project.assignments.filter((a) => a.teacherId === t.id).length || '—'
              }}
            </td>
            <td>
              {{
                store.project.assignments
                  .filter((a) => a.teacherId === t.id)
                  .reduce((s, a) => s + a.periods, 0)
              }}
            </td>
            <td class="muted">{{ (t.unavailable ?? []).length || '—' }}</td>
            <td class="cell-danger" @click.stop>
              <button class="btn btn--icon" title="删除教师" @click="removeTeacher(t)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">还没有教师，点击「＋ 教师」添加</div>
    </div>

    <div v-if="selectedTeacher" class="card">
      <div class="card__title">
        「{{ selectedTeacher.name }}」不可用时段
        <span class="hint">（点击格子切换，已排在该时段的课会被自动移出）</span>
      </div>
      <table class="grid-table">
        <thead>
          <tr>
            <th class="grid-table__corner"></th>
            <th v-for="(d, di) in store.project.days" :key="di">{{ d }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, pi) in store.project.periods" :key="pi">
            <th class="grid-table__head" :class="'th--' + p.session">
              {{ p.label }}
            </th>
            <td v-for="(d, di) in store.project.days" :key="di">
              <button
                class="slot"
                :class="{ 'slot--blocked': slotBlocked(selectedTeacher.id, di * store.ppd + pi) }"
                :title="`${d} ${p.label}`"
                @click="toggleBlocked(selectedTeacher.id, di * store.ppd + pi)"
              ></button>
            </td>
          </tr>
        </tbody>
      </table>

      <template v-if="teacherTasks.length">
        <div class="card__title" style="margin-top: 16px">承担任务（{{ teacherTasks.length }}）</div>
        <div class="task-chips">
          <span v-for="a in teacherTasks" :key="a.id" class="task-chip">{{ taskLabel(a) }}</span>
        </div>
      </template>
    </div>
    <div v-else-if="store.project.teachers.length" class="tip-line">
      提示：在上方列表中选中一位教师，可设置其不可用时段并查看承担任务。
    </div>
  </section>
</template>

<style scoped>
.page { max-width: 860px; padding: 24px 28px 40px; }
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
  margin-bottom: 10px;
}
.add-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.card__title { font-size: 14px; font-weight: 600; }
.card__title .hint { font-weight: 400; font-size: 12px; color: var(--c-text-muted); }
.table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.table th, .table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--c-border);
}
.table tbody tr { cursor: pointer; }
.table tbody tr:hover { background: var(--c-bg); }
.row--active { background: #eff6ff; }
.cell-danger { text-align: right; }
.muted { color: var(--c-text-muted); }
.empty, .tip-line {
  padding: 20px;
  text-align: center;
  color: var(--c-text-muted);
  font-size: 13px;
}
.tip-line { text-align: left; padding: 4px 2px; }
.input {
  border: 1px solid var(--c-border);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
  background: var(--c-surface);
  color: var(--c-text);
  outline: none;
}
.input:focus { border-color: var(--c-primary); }
.input--plain { border-color: transparent; background: transparent; width: 110px; }
.input--plain:hover, .input--plain:focus { border-color: var(--c-border); }
.grid-table { border-collapse: collapse; margin-top: 4px; }
.grid-table th, .grid-table td { border: 1px solid var(--c-border); padding: 3px; }
.grid-table__corner { border: 0 !important; }
.grid-table__head {
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px !important;
  white-space: nowrap;
}
.th--am { color: #1d4ed8; }
.th--pm { color: #b45309; }
.th--dawn { color: #a21caf; }
.th--eve { color: #7c3aed; }
.slot {
  width: 44px;
  height: 26px;
  border: 1px solid var(--c-border);
  border-radius: 6px;
  background: var(--c-bg);
  cursor: pointer;
  display: block;
}
.slot--blocked {
  background: repeating-linear-gradient(45deg, #fecaca, #fecaca 4px, #fee2e2 4px, #fee2e2 8px);
  border-color: #fca5a5;
}
.task-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.task-chip {
  background: var(--c-bg);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12.5px;
}
.import-box {
  background: var(--c-bg);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.import-box__hint { font-size: 12.5px; color: var(--c-text-muted); margin-bottom: 8px; }
.import-box__actions { display: flex; gap: 8px; margin-top: 8px; }
.import-errors { margin-top: 8px; }
.import-errors__item { font-size: 12.5px; color: #b45309; margin-top: 4px; }
.textarea {
  width: 100%;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  color: var(--c-text);
  background: var(--c-surface);
}
.textarea:focus { border-color: var(--c-primary); }
</style>
