<script setup>
import { ref, computed } from 'vue'
import { usePlannerStore } from '../store.js'

const store = usePlannerStore()
const selectedClassId = ref('')
const newGradeName = ref('')
const newClassName = ref('')

const gradeName = (gradeId) =>
  store.project.grades.find((g) => g.id === gradeId)?.name ?? '（未分组）'

const selectedClass = computed(() =>
  store.project.classes.find((c) => c.id === selectedClassId.value)
)

function addGrade() {
  const name = newGradeName.value.trim()
  if (!name) return
  store.addGrade(name)
  newGradeName.value = ''
}
function addClass() {
  const name = newClassName.value.trim()
  if (!name) {
    store.notify('请输入班级名称', 'warn')
    return
  }
  const c = store.addClass(name)
  newClassName.value = ''
  selectedClassId.value = c.id
}
function removeClass(cls) {
  store
    .confirm(
      `删除班级「${cls.name}」会同时删除其全部教学任务与课表，确定？`,
      { danger: true }
    )
    .then((ok) => {
      if (ok) {
        if (selectedClassId.value === cls.id) selectedClassId.value = ''
        store.removeClass(cls.id)
      }
    })
}
function moveClass(cls, gradeId) {
  store.updateClass(cls.id, { gradeId: gradeId || null })
}

function slotBlocked(classId, slot) {
  return (store.project.classBlocked[classId] ?? []).includes(slot)
}
function toggleBlocked(classId, slot) {
  store.toggleClassBlocked(classId, slot)
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <h2 class="page__title">班级</h2>
      <p class="page__desc">按年级组织班级；可为班级设置不可用时段（如班会、集体活动），排课时自动避开。</p>
    </header>

    <div class="card">
      <div class="card__toolbar">
        <div class="card__title">班级列表（{{ store.project.classes.length }}）</div>
      </div>
      <div v-if="store.project.grades.length" class="grade-tags">
        <span v-for="g in store.project.grades" :key="g.id" class="grade-tag">
          {{ g.name }}
          <button class="grade-tag__del" :title="'删除年级 ' + g.name" @click="store.removeGrade(g.id)">✕</button>
        </span>
      </div>
      <div class="add-row">
        <input
          v-model="newGradeName"
          class="input"
          placeholder="新增年级名称"
          @keyup.enter="addGrade"
        />
        <button class="btn" @click="addGrade">＋ 年级</button>
        <span class="add-row__divider"></span>
        <input
          v-model="newClassName"
          class="input"
          placeholder="班级名称，如：七（1）班"
          @keyup.enter="addClass"
        />
        <button class="btn btn--primary" @click="addClass">＋ 班级</button>
      </div>
      <table v-if="store.project.classes.length" class="table">
        <thead>
          <tr>
            <th>班级</th>
            <th>年级</th>
            <th>不可用时段</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in store.project.classes"
            :key="c.id"
            :class="{ 'row--active': selectedClassId === c.id }"
            @click="selectedClassId = c.id"
          >
            <td>
              <input
                class="input input--plain"
                :value="c.name"
                @change="store.updateClass(c.id, { name: $event.target.value.trim() || c.name })"
                @click.stop
              />
            </td>
            <td @click.stop>
              <select class="input select" :value="c.gradeId ?? ''" @change="moveClass(c, $event.target.value)">
                <option value="">（未分组）</option>
                <option v-for="g in store.project.grades" :key="g.id" :value="g.id">{{ g.name }}</option>
              </select>
            </td>
            <td>{{ (store.project.classBlocked[c.id] ?? []).length || '—' }}</td>
            <td class="cell-danger" @click.stop>
              <button class="btn btn--icon" title="删除班级" @click="removeClass(c)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">还没有班级，点击「＋ 班级」添加</div>
    </div>

    <div v-if="selectedClass" class="card">
      <div class="card__title">
        「{{ selectedClass.name }}」不可用时段
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
            <th class="grid-table__head" :class="p.session === 'am' ? 'th--am' : 'th--pm'">
              {{ p.label }}
            </th>
            <td v-for="(d, di) in store.project.days" :key="di">
              <button
                class="slot"
                :class="{ 'slot--blocked': slotBlocked(selectedClass.id, di * store.ppd + pi) }"
                :title="`${d} ${p.label}`"
                @click="toggleBlocked(selectedClass.id, di * store.ppd + pi)"
              ></button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else-if="store.project.classes.length" class="tip-line">
      提示：在上方列表中选中一个班级，可设置其不可用时段。
    </div>
  </section>
</template>

<style scoped>
.page {
  max-width: 860px;
  padding: 24px 28px 40px;
}
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
.card__title {
  font-size: 14px;
  font-weight: 600;
}
.card__title .hint {
  font-weight: 400;
  font-size: 12px;
  color: var(--c-text-muted);
}
.toolbar-btns { display: flex; gap: 8px; }
.add-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.add-row__divider {
  width: 1px;
  height: 20px;
  background: var(--c-border);
}
.grade-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.grade-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--c-bg);
  border-radius: 999px;
  padding: 3px 6px 3px 12px;
  font-size: 12px;
}
.grade-tag__del {
  border: 0;
  background: transparent;
  color: var(--c-text-muted);
  cursor: pointer;
  border-radius: 50%;
  width: 18px;
  height: 18px;
  line-height: 1;
}
.grade-tag__del:hover { color: var(--c-danger); }
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}
.table th, .table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--c-border);
}
.table tbody tr { cursor: pointer; }
.table tbody tr:hover { background: var(--c-bg); }
.row--active { background: #eff6ff; }
.cell-danger { text-align: right; }
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
.input--plain {
  border-color: transparent;
  background: transparent;
  width: 130px;
}
.input--plain:hover, .input--plain:focus { border-color: var(--c-border); }
.select { min-width: 110px; }
.grid-table {
  border-collapse: collapse;
  margin-top: 4px;
}
.grid-table th, .grid-table td {
  border: 1px solid var(--c-border);
  padding: 3px;
}
.grid-table__corner { border: 0 !important; }
.grid-table__head {
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px !important;
  white-space: nowrap;
}
.th--am { color: #1d4ed8; }
.th--pm { color: #b45309; }
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
  background: repeating-linear-gradient(
    45deg,
    #fecaca,
    #fecaca 4px,
    #fee2e2 4px,
    #fee2e2 8px
  );
  border-color: #fca5a5;
}
</style>
