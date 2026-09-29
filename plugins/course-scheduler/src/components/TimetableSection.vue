<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { usePlannerStore } from '../store.js'
import { buildSlotMaps, canPlaceUnit, rulesOf } from '../solver/manual.js'
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

/** 指定班级/教师视角的单元表：slot -> {aid, unitIndex, size, label, sub}；axis 显式指定维度，默认跟随当前视图 */
function unitsFor(entityId, axis = isClassView.value ? 'class' : 'teacher') {
  const clsAxis = axis === 'class'
  const map = {}
  for (const a of store.project.assignments) {
    if (clsAxis ? a.classId !== entityId : a.teacherId !== entityId) continue
    const subj = store.project.subjects.find((s) => s.id === a.subjectId)
    if (!subj) continue
    const size = unitSizeOf(subj)
    const other = clsAxis
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

// ---- 拖拽（Pointer Events，兼容 Tauri WKWebView，避免 HTML5 DnD 的 drop 不触发问题） ----
const drag = ref(null) // { aid, unitIndex?, newUnit, validSlots:Set }
const ptr = ref(null) // 指针跟踪：{ startX, startY, active, activate }
const suppressChipAid = ref(null)
const ghost = ref(null) // 拖拽占位跟随元素：{ x, y, label, sub, chip, style }
const hoverSlot = ref(null) // 指针当前所在的目标格槽位

/** 已有单元可落点的全部起始槽（含被占用的格子，供交换）——几何/连堂/规则检查 */
function structuralStartSlots(aid) {
  const a = store.project.assignments.find((x) => x.id === aid)
  if (!a) return new Set()
  const subj = store.project.subjects.find((s) => s.id === a.subjectId)
  const size = unitSizeOf(subj)
  const ppd = store.ppd
  const rules = rulesOf(store.project)
  const valid = new Set()
  for (let s = 0; s < store.nSlots; s++) {
    const p = s % ppd
    if (p + size > ppd) continue
    if (size === 2 && store.project.periods[p].session !== store.project.periods[p + 1].session) continue
    // 与 canPlaceUnit 的规则口径一致：体育只排下午
    if (rules.pePmOnly && subj?.isPe && store.project.periods[p].session !== 'pm') continue
    valid.add(s)
  }
  return valid
}

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

function setDragForUnit(unit) {
  drag.value = { aid: unit.aid, unitIndex: unit.unitIndex, newUnit: false, validSlots: structuralStartSlots(unit.aid) }
  ghost.value = { label: unit.label, sub: unit.sub, chip: false, style: unitStyle(unit) }
}
function setDragForChip(item) {
  drag.value = { aid: item.aid, newUnit: true, validSlots: validSlotsFor(item.aid, null) }
  ghost.value = { label: item.label, chip: true }
}

function removePtrListeners() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
}

function onPointerDown(ev, activate) {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return
  ptr.value = { startX: ev.clientX, startY: ev.clientY, active: false, activate }
  document.body.classList.add('is-dragging')
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
}

function onPointerMove(ev) {
  const p = ptr.value
  if (!p) return
  // 移动超过阈值才真正进入拖拽（区分点击与拖动）
  if (!p.active) {
    const dx = ev.clientX - p.startX
    const dy = ev.clientY - p.startY
    if (dx * dx + dy * dy < 25) return
    p.active = true
    p.activate()
  }
  ev.preventDefault()
  // 让占位元素跟随指针移动
  if (ghost.value) ghost.value = { ...ghost.value, x: ev.clientX, y: ev.clientY }
  // 标记指针当前所处的目标格（用于高亮提示将替换/放置的位置）
  const el = document.elementFromPoint(ev.clientX, ev.clientY)
  const cell = el?.closest?.('[data-slot]')
  hoverSlot.value = cell ? Number(cell.getAttribute('data-slot')) : null
}

function onPointerUp(ev) {
  const p = ptr.value
  ptr.value = null
  removePtrListeners()
  document.body.classList.remove('is-dragging')
  hoverSlot.value = null
  if (!p || !p.active) {
    ghost.value = null
    return
  }
  const d = drag.value
  drag.value = null
  ghost.value = null
  if (!d) return
  const t = ev.target instanceof Element ? ev.target.closest('[data-slot],[data-tray]') : null
  if (t?.hasAttribute('data-tray')) {
    dropAtTray(d)
  } else if (t?.hasAttribute('data-slot')) {
    dropAt(Number(t.getAttribute('data-slot')), d)
  }
  // 拖动 chip 后抑制随之而来的 click（避免误触发自动安排）
  if (d.newUnit) {
    suppressChipAid.value = d.aid
    setTimeout(() => {
      if (suppressChipAid.value === d.aid) suppressChipAid.value = null
    }, 0)
  }
}

function onPointerCancel() {
  ptr.value = null
  drag.value = null
  ghost.value = null
  hoverSlot.value = null
  suppressChipAid.value = null
  removePtrListeners()
  document.body.classList.remove('is-dragging')
}

onUnmounted(() => {
  removePtrListeners()
  document.body.classList.remove('is-dragging')
})

/** 把拖拽中的单元放到指定空位/与占用格交换，规则校验不符时弹确认 */
async function dropAt(slot, d) {
  if (d.newUnit) {
    const r = store.doPlaceUnit(d.aid, slot)
    if (!r.ok) store.notify(r.reason, 'warn')
    return
  }
  const target = unitsByStart.value[slot]
  if (!target) {
    const r = store.doMoveUnit(d.aid, d.unitIndex, slot)
    if (!r.ok) store.notify(r.reason, 'warn')
    return
  }
  if (target.aid === d.aid && target.unitIndex === d.unitIndex) return // 原位

  // 目标位置有课程：节数不同无法互换，直接说明
  const aA = store.project.assignments.find((x) => x.id === d.aid)
  const subjA = store.project.subjects.find((s) => s.id === aA.subjectId)
  const sizeA = unitSizeOf(subjA)
  if (sizeA !== target.size) {
    store.notify('连堂与单节课程无法直接互换', 'warn')
    return
  }

  let r = store.doSwapUnits(d.aid, d.unitIndex, target.aid, target.unitIndex)
  if (r.ok) {
    store.notify('已交换位置', 'ok')
    return
  }
  // 校验不符：询问用户「确认则交换位置 / 取消则保持原样」
  const tlabel = `${target.label}${target.sub ? `（${target.sub}）` : ''}`
  const ok = await store.confirm(
    `与「${tlabel}」互换会违反排课规则：${r.reason}。确认仍要交换位置吗？`,
    { okText: '交换位置', cancelText: '保持原样' }
  )
  if (ok) {
    r = store.doSwapUnitsForce(d.aid, d.unitIndex, target.aid, target.unitIndex)
    if (r.ok) store.notify('已强制交换位置（可能产生待处理冲突）', 'warn')
    else store.notify(r.reason, 'warn')
  }
}

function dropAtTray(d) {
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
  if (suppressChipAid.value === item.aid) {
    suppressChipAid.value = null
    return
  }
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
  for (const c of store.project.classes) byClass[c.id] = unitsFor(c.id, 'class')
  return byClass
})
</script>

<template>
  <section class="page">
    <header class="page__head">
      <h2 class="page__title">课表调整</h2>
      <p class="page__desc">
        拖拽课程到空位可移动，拖到另一门课上可互换；若互换会违反规则，会弹出确认「交换位置 / 保持原样」。未排任务可拖入空位或点击自动安排，把课拖到下方托盘可移出。
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
            <th class="tt__head" :class="'th--' + p.session">{{ p.label }}</th>
            <template v-for="(d, di) in store.project.days" :key="di">
              <td
                v-if="!coveredSlots.has(di * store.ppd + pi)"
                class="tt__cell"
                :class="{
                  'tt__cell--blocked': slotBlocked(di * store.ppd + pi),
                  'tt__cell--droppable': drag && drag.validSlots.has(di * store.ppd + pi),
                  'tt__cell--hover': drag && hoverSlot === di * store.ppd + pi,
                }"
                :data-slot="di * store.ppd + pi"
                :rowspan="unitsByStart[di * store.ppd + pi]?.size === 2 ? 2 : 1"
              >
                <div
                  v-if="unitsByStart[di * store.ppd + pi]"
                  class="unit"
                  :style="unitStyle(unitsByStart[di * store.ppd + pi])"
                  @pointerdown="onPointerDown($event, () => setDragForUnit(unitsByStart[di * store.ppd + pi]))"
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
            <th class="master__class">天&nbsp;/&nbsp;节次</th>
            <th v-for="c in store.project.classes" :key="c.id" class="master__day">{{ c.name }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(d, di) in store.project.days" :key="di">
            <tr class="master__dayrow">
              <th :colspan="store.project.classes.length + 1">{{ d }}</th>
            </tr>
            <tr v-for="(p, pi) in store.project.periods" :key="di + '-' + pi">
              <td class="master__class">第 {{ pi + 1 }} 节</td>
              <td v-for="c in store.project.classes" :key="c.id" class="master__cell">
                {{ masterCell(c.id, di, pi) }}
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- 未排托盘 -->
    <div
      v-if="!isMaster"
      class="tray no-print"
      :class="{ 'tray--droppable': drag && !drag.newUnit }"
      data-tray="1"
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
          :title="`还缺 ${item.missing} 节，点击自动安排`"
          @click="chipClick(item)"
          @pointerdown="onPointerDown($event, () => setDragForChip(item))"
        >
          {{ item.label }}
          <span class="chip__badge">缺{{ item.missing }}节</span>
        </button>
      </div>
      <div v-else class="tray__empty">所有任务都已排满</div>
    </div>

    <!-- 拖拽跟随占位 -->
    <div
      v-if="ghost"
      class="ghost"
      :style="{
        left: (ghost.x ?? 0) + 'px',
        top: (ghost.y ?? 0) + 'px',
        background: ghost.style?.background,
        borderColor: ghost.style?.borderColor,
      }"
    >
      <div v-if="ghost.chip" class="ghost__chip">{{ ghost.label }}</div>
      <template v-else>
        <div class="ghost__label">{{ ghost.label }}</div>
        <div v-if="ghost.sub" class="ghost__sub">{{ ghost.sub }}</div>
      </template>
    </div>
  </section>
</template>

<style>
.is-dragging,
.is-dragging * {
  user-select: none !important;
  cursor: grabbing !important;
}
.ghost {
  position: fixed;
  z-index: 9999;
  transform: translate(-50%, -50%);
  pointer-events: none;
  display: inline-block;
  max-width: 240px;
  padding: 6px 10px;
  border-radius: 7px;
  border: 1px solid transparent;
  box-shadow: 0 5px 14px rgba(0, 0, 0, 0.18);
  opacity: 0.92;
  background: #fff;
}
.ghost__label { font-size: 13px; font-weight: 600; line-height: 1.3; }
.ghost__sub { font-size: 11.5px; color: var(--c-text-muted); margin-top: 2px; }
.ghost__chip { font-size: 12.5px; white-space: nowrap; font-weight: 600; }
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
.th--dawn { color: #a21caf; }
.th--eve { color: #7c3aed; }
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
.tt__cell--hover {
  background: #c7f2db;
  box-shadow: inset 0 0 0 2px #34d399;
  outline: 2px solid #059669;
  outline-offset: -1px;
}
.unit {
  height: 100%;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid transparent;
  cursor: grab;
  position: relative;
  user-select: none;
  touch-action: none;
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
.master__dayrow th {
  border: 1px solid var(--c-border);
  background: var(--c-bg);
  font-size: 12px;
  color: var(--c-text-muted);
  padding: 5px 8px;
  text-align: left;
}
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
  touch-action: none;
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
