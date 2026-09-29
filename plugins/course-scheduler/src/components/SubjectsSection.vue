<script setup>
import { ref } from 'vue'
import { usePlannerStore } from '../store.js'
import { parseSubjects } from '../io.js'
import { guessSubjectProps } from '../solver/model.js'

const store = usePlannerStore()
const importTab = ref('')
const importText = ref('')
const importReport = ref(null)
const newSubjectName = ref('')
const newSubjectSelectedGrades = ref([])

function addSubject() {
  const name = newSubjectName.value.trim()
  if (!name) {
    store.notify('请输入科目名称', 'warn')
    return
  }
  const base = guessSubjectProps(name)
  const gids = [...new Set(newSubjectSelectedGrades.value)]
  if (!gids.length) {
    store.addSubject(name, { ...base, gradeId: null })
  } else {
    let added = 0
    for (const gid of gids) {
      if (!store.project.subjects.some((s) => s.name === name && (s.gradeId ?? null) === gid)) {
        store.addSubject(name, { ...base, gradeId: gid })
        added++
      }
    }
    if (added === 0) store.notify('所选年级均已存在同名科目', 'warn')
  }
  newSubjectName.value = ''
  newSubjectSelectedGrades.value = []
}

function removeSubject(s) {
  store
    .confirm(`删除科目「${s.name}」会同时删除相关教学任务与课表，确定？`, { danger: true })
    .then((ok) => ok && store.removeSubject(s.id))
}

function openImport(tab) {
  importTab.value = importTab.value === tab ? '' : tab
  importText.value = ''
  importReport.value = null
}

function runImport() {
  importReport.value = parseSubjects(importText.value, store.project.grades)
}

function applyImport() {
  if (!importReport.value) return
  const { items } = importReport.value
  let added = 0
  for (const it of items) {
    const gid = it.gradeId ?? null
    if (!store.project.subjects.some((s) => s.name === it.name && (s.gradeId ?? null) === gid)) {
      store.addSubject(it.name, { ...it, gradeId: gid })
      added++
    }
  }
  store.notify(`已导入 ${added} 条数据`, 'ok')
  importTab.value = ''
  importText.value = ''
  importReport.value = null
}

const importHint = '每行「科目[<Tab>周课时][<Tab>年级]」，主科/体育/连堂按名称自动识别，可再手动调整'
const importPlaceholder = '语文\t5\t七年级\n数学\t5\t七年级\n体育\t3'
</script>

<template>
  <section class="page">
    <header class="page__head">
      <h2 class="page__title">科目</h2>
      <p class="page__desc">
        定义科目属性：主科优先上午黄金时段、体育避开饭点、连堂科目两节连排。
        具体排哪个班由「教学任务」页登记。
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
        <div class="grade-check">
          <label v-for="g in store.project.grades" :key="g.id" class="grade-check__item">
            <input type="checkbox" :value="g.id" v-model="newSubjectSelectedGrades" />
            {{ g.name }}
          </label>
          <span class="grade-check__hint">
            {{ newSubjectSelectedGrades.length ? `勾选了 ${newSubjectSelectedGrades.length} 个年级，保存后自动拆分为多条` : '（不勾选 = 适用所有年级）' }}
          </span>
        </div>
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
            <th>年级</th>
            <th>主科</th>
            <th>体育</th>
            <th>连堂</th>
            <th title="勾选后，该科目同一时段全校只能安排一个班（适用于共用的机房、音乐室、操场等）">共享教室</th>
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
            <td>
              <select class="input select" :value="s.gradeId ?? ''" @change="store.updateSubject(s.id, { gradeId: $event.target.value || null })">
                <option value="">（所有年级）</option>
                <option v-for="g in store.project.grades" :key="g.id" :value="g.id">{{ g.name }}</option>
              </select>
            </td>
            <td><input type="checkbox" :checked="s.isMajor" @change="store.updateSubject(s.id, { isMajor: $event.target.checked })" /></td>
            <td><input type="checkbox" :checked="s.isPe" @change="store.updateSubject(s.id, { isPe: $event.target.checked })" /></td>
            <td><input type="checkbox" :checked="s.double" @change="store.updateSubject(s.id, { double: $event.target.checked })" /></td>
            <td><input type="checkbox" :checked="s.roomShared" @change="store.updateSubject(s.id, { roomShared: $event.target.checked })" /></td>
            <td class="cell-danger">
              <button class="btn btn--icon" title="删除科目" @click="removeSubject(s)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">还没有科目</div>
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
  flex-wrap: wrap;
}
.grade-check {
  display: flex;
  align-items: center;
  gap: 4px 12px;
  flex-wrap: wrap;
  padding: 4px 10px;
  border: 1px dashed var(--c-border);
  border-radius: 8px;
  font-size: 13px;
  color: var(--c-text);
}
.grade-check__item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.grade-check__item input { accent-color: var(--c-primary); cursor: pointer; }
.grade-check__hint {
  font-size: 12px;
  color: var(--c-text-muted);
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
.import-errors { margin-top: 10px; }
.import-errors__item { font-size: 12.5px; color: #b45309; margin-top: 4px; }
</style>
