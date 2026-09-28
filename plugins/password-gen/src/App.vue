<script setup>
import { ref, computed } from 'vue'

const length = ref(16)
const useUpper = ref(true)
const useLower = ref(true)
const useDigit = ref(true)
const useSymbol = ref(true)
const excludeAmbiguous = ref(true)
const batchCount = ref(5)
const list = ref([])
const copiedIdx = ref(-1)

const SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digit: '0123456789',
  symbol: '!@#$%^&*()-_=+[]{};:,.?',
}
const AMBIGUOUS = /[0O1lI|`'"]/g

const pool = computed(() => {
  let s = ''
  if (useUpper.value) s += SETS.upper
  if (useLower.value) s += SETS.lower
  if (useDigit.value) s += SETS.digit
  if (useSymbol.value) s += SETS.symbol
  if (excludeAmbiguous.value) s = s.replace(AMBIGUOUS, '')
  return [...new Set(s.split(''))].join('')
})

const entropy = computed(() => {
  const n = pool.value.length
  return n > 1 ? Math.round(Number(length.value) * Math.log2(n)) : 0
})
const strength = computed(() => {
  const e = entropy.value
  if (e < 40) return { label: '弱', color: '#dc2626' }
  if (e < 60) return { label: '中', color: '#d97706' }
  if (e < 80) return { label: '强', color: '#16a34a' }
  return { label: '极强', color: '#16a34a' }
})
const poolNote = computed(() => `字符池 ${pool.value.length} 个`)

function randInt(max) {
  // 无偏随机（拒绝采样）
  const limit = Math.floor(0xffffffff / max) * max
  const buf = new Uint32Array(1)
  let v
  do {
    crypto.getRandomValues(buf)
    v = buf[0]
  } while (v >= limit)
  return v % max
}

function generateOne() {
  const chars = pool.value.split('')
  if (!chars.length) return ''
  const out = []
  for (let i = 0; i < Number(length.value); i++) out.push(chars[randInt(chars.length)])
  return out.join('')
}

function generate() {
  error.value = ''
  const n = Math.min(50, Math.max(1, Number(batchCount.value) || 1))
  if (!pool.value.length) {
    error.value = '请至少选择一种字符类型'
    return
  }
  list.value = Array.from({ length: n }, () => generateOne())
}

async function copyOne(pw, i) {
  try {
    await navigator.clipboard.writeText(pw)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = pw
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copiedIdx.value = i
  setTimeout(() => (copiedIdx.value = -1), 1200)
}

async function copyAll() {
  await copyOne(list.value.join('\n'), -2)
  copiedIdx.value = -2
  setTimeout(() => (copiedIdx.value = -1), 1200)
}

const error = ref('')
generate()
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>密码生成器</h1>
      <p class="header__sub">加密级随机数 · 纯本地生成，不联网</p>
    </header>

    <main class="body">
      <div class="panel">
        <div class="row">
          <span class="row__label">长度 {{ length }} 位</span>
          <input v-model.number="length" type="range" min="6" max="64" class="grow" />
        </div>
        <div class="row row--wrap">
          <span class="row__label">包含</span>
          <label class="check"><input v-model="useUpper" type="checkbox" /> 大写 A-Z</label>
          <label class="check"><input v-model="useLower" type="checkbox" /> 小写 a-z</label>
          <label class="check"><input v-model="useDigit" type="checkbox" /> 数字 0-9</label>
          <label class="check"><input v-model="useSymbol" type="checkbox" /> 符号 !@#</label>
          <label class="check"><input v-model="excludeAmbiguous" type="checkbox" /> 排除易混淆 (0O1lI)</label>
        </div>
        <div class="row">
          <span class="row__label">强度</span>
          <span class="strength" :style="{ color: strength.color }">{{ strength.label }}</span>
          <span class="muted">熵约 {{ entropy }} bit · {{ poolNote }}</span>
        </div>
        <div class="row">
          <span class="row__label">数量</span>
          <input v-model.number="batchCount" type="number" min="1" max="50" class="input input--num" />
          <button type="button" class="btn btn--primary" @click="generate">重新生成</button>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
      </div>

      <ul class="list">
        <li v-for="(pw, i) in list" :key="i" class="item" @click="copyOne(pw, i)">
          <code class="pw">{{ pw }}</code>
          <span class="copied" v-if="copiedIdx === i">已复制 ✓</span>
          <span v-else class="hint">点击复制</span>
        </li>
      </ul>
      <div class="allrow" v-if="list.length > 1">
        <button type="button" class="link" @click="copyAll">复制全部（{{ copiedIdx === -2 ? '已复制 ✓' : '每行一个' }}）</button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; overflow-y: auto; }
.header { text-align: center; padding: 18px 16px 6px; }
.header h1 { margin: 0 0 5px; font-size: 21px; }
.header__sub { margin: 0; font-size: 13px; color: var(--c-text-muted); }
.body { flex: 1; width: 100%; max-width: 680px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; padding: 8px 22px 24px; }

.panel { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.row--wrap { row-gap: 8px; }
.row__label { font-size: 13px; font-weight: 600; min-width: 68px; }
.grow { flex: 1; }
.check { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.strength { font-size: 16px; font-weight: 800; }
.muted { font-size: 12px; color: var(--c-text-muted); }
.input { padding: 8px 10px; border: 1px solid var(--c-border); border-radius: 8px; font-size: 13px; background: var(--c-bg); color: var(--c-text); font-family: inherit; }
.input--num { width: 76px; text-align: center; }

.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.item {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 10px;
  padding: 11px 14px; cursor: pointer; transition: border-color 0.15s;
}
.item:hover { border-color: var(--c-primary); }
.pw { font-size: 15px; font-family: 'SF Mono', Menlo, Consolas, monospace; letter-spacing: 0.5px; word-break: break-all; }
.hint { font-size: 11.5px; color: var(--c-text-muted); flex-shrink: 0; }
.copied { font-size: 12.5px; color: #16a34a; flex-shrink: 0; }
.allrow { text-align: center; }
.error { margin: 0; color: var(--c-danger); font-size: 13px; }
</style>
