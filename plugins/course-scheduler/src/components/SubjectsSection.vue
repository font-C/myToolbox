<script setup>
import { ref, computed } from 'vue'
import { usePlannerStore } from '../store.js'
import { parseTeachers, parseClasses, parseSubjects, parseAssignments } from '../io.js'
import { guessSubjectProps } from '../solver/model.js'

const store = usePlannerStore()
const importTab = ref('')
const importText = ref('')
const importReport = ref(null)
const newSubjectName = ref('')

function addSubject() {
  const name = newSubjectName.value.trim()
  if (!name) {
    store.notify('请输入科目名称', 'warn')
    return
  }
  store.addSubject(name, guessSubjectProps(name))
  newSubjectName.value = ''
}

const warnOf = (a) => {
  const subj = store.project.subjects.find((s) => s.id === a.subjectId)
  if (!subj) return ''
  return subj.double && a.periods % 2 !== 0 ? '连堂科目课时须为偶数' : ''
}

function removeSubject(s) {
  store
    .confirm(`删除科目「${s.name}」会同时删除相关教学任务与课表，确定？`, { danger: true })
    .then((ok) => ok && store.removeSubject(s.id))
}

function addAssignment() {
  if (!store.project.classes.length || !store.project.subjects.length || !store.project.teachers.length) {
    store.notify('请先完善班级、科目与教师', 'warn')
    return
  }
  store.addAssignment(
    store.project.classes[0].id,
    store.project.subjects[0].id,
    store.project.teachers[0].id
  )
}
function removeAssignment(a) {
  store.removeAssignment(a.id)
}

function openImport(tab) {
  importTab.value = importTab.value === tab ? '' : tab
  importText.value = ''
  importReport.value = null
}

function runImport() {
  const text = importText.value
  let result
  if (importTab.value === 'teachers') result = parseTeachers(text)
  else if (importTab.value === 'classes') result = parseClasses(text)
  else if (importTab.value === 'subjects') result = parseSubjects(text)
  else if (importTab.value === 'assignments') result = parseAssignments(text, store.project)
  importReport.value = result
}

function applyImport() {
  if (!importReport.value) return
  const { items } = importReport.value
  if (importTab.value === 'teachers') {
    for (const it of items) if (!store.project.teachers.some((t) => t.name === it.name)) store.addTeacher(it.name)
  } else if (importTab.value === 'classes') {
    const gradeCache = new Map()
    for (const it of items) {
      let gradeId = null
      if (it.grade) {
        if (!gradeCache.has(it.grade)) {
          const existing = store.project.grades.find((g) => g.name === it.grade)
          gradeCache.set(it.grade, existing ? existing.id : store.addGrade(it.grade).id)
        }
        gradeId = gradeCache.get(it.grade)
      }
      if (!store.project.classes.some((c) => c.name === it.name)) store.addClass(it.name, gradeId)
    }
  } else if (importTab.value === 'subjects') {
    for (const it of items) if (!store.project.subjects.some((s) => s.name === it.name)) store.addSubject(it.name, it)
  } else if (importTab.value === 'assignments') {
    for (const it of items) store.addAssignment(it.classId, it.subjectId, it.teacherId, it.periods)
  }
  store.notify(`已导入 ${items.length} 条数据`, 'ok')
  importTab.value = ''
  importText.value = ''
  importReport.value = null
}

const importHint = computed(
  () =>
    ({
      teachers: '每行一位教师姓名',
      classes: '每行一个班级，可为「年级<Tab>班级」两列',
      subjects: '每行「科目[<Tab>周课时]」，主科/体育/连堂按名称自动识别，可再手动调整',
      assignments: '每行「班级<Tab>科目<Tab>教师[<Tab>周课时]」，名称需与列表一致',
    }[importTab.value] ?? '')
)
const importPlaceholder = computed(
  () =>
    ({
      teachers: '王老师\n李老师\n张老师',
      classes: '七年级\t七（1）班\n七年级\t七（2）班',
      subjects: '语文\t5\n数学\t5\n体育\t3',
      assignments: '七（1）班\t语文\t王老师\t5\n七（1）班\t数学\t张老师\t5',
    }[importTab.value] ?? '')
)
</script>

<template>
  <section class="page">
    <header class="page__head">
      <h2 class="page__title">科目与教学任务</h2>
      <p class="page__desc">
        科目定义属性（主科优先上午黄金时段、体育避开饭点、连堂科目两节连排）；
        教学任务指明「哪个班、哪门课、哪位老师、每周几节」。
      </p>
    </header>

    <div class="card">
      <div class="card__toolbar">
        <div class="card__title">科目（{{ store.project.subjects.length }}）</div>
        <button class="btn" @click="openImport('subjects')">粘贴导入</button>
      </div>

      <div class="add-row">
        <input
          v-model="newSubjectName"
          class="input"
          placeholder="科目名称，如：语文"
          @keyup.enter="addSubject"
        />
        <button class="btn btn--primary" @click="addSubject">＋ 科目</button>
      </div>

      <div v-if="importTab === 'subjects'" class="import-box">
        <div class="import-box__hint">{{ importHint }}</div>
        <textarea v-model="importText" class="textarea" rows="5" :placeholder="importPlaceholder"></textarea>
        <div class="import-box__actions">
          <button class="btn" @click="runImport">解析</button>
          <button
            v-if="importReport && importReport.items.length"
            class="btn btn--primary"
            @click="applyImport"
          >
            导入 {{ importReport.items.length }} 条
          </button>
        </div>
      </div>

      <table v-if="store.project.subjects.length" class="table">
        <thead>
          <tr>
            <th>科目</th>
            <th>默认周课时</th>
            <th>主科</th>
            <th>体育</th>
            <th>连堂</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in store.project.subjects" :key="s.id">
            <td>
              <input
                class="input input--plain"
                :value="s.name"
                @change="store.updateSubject(s.id, { name: $event.target.value.trim() || s.name })"
              />
            </td>
            <td>
              <input
                type="number"
                class="input num"
                min="0"
                max="20"
                :value="s.weekly"
                @change="store.updateSubject(s.id, { weekly: Math.max(0, Math.round(Number($event.target.value) || 0)) })"
              />
            </td>
            <td><input type="checkbox" :checked="s.isMajor" @change="store.updateSubject(s.id, { isMajor: $event.target.checked })" /></td>
            <td><input type="checkbox" :checked="s.isPe" @change="store.updateSubject(s.id, { isPe: $event.target.checked })" /></td>
            <td><input type="checkbox" :checked="s.double" @change="store.updateSubject(s.id, { double: $event.target.checked })" /></td>
            <td class="cell-danger">
              <button class="btn btn--icon" title="删除科目" @click="removeSubject(s)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">还没有科目</div>
    </div>

    <div class="card">
      <div class="card__toolbar">
        <div class="card__title">教学任务（{{ store.project.assignments.length }}）</div>
        <div class="toolbar-btns">
          <button class="btn" @click="openImport('assignments')">粘贴导入</button>
          <button class="btn btn--primary" @click="addAssignment">＋ 任务</button>
        </div>
      </div>

      <div v-if="importTab === 'assignments'" class="import-box">
        <div class="import-box__hint">{{ importHint }}</div>
        <textarea v-model="importText" class="textarea" rows="6" :placeholder="importPlaceholder"></textarea>
        <div class="import-box__actions">
          <button class="btn" @click="runImport">解析</button>
          <button
            v-if="importReport && importReport.items.length"
            class="btn btn--primary"
            @click="applyImport"
          >
            导入 {{ importReport.items.length }} 条
          </button>
        </div>
      </div>

      <table v-if="store.project.assignments.length" class="table">
        <thead>
          <tr>
            <th>班级</th>
            <th>科目</th>
            <th>教师</th>
            <th>周课时</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in store.project.assignments" :key="a.id">
            <td>
              <select class="input select" :value="a.classId" @change="store.updateAssignment(a.id, { classId: $event.target.value })">
                <option v-for="c in store.project.classes" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </td>
            <td>
              <select class="input select" :value="a.subjectId" @change="store.updateAssignment(a.id, { subjectId: $event.target.value })">
                <option v-for="s in store.project.subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </td>
            <td>
              <select class="input select" :value="a.teacherId" @change="store.updateAssignment(a.id, { teacherId: $event.target.value })">
                <option v-for="t in store.project.teachers" :key="t.id" :value="t.id">{{ t.name }}</option>
              </select>
            </td>
            <td>
              <input
                type="number"
                class="input num"
                min="1"
                max="20"
                :value="a.periods"
                @change="store.updateAssignment(a.id, { periods: Math.max(1, Math.round(Number($event.target.value) || 1)) })"
              />
              <span v-if="warnOf(a)" class="warn-text">{{ warnOf(a) }}</span>
            </td>
            <td class="cell-danger">
              <button class="btn btn--icon" title="删除任务" @click="removeAssignment(a)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">还没有教学任务</div>
    </div>

    <div class="card">
      <div class="card__title">更多批量导入</div>
      <div class="more-import">
        <button class="btn" @click="openImport('teachers')">教师名单</button>
        <button class="btn" @click="openImport('classes')">班级名单</button>
        <span v-if="importTab === 'teachers' || importTab === 'classes'" class="more-import__panel">
          <span class="import-box__hint">{{ importHint }}</span>
          <textarea v-model="importText" class="textarea" rows="4" :placeholder="importPlaceholder"></textarea>
          <span class="import-box__actions">
            <button class="btn" @click="runImport">解析</button>
            <button
              v-if="importReport && importReport.items.length"
              class="btn btn--primary"
              @click="applyImport"
            >
              导入 {{ importReport.items.length }} 条
            </button>
          </span>
        </span>
      </div>
      <div v-if="importReport && importReport.errors.length" class="import-errors">
        <div v-for="(e, i) in importReport.errors" :key="i" class="import-errors__item">⚠ {{ e }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { max-width: 900px; padding: 24px 28px 40px; }
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
.card__title { font-size: 14px; font-weight: 600; }
.toolbar-btns { display: flex; gap: 8px; }
.add-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.table th, .table td {
  text-align: left;
  padding: 7px 8px;
  border-bottom: 1px solid var(--c-border);
}
.cell-danger { text-align: right; }
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
.input--plain { border-color: transparent; background: transparent; width: 110px; }
.input--plain:hover, .input--plain:focus { border-color: var(--c-border); }
.num { width: 64px; }
.select { min-width: 120px; }
.warn-text {
  margin-left: 6px;
  font-size: 12px;
  color: var(--c-danger);
}
.import-box {
  background: var(--c-bg);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.import-box__hint { font-size: 12.5px; color: var(--c-text-muted); margin-bottom: 8px; }
.import-box__actions { display: flex; gap: 8px; margin-top: 8px; }
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
.more-import { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.more-import__panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  background: var(--c-bg);
  border-radius: 8px;
  padding: 12px;
}
.import-errors { margin-top: 10px; }
.import-errors__item { font-size: 12.5px; color: #b45309; margin-top: 4px; }
</style>
