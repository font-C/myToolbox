<script setup>
import { ref, computed, watch } from 'vue'
import { usePlannerStore } from '../store.js'
import { buildSlotMaps, canPlaceUnit } from '../solver/manual.js'
import { unitSizeOf, unitCountOf } from '../solver/model.js'

const store = usePlannerStore()
const viewMode = ref('class')
const selectedId = ref('')

const isClassView = computed(() => viewMode.value === 'class')
const isMaster = computed(() => viewMode.value === 'master')

const entities = computed(() => (isClassView.value ? store.project.classes : store.project.teachers))
watch([entities, viewMode], () => {
  if (!entities.value.some((e) => e.id === selectedId.value)) {
    selectedId.value = entities.value[0]?.id ?? ''
  }
}, { immediate: true })

const selected = computed(() => entities.value.find((e) => e.id === selectedId.value))

/** 指定班级/教师视角的单元表：slot -> {aid, unitIndex, size, label, sub} */
function unitsFor(entityId) {
  const map = {}
  for (const a of store.project.assignments) {
    if (isClassView.value ? a.classId !== entityId : a.teacherId !== entityId) continue
    const subj = store.project.subjects.find((s) => s.id === a.subjectId)
    if (!subj) continue
    const size = unitSizeOf(subj)
    const other = isClassView.value
      ? store.project.teachers.find((t) => t.id === a.teacherId)?.name ?? '?'
      : store.project.classes.find((c) => c.id === a.classId)?.name ?? '?'
    ;(store.project.schedule[a.id] ?? []).forEach((start, unitIndex) => {
      map[start] = { aid: a.id, unitIndex, size, label: subj.name, sub: other, double: size === 2 }
    })
  }
  return map
}

const unitsByStart = computed(() => (selected.value ? unitsFor(selected.value.id) : {}))

/** 被连堂第二节覆盖的槽位（不渲染 td） */
const coveredSlots = computed(() => {
  const set = new Set()
  for (const [slot, unit] of Object.entries(unitsByStart.value)) {
    if (unit.size === 2) set.add(Number(slot) + 1)
  }
  return set
})

const blockedSet = computed(() => {
  if (!selected.value) return new Set()
  const list = isClassView.value
    ? store.project.classBlocked[selected.value.id] ?? []
    : selected.value.unavailable ?? []
  return new Set(list)
})
const slotBlocked = (slot) => blockedSet.value.has(slot)

function subjHue(name) {
  let h = 0
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) % 360
  return h
}
function unitStyle(unit) {
  const h = subjHue(unit.label)
  return { background: `hsl(${h}, 75%, 94%)`, borderColor: `hsl(${h}, 55%, 80%)` }
}

// ---- 拖拽 ----
const drag = ref(null) // { aid, unitIndex?, newUnit, validSlots:Set }

function validSlotsFor(aid, excludeSelf) {
  const maps = buildSlotMaps(store.project)
  if (excludeSelf) {
    const a = store.project.assignments.find((x) => x.id === aid)
    const subj = store.project.subjects.find((s) => s.id === a.subjectId)
    const size = unitSizeOf(subj)
    const start = store.project.schedule[aid]?.[excludeSelf]
    if (start !== undefined) {
      for (let k = 0; k < size; k++) {
        maps.classSlot.delete(`${a.classId}:${start + k}`)
        maps.teacherSlot.delete(`${a.teacherId}:${start + k}`)
      }
    }
  }
  const valid = new Set()
  for (let s = 0; s < store.nSlots; s++) {
    if (canPlaceUnit(store.project, aid, s, maps).ok) valid.add(s)
  }
  return valid
}

function onDragStartUnit(unit, ev) {
  drag.value = {
    aid: unit.aid,
    unitIndex: unit.unitIndex,
    newUnit: false,
    validSlots: validSlotsFor(unit.aid, unit.unitIndex),
  }
  ev.dataTransfer.effectAllowed = 'move'
  ev.dataTransfer.setData('text/plain', unit.aid)
}

function onDragStartChip(item, ev) {
  drag.value = { aid: item.aid, newUnit: true, validSlots: validSlotsFor(item.aid, null) }
  ev.dataTransfer.effectAllowed = 'move'
  ev.dataTransfer.setData('text/plain', item.aid)
}

function onDragOverCell(slot, ev) {
  if (!drag.value || !drag.value.validSlots.has(slot)) return
  ev.dataTransfer.dropEffect = 'move'
  ev.preventDefault()
}

function onDropCell(slot, ev) {
  ev.preventDefault()
  const d = drag.value
  drag.value = null
  if (!d) return
  if (d.newUnit) {
    const r = store.doPlaceUnit(d.aid, slot)
    if (!r.ok) store.notify(r.reason, 'warn')
    return
  }
  const target = unitsByStart.value[slot]
  if (!target) {
    const r = store.doMoveUnit(d.aid, d.unitIndex, slot)
    if (!r.ok) store.notify(r.reason, 'warn')
  } else if (target.aid === d.aid && target.unitIndex === d.unitIndex) {
    // 原位，忽略
  } else {
    const r = store.doSwapUnits(d.aid, d.unitIndex, target.aid, target.unitIndex)
    if (!r.ok) store.notify(r.reason, 'warn')
  }
}

function onDropTray(ev) {
  ev.preventDefault()
  const d = drag.value
  drag.value = null
  if (!d || d.newUnit) return
  store.doRemoveUnit(d.aid, d.unitIndex)
  store.notify('已移出课表，可在下方重新安排', 'info')
}

// ---- 未排托盘 ----
const trayItems = computed(() =>
  store.incompleteAssignments.map(({ a, missing }) => {
    const subj = store.project.subjects.find((s) => s.id === a.subjectId)
    const cls = store.project.classes.find((c) => c.id === a.classId)?.name ?? '?'
    const t = store.project.teachers.find((t2) => t2.id === a.teacherId)?.name ?? '?'
    const placedCount = (store.project.schedule[a.id] ?? []).length
    return {
      aid: a.id,
      label: `${cls}·${subj?.name ?? '?'}·${t}`,
      missing,
      missingUnits: unitCountOf(a, subj) - placedCount,
    }
  })
)

function chipClick(item) {
  const r = store.autoPlace(item.aid)
  if (!r.ok) store.notify(r.reason, 'warn')
}

async function clearSchedule() {
  if (await store.confirm('清空当前课表？基础数据会保留。', { danger: true })) store.clearSchedule()
}

function doPrint() {
  window.print()
}

/** 总表单元格：某班 (day, period) 的课程 */
function masterCell(classId, d, p) {
  const map = masterUnits.value[classId]
  const unit = map?.[d * store.ppd + p]
  return unit ? `${unit.label} ${unit.sub}` : ''
}
const masterUnits = computed(() => {
  const byClass = {}
  for (const c of store.project.classes) byClass[c.id] = unitsFor(c.id)
  return byClass
})
</script>

<template>
  <section class="page">
    <header class="page__head">
      <h2 class="page__title">课表调整</h2>
      <p class="page__desc">
        拖拽课程到空位可移动，拖到另一门课上可互换；冲突会被自动拦截并说明原因。未排任务可拖入空位或点击自动安排，把课拖到下方托盘可移出。
      </p>
    </header>

    <div class="toolbar no-print">
      <div class="seg">
        <button class="seg__btn" :class="{ 'seg__btn--active': viewMode === 'class' }" @click="viewMode = 'class'">按班级</button>
        <button class="seg__btn" :class="{ 'seg__btn--active': viewMode === 'teacher' }" @click="viewMode = 'teacher'">按教师</button>
        <button class="seg__btn" :class="{ 'seg__btn--active': viewMode === 'master' }" @click="viewMode = 'master'">全校总表</button>
      </div>

      <select v-if="!isMaster" v-model="selectedId" class="input select">
        <option v-for="e in entities" :key="e.id" :value="e.id">{{ e.name }}</option>
      </select>

      <div class="toolbar__spacer"></div>
      <button class="btn" @click="doPrint">打印</button>
      <button v-if="Object.keys(store.project.schedule ?? {}).length" class="btn" @click="clearSchedule">清空课表</button>
    </div>

    <!-- 班级 / 教师视图 -->
    <div v-if="!isMaster && selected" class="tt-card">
      <div class="tt-card__title">{{ selected.name }} 课表</div>
      <table class="tt">
        <thead>
          <tr>
            <th class="tt__corner"></th>
            <th v-for="(d, di) in store.project.days" :key="di" class="tt__day">{{ d }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, pi) in store.project.periods" :key="pi">
            <th class="tt__head" :class="p.session === 'am' ? 'th--am' : 'th--pm'">{{ p.label }}</th>
            <template v-for="(d, di) in store.project.days" :key="di">
              <td
                v-if="!coveredSlots.has(di * store.ppd + pi)"
                class="tt__cell"
                :class="{
                  'tt__cell--blocked': slotBlocked(di * store.ppd + pi),
                  'tt__cell--droppable': drag && drag.validSlots.has(di * store.ppd + pi),
                }"
                :rowspan="unitsByStart[di * store.ppd + pi]?.size === 2 ? 2 : 1"
                @dragover="onDragOverCell(di * store.ppd + pi, $event)"
                @drop="onDropCell(di * store.ppd + pi, $event)"
              >
                <div
                  v-if="unitsByStart[di * store.ppd + pi]"
                  class="unit"
                  :style="unitStyle(unitsByStart[di * store.ppd + pi])"
                  draggable="true"
                  @dragstart="onDragStartUnit(unitsByStart[di * store.ppd + pi], $event)"
                  @dragend="drag = null"
                >
                  <div class="unit__label">{{ unitsByStart[di * store.ppd + pi].label }}</div>
                  <div class="unit__sub">{{ unitsByStart[di * store.ppd + pi].sub }}</div>
                  <div v-if="unitsByStart[di * store.ppd + pi].double" class="unit__tag">连堂</div>
                </div>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 全校总表（只读） -->
    <div v-if="isMaster" class="tt-card">
      <div class="tt-card__title">全校总表</div>
      <table class="master">
        <thead>
          <tr>
            <th rowspan="2" class="master__class">班级</th>
            <th v-for="(d, di) in store.project.days" :key="di" :colspan="store.ppd" class="master__day">{{ d }}</th>
          </tr>
          <tr>
            <template v-for="(d, di) in store.project.days" :key="di">
              <th v-for="pi in store.project.periods.length" :key="pi" class="master__period">{{ pi }}</th>
            </template>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in store.project.classes" :key="c.id">
            <td class="master__class">{{ c.name }}</td>
            <template v-for="(d, di) in store.project.days" :key="di">
              <td v-for="(p, pi) in store.project.periods" :key="di + '-' + pi" class="master__cell">
                {{ masterCell(c.id, di, pi) }}
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 未排托盘 -->
    <div
      v-if="!isMaster"
      class="tray no-print"
      :class="{ 'tray--droppable': drag && !drag.newUnit }"
      @dragover="drag && !drag.newUnit && $event.preventDefault()"
      @drop="onDropTray"
    >
      <div class="tray__title">
        未排任务
        <span v-if="trayItems.length" class="tray__hint">（点击自动安排，或拖入课表空位）</span>
      </div>
      <div v-if="trayItems.length" class="tray__chips">
        <button
          v-for="item in trayItems"
          :key="item.aid"
          class="chip"
          draggable="true"
          :title="`还缺 ${item.missing} 节，点击自动安排`"
          @click="chipClick(item)"
          @dragstart="onDragStartChip(item, $event)"
          @dragend="drag = null"
        >
          {{ item.label }}
          <span class="chip__badge">缺{{ item.missing }}节</span>
        </button>
      </div>
      <div v-else class="tray__empty">所有任务都已排满</div>
    </div>
  </section>
</template>

<style>
@media print {
  .side,
  .no-print,
  .toast,
  .mask {
    display: none !important;
  }
  .main {
    overflow: visible !important;
  }
  .page {
    padding: 0 !important;
    max-width: none !important;
  }
  body {
    background: #fff !important;
  }
}
</style>

<style scoped>
.page { padding: 24px 28px 40px; }
.page__head { margin-bottom: 14px; }
.page__title { margin: 0; font-size: 20px; }
.page__desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--c-text-muted);
  line-height: 1.6;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.toolbar__spacer { flex: 1; }
.seg {
  display: inline-flex;
  background: var(--c-bg);
  border-radius: 9px;
  padding: 3px;
}
.seg__btn {
  border: 0;
  background: transparent;
  padding: 6px 14px;
  border-radius: 7px;
  font-size: 13px;
  color: var(--c-text-muted);
  cursor: pointer;
}
.seg__btn--active {
  background: var(--c-surface);
  color: var(--c-text);
  font-weight: 600;
  box-shadow: var(--shadow);
}
.input {
  border: 1px solid var(--c-border);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
  background: var(--c-surface);
  color: var(--c-text);
  outline: none;
}
.select { min-width: 160px; }
.tt-card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  padding: 14px;
  margin-bottom: 14px;
  overflow: auto;
}
.tt-card__title { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
.tt { border-collapse: collapse; table-layout: fixed; }
.tt__corner { border: 0; width: 74px; }
.tt__day {
  border: 1px solid var(--c-border);
  background: var(--c-bg);
  font-size: 13px;
  padding: 6px 8px;
  min-width: 112px;
}
.tt__head {
  border: 1px solid var(--c-border);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 8px;
  white-space: nowrap;
  width: 74px;
}
.th--am { color: #1d4ed8; }
.th--pm { color: #b45309; }
.tt__cell {
  border: 1px solid var(--c-border);
  height: 54px;
  vertical-align: top;
  padding: 2px;
}
.tt__cell--blocked {
  background: repeating-linear-gradient(45deg, #f1f5f9, #f1f5f9 5px, #e2e8f0 5px, #e2e8f0 10px);
}
.tt__cell--droppable {
  background: #ecfdf5;
  box-shadow: inset 0 0 0 2px #6ee7b7;
}
.unit {
  height: 100%;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid transparent;
  cursor: grab;
  position: relative;
  user-select: none;
}
.unit:active { cursor: grabbing; }
.unit__label { font-size: 13px; font-weight: 600; line-height: 1.3; }
.unit__sub { font-size: 11.5px; color: var(--c-text-muted); margin-top: 2px; }
.unit__tag {
  position: absolute;
  right: 5px;
  top: 5px;
  font-size: 10px;
  color: #7c3aed;
  background: #f3e8ff;
  border-radius: 4px;
  padding: 1px 5px;
}
.master { border-collapse: collapse; font-size: 12px; }
.master__class {
  border: 1px solid var(--c-border);
  padding: 6px 10px;
  font-weight: 600;
  white-space: nowrap;
  background: var(--c-bg);
}
.master__day { border: 1px solid var(--c-border); background: var(--c-bg); padding: 6px; }
.master__period {
  border: 1px solid var(--c-border);
  font-weight: 400;
  color: var(--c-text-muted);
  min-width: 76px;
}
.master__cell { border: 1px solid var(--c-border); padding: 5px 7px; min-width: 76px; }
.tray {
  background: var(--c-surface);
  border: 1px dashed var(--c-border);
  border-radius: var(--radius);
  padding: 12px 14px;
}
.tray--droppable {
  border-color: var(--c-danger);
  background: #fff7f7;
}
.tray__title { font-size: 13px; font-weight: 600; }
.tray__hint { font-weight: 400; font-size: 12px; color: var(--c-text-muted); }
.tray__chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--c-border);
  background: var(--c-bg);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12.5px;
  cursor: grab;
}
.chip__badge {
  background: #fef3c7;
  color: #b45309;
  border-radius: 999px;
  font-size: 11px;
  padding: 1px 7px;
}
.tray__empty { margin-top: 6px; font-size: 13px; color: var(--c-text-muted); }
</style>
