<script setup>
import { ref, computed, onUnmounted } from 'vue'
import * as XLSX from 'xlsx'

const tab = ref('roll') // roll | timer | group
const error = ref('')
const notice = ref('')

// ---------- 名单导入（Excel/CSV，两处名单共用） ----------
const HEADER_WORDS = /^(姓名|名字|名单|序号|编号|学号|no\.?|name|id)$/i
async function importRoster(f, target) {
  if (!f) return
  try {
    const buf = new Uint8Array(await f.arrayBuffer())
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false })
    const names = []
    for (const row of rows) {
      const cell = (row || []).find((c) => String(c ?? '').trim())
      if (cell === undefined) continue
      const v = String(cell).trim()
      if (!names.length && HEADER_WORDS.test(v)) continue // 跳过表头
      if (v && !names.includes(v)) names.push(v)
    }
    if (!names.length) {
      error.value = `「${f.name}」里没有读到名单（取每行第一列）`
      return
    }
    if (target === 'roll') rosterText.value = names.join('\n')
    else groupRosterText.value = names.join('\n')
    notice.value = `已从「${f.name}」导入 ${names.length} 个名字`
    setTimeout(() => (notice.value = ''), 2500)
    error.value = ''
  } catch (e) {
    error.value = `导入失败：${e.message || e}`
  }
}
const rollFileInput = ref(null)
const groupFileInput = ref(null)

// ---------- 点名 ----------
const rosterText = ref('张三\n李四\n王五\n赵六\n陈七\n周八')
const noRepeat = ref(false)
const rolling = ref(false)
const currentName = ref('')
const pickedLog = ref([]) // [{ name, time }]
let rollTimer = null
const roster = computed(() => rosterText.value.split('\n').map((s) => s.trim()).filter(Boolean))
const pool = computed(() => (noRepeat.value ? roster.value.filter((n) => !pickedLog.value.some((p) => p.name === n)) : roster.value))

function startRoll() {
  if (rolling.value) {
    // 停止：定格当前名字
    clearInterval(rollTimer)
    rollTimer = null
    rolling.value = false
    if (currentName.value) {
      pickedLog.value.unshift({ name: currentName.value, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) })
    }
    return
  }
  const candidates = pool.value
  if (!candidates.length) {
    currentName.value = noRepeat.value && roster.value.length ? '全部点过啦' : ''
    return
  }
  rolling.value = true
  let ticks = 0
  rollTimer = setInterval(() => {
    currentName.value = candidates[Math.floor(Math.random() * candidates.length)]
    if (++ticks > 24) {
      // 渐慢后停止
      clearInterval(rollTimer)
      rollTimer = null
      rolling.value = false
      pickedLog.value.unshift({ name: currentName.value, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) })
    }
  }, 70)
}

function clearPicked() {
  pickedLog.value = []
}
function resetRoll() {
  clearInterval(rollTimer)
  rollTimer = null
  rolling.value = false
  currentName.value = ''
  pickedLog.value = []
}

// ---------- 倒计时 ----------
const totalSec = ref(300)
const remainSec = ref(0)
const timerRunning = ref(false)
let timerId = null
let audioCtx = null

function fmt(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
const display = computed(() => fmt(remainSec.value))
const urgent = computed(() => remainSec.value > 0 && remainSec.value <= 10)

function beep(freq = 880, dur = 0.12) {
  try {
    audioCtx = audioCtx || new AudioContext()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.frequency.value = freq
    o.type = 'sine'
    g.gain.value = 0.25
    o.connect(g).connect(audioCtx.destination)
    o.start()
    o.stop(audioCtx.currentTime + dur)
  } catch {}
}

function setTimer() {
  remainSec.value = Math.max(0, Math.round(Number(totalSec.value) || 0))
}
function startTimer() {
  if (timerRunning.value) {
    // 暂停
    clearInterval(timerId)
    timerId = null
    timerRunning.value = false
    return
  }
  if (remainSec.value <= 0) setTimer()
  if (remainSec.value <= 0) return
  timerRunning.value = true
  let lastWhole = remainSec.value
  timerId = setInterval(() => {
    remainSec.value--
    if (remainSec.value <= 0) {
      clearInterval(timerId)
      timerId = null
      timerRunning.value = false
      beep(660, 0.5)
      setTimeout(() => beep(660, 0.5), 600)
      return
    }
    if (remainSec.value <= 5 && remainSec.value !== lastWhole) beep(880, 0.1)
    lastWhole = remainSec.value
  }, 1000)
}
function resetTimer() {
  clearInterval(timerId)
  timerId = null
  timerRunning.value = false
  setTimer()
}

// ---------- 分组 ----------
const groupRosterText = ref('张三\n李四\n王五\n赵六\n陈七\n周八\n吴九\n郑十')
const groupMode = ref('count') // count = 分几组 | size = 每组几人
const groupNum = ref(3)
const groupSize = ref(2)
const groupResult = ref([]) // [{ name: '第1组', members: [] }]

const groupNames = computed(() => groupRosterText.value.split('\n').map((s) => s.trim()).filter(Boolean))

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function makeGroups() {
  const names = groupNames.value
  if (!names.length) return
  const shuffled = shuffle(names)
  let k = 1
  if (groupMode.value === 'count') {
    k = Math.max(1, Math.min(Number(groupNum.value) || 1, names.length))
  } else {
    const size = Math.max(1, Number(groupSize.value) || 1)
    k = Math.ceil(names.length / size)
  }
  const res = Array.from({ length: k }, (_, i) => ({ name: `第 ${i + 1} 组`, members: [] }))
  shuffled.forEach((n, i) => res[i % k].members.push(n))
  groupResult.value = res
}

function copyGroups() {
  const text = groupResult.value.map((g) => `${g.name}：${g.members.join('、')}`).join('\n')
  const ta = document.createElement('textarea')
  ta.value = text
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}

onUnmounted(() => {
  if (rollTimer) clearInterval(rollTimer)
  if (timerId) clearInterval(timerId)
})
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>课堂工具</h1>
      <p class="header__sub">随机点名 · 倒计时 · 随机分组 · 全离线</p>
    </header>

    <main class="body">
      <div class="tabs">
        <button type="button" class="tab" :class="{ 'tab--active': tab === 'roll' }" @click="tab = 'roll'">随机点名</button>
        <button type="button" class="tab" :class="{ 'tab--active': tab === 'timer' }" @click="tab = 'timer'">倒计时</button>
        <button type="button" class="tab" :class="{ 'tab--active': tab === 'group' }" @click="tab = 'group'">随机分组</button>
      </div>

      <!-- 点名 -->
      <section v-if="tab === 'roll'" class="panel">
        <div class="rollstage" :class="{ 'rollstage--rolling': rolling }">
          <p class="rollname" :class="{ dim: !currentName }">{{ currentName || '准备点名' }}</p>
          <p class="rollhint" v-if="pool.length">候选 {{ pool.length }} 人<template v-if="noRepeat && pickedLog.length">（已点 {{ pickedLog.length }} 人）</template></p>
        </div>
        <div class="btnrow">
          <button type="button" class="btn btn--primary big" @click="startRoll">
            {{ rolling ? '停！' : currentName ? '再点一次' : '开始点名' }}
          </button>
          <label class="check"><input v-model="noRepeat" type="checkbox" /> 不重复抽取</label>
          <button type="button" class="btn" @click="resetRoll">重置</button>
        </div>
        <details v-if="pickedLog.length" class="log">
          <summary>已点记录（{{ pickedLog.length }}）</summary>
          <p class="logline">{{ pickedLog.map((p) => p.name).join('、') }}</p>
        </details>
        <div class="field">
          <label class="field__label" for="roster">名单（每行一个名字，可从 Excel 第一列导入）</label>
          <textarea id="roster" v-model="rosterText" class="input textarea" rows="5" spellcheck="false"></textarea>
          <button type="button" class="btn importbtn" @click="rollFileInput?.click()">
            <input ref="rollFileInput" type="file" accept=".xlsx,.xls,.csv" class="hidden" @change="importRoster($event.target.files?.[0], 'roll'); rollFileInput.value = ''" />
            📥 导入 Excel / CSV
          </button>
        </div>
      </section>

      <!-- 倒计时 -->
      <section v-else-if="tab === 'timer'" class="panel panel--center">
        <div class="timerdisplay" :class="{ urgent, running: timerRunning }">{{ display }}</div>
        <div class="btnrow">
          <label class="check">时长（分钟）<input v-model.number="totalSec" type="number" min="1" class="input input--num" /></label>
          <button type="button" class="btn" @click="setTimer">设置</button>
        </div>
        <div class="presets">
          <button v-for="m in [1, 3, 5, 10, 15, 20]" :key="m" type="button" class="segbtn" @click="((totalSec = m * 60), setTimer())">{{ m }} 分钟</button>
        </div>
        <div class="btnrow">
          <button type="button" class="btn btn--primary big" @click="startTimer">{{ timerRunning ? '暂停' : remainSec > 0 && remainSec < totalSec ? '继续' : '开始' }}</button>
          <button type="button" class="btn big" @click="resetTimer">重置</button>
        </div>
        <p class="muted">最后 5 秒滴答提示，结束长响两声。</p>
      </section>

      <!-- 分组 -->
      <section v-else class="panel">
        <div class="field">
          <label class="field__label" for="groupRoster">名单（每行一个，可从 Excel 第一列导入）</label>
          <textarea id="groupRoster" v-model="groupRosterText" class="input textarea" rows="5" spellcheck="false"></textarea>
          <button type="button" class="btn importbtn" @click="groupFileInput?.click()">
            <input ref="groupFileInput" type="file" accept=".xlsx,.xls,.csv" class="hidden" @change="importRoster($event.target.files?.[0], 'group'); groupFileInput.value = ''" />
            📥 导入 Excel / CSV
          </button>
        </div>
        <div class="btnrow">
          <label class="check">
            分
            <input v-if="groupMode === 'count'" v-model.number="groupNum" type="number" min="1" class="input input--num" />
            <input v-else v-model.number="groupSize" type="number" min="1" class="input input--num" />
            <select v-model="groupMode" class="input">
              <option value="count">组</option>
              <option value="size">人一组</option>
            </select>
          </label>
          <button type="button" class="btn btn--primary" @click="makeGroups">随机分组</button>
          <button v-if="groupResult.length" type="button" class="btn" @click="copyGroups">复制结果</button>
        </div>
        <div v-if="groupResult.length" class="groups">
          <div v-for="g in groupResult" :key="g.name" class="gcard">
            <p class="gcard__name">{{ g.name }}（{{ g.members.length }} 人）</p>
            <p class="gcard__members">{{ g.members.join('、') }}</p>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; overflow-y: auto; }
.header { text-align: center; padding: 16px 16px 6px; }
.header h1 { margin: 0 0 5px; font-size: 21px; }
.header__sub { margin: 0; font-size: 13px; color: var(--c-text-muted); }
.body { flex: 1; width: 100%; max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; padding: 6px 22px 24px; }

.tabs { width: 100%; display: grid; grid-template-columns: 1fr 1fr 1fr; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 4px; gap: 4px; }
.tab { border: none; background: transparent; padding: 10px; font-size: 14px; font-weight: 600; border-radius: 8px; cursor: pointer; color: var(--c-text-muted); }
.tab--active { background: var(--c-primary); color: #fff; }

.panel { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.panel--center { align-items: center; }

.rollstage {
  align-self: center; width: 100%; min-height: 150px; border-radius: 12px;
  background: var(--c-bg); border: 1px solid var(--c-border);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
}
.rollstage--rolling { border-color: var(--c-primary); }
.rollname { margin: 0; font-size: 44px; font-weight: 800; color: var(--c-primary); letter-spacing: 4px; }
.rollname.dim { color: var(--c-text-muted); font-size: 26px; letter-spacing: 0; }
.rollhint { margin: 0; font-size: 12.5px; color: var(--c-text-muted); }

.btnrow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.big { padding: 11px 26px; font-size: 15px; }
.check { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-size: 13px; font-weight: 600; }
.input { padding: 9px 11px; border: 1px solid var(--c-border); border-radius: 8px; font-size: 13.5px; background: var(--c-bg); color: var(--c-text); font-family: inherit; }
.input:focus { outline: 2px solid var(--c-primary); outline-offset: -1px; }
.textarea { resize: vertical; line-height: 1.7; }
.input--num { width: 84px; text-align: center; }
.log { border: 1px solid var(--c-border); border-radius: 8px; padding: 8px 12px; }
.log summary { cursor: pointer; font-size: 12.5px; font-weight: 600; }
.logline { margin: 8px 0 0; font-size: 13px; line-height: 1.8; }

.timerdisplay { font-size: 96px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: 4px; color: var(--c-text); }
.timerdisplay.urgent { color: var(--c-danger); animation: blink 1s infinite; }
.timerdisplay.running:not(.urgent) { color: var(--c-primary); }
@keyframes blink { 50% { opacity: 0.35; } }
.presets { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.segbtn { border: 1px solid var(--c-border); background: var(--c-bg); padding: 6px 13px; border-radius: 8px; font-size: 12.5px; cursor: pointer; color: var(--c-text); }
.segbtn:hover { border-color: var(--c-primary); color: var(--c-primary); }
.muted { margin: 0; font-size: 12px; color: var(--c-text-muted); }

.importbtn { align-self: flex-start; font-size: 12.5px; padding: 6px 12px; }
.hidden { display: none; }
.groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.gcard { background: var(--c-bg); border: 1px solid var(--c-border); border-radius: 10px; padding: 12px; }
.gcard__name { margin: 0 0 6px; font-size: 13.5px; font-weight: 700; color: var(--c-primary); }
.gcard__members { margin: 0; font-size: 13.5px; line-height: 1.8; }
</style>
