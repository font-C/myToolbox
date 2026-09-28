<script setup>
import { computed } from 'vue'
import { usePlannerStore } from '../store.js'
import { PERIOD_PRESETS, periodsFromPreset } from '../solver/model.js'

const store = usePlannerStore()

const previewSlots = computed(() => store.project.days.length * store.project.periods.length)

function applyPreset(p) {
  store.applyTimegrid([...store.project.days], periodsFromPreset(p.am, p.pm))
  store.notify(`已应用预设：${p.name}`, 'ok')
}

function addDay() {
  const days = [...store.project.days, `第${store.project.days.length + 1}天`]
  store.applyTimegrid(days, store.project.periods)
}
function renameDay(i, name) {
  const days = [...store.project.days]
  days[i] = name || days[i]
  store.applyTimegrid(days, store.project.periods)
}
function removeDay(i) {
  if (store.project.days.length <= 1) return
  store.applyTimegrid(
    store.project.days.filter((_, idx) => idx !== i),
    store.project.periods
  )
}

function addPeriod(session) {
  const amCount = store.project.periods.filter((p) => p.session === 'am').length
  const pmCount = store.project.periods.length - amCount
  const label =
    session === 'am' ? `第${amCount + 1}节` : `下午第${pmCount + 1}节`
  // 追加到对应时段末尾
  const periods = [...store.project.periods]
  let insertAt = periods.length
  if (session === 'am') {
    insertAt = periods.findIndex((p) => p.session === 'pm')
    if (insertAt === -1) insertAt = periods.length
  }
  periods.splice(insertAt, 0, { label, session })
  store.applyTimegrid(store.project.days, periods)
}
function renamePeriod(i, label) {
  const periods = [...store.project.periods]
  periods[i] = { ...periods[i], label: label || periods[i].label }
  store.applyTimegrid(store.project.days, periods)
}
function toggleSession(i) {
  const periods = [...store.project.periods]
  periods[i] = { ...periods[i], session: periods[i].session === 'am' ? 'pm' : 'am' }
  store.applyTimegrid(store.project.days, periods)
}
function removePeriod(i) {
  if (store.project.periods.length <= 1) return
  store.applyTimegrid(
    store.project.days,
    store.project.periods.filter((_, idx) => idx !== i)
  )
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <h2 class="page__title">时间结构</h2>
      <p class="page__desc">
        定义每周上课天数与每天节次。修改时间结构会清空已排课表。
        当前共 <b>{{ previewSlots }}</b> 个排课时段。
      </p>
    </header>

    <div class="card">
      <div class="card__title">快速预设</div>
      <div class="presets">
        <button v-for="p in PERIOD_PRESETS" :key="p.name" class="btn" @click="applyPreset(p)">
          {{ p.name }}
        </button>
      </div>
    </div>

    <div class="card">
      <div class="card__title">上课日（{{ store.project.days.length }} 天）</div>
      <div class="day-list">
        <div v-for="(d, i) in store.project.days" :key="i" class="day-row">
          <input
            class="input day-row__input"
            :value="d"
            @change="renameDay(i, $event.target.value)"
          />
          <button
            class="btn btn--icon"
            title="删除该天"
            :disabled="store.project.days.length <= 1"
            @click="removeDay(i)"
          >
            ✕
          </button>
        </div>
        <button class="btn" :disabled="store.project.days.length >= 7" @click="addDay">
          ＋ 添加上课日
        </button>
      </div>
    </div>

    <div class="card">
      <div class="card__title">每天节次（{{ store.project.periods.length }} 节）</div>
      <div class="period-list">
        <div v-for="(p, i) in store.project.periods" :key="i" class="period-row">
          <span class="period-row__idx">{{ i + 1 }}</span>
          <input
            class="input period-row__input"
            :value="p.label"
            @change="renamePeriod(i, $event.target.value)"
          />
          <button
            class="tag"
            :class="p.session === 'am' ? 'tag--am' : 'tag--pm'"
            :title="p.session === 'am' ? '上午（点击改为下午）' : '下午（点击改为上午）'"
            @click="toggleSession(i)"
          >
            {{ p.session === 'am' ? '上午' : '下午' }}
          </button>
          <button
            class="btn btn--icon"
            title="删除该节"
            :disabled="store.project.periods.length <= 1"
            @click="removePeriod(i)"
          >
            ✕
          </button>
        </div>
      </div>
      <div class="period-actions">
        <button class="btn" @click="addPeriod('am')">＋ 上午节</button>
        <button class="btn" @click="addPeriod('pm')">＋ 下午节</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page {
  max-width: 760px;
  padding: 24px 28px 40px;
}
.page__head { margin-bottom: 16px; }
.page__title {
  margin: 0;
  font-size: 20px;
}
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
.card__title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.day-list, .period-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.day-row, .period-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.day-row__input { width: 160px; }
.period-row__input { width: 180px; }
.period-row__idx {
  width: 20px;
  text-align: right;
  color: var(--c-text-muted);
  font-size: 12px;
}
.input {
  border: 1px solid var(--c-border);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13.5px;
  color: var(--c-text);
  background: var(--c-surface);
  outline: none;
}
.input:focus { border-color: var(--c-primary); }
.btn--icon {
  padding: 7px 10px;
  color: var(--c-text-muted);
}
.tag {
  border: 0;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.tag--am { background: #dbeafe; color: #1d4ed8; }
.tag--pm { background: #fef3c7; color: #b45309; }
.period-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
</style>
