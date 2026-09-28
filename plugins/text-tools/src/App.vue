<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { toolbox, useNativeFileDrop } from '@toolbox/plugin-sdk'
import * as OpenCC from 'opencc-js'
import { pinyin } from 'pinyin-pro'

const input = ref('')
const output = ref('')
const error = ref('')
const notice = ref('')
const dragging = ref(false)
const fileInput = ref(null)

// 简繁方向
const ccFrom = ref('cn')
const ccTo = ref('twp')
// 拼音样式
const pyTone = ref('symbol') // symbol | num | none

const stats = computed(() => {
  const s = input.value
  if (!s) return null
  const noSpace = s.replace(/\s/g, '')
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length
  const words = (s.match(/[A-Za-z0-9]+/g) || []).length
  const lines = s ? s.split('\n').length : 0
  const paras = s.split(/\n+/).filter((x) => x.trim()).length
  const utf8 = new TextEncoder().encode(s).length
  return {
    chars: s.length,
    charsNoSpace: noSpace.length,
    cjk,
    words,
    lines,
    paras,
    bytes: utf8,
  }
})

let cn2tw = null
let tw2cn = null
let cn2hk = null
function converter(from, to) {
  // Converter 对象可复用（内部缓存词典），懒加载
  return OpenCC.Converter({ from, to })
}

function apply(fn) {
  error.value = ''
  if (!input.value.trim()) {
    notice.value = '请先在上方输入文字'
    return
  }
  notice.value = ''
  try {
    output.value = fn(input.value)
  } catch (e) {
    error.value = `处理失败：${e.message || e}`
  }
}

function toTraditional() {
  cn2tw = cn2tw || converter('cn', 'twp')
  apply((s) => cn2tw(s))
}
function toSimplified() {
  tw2cn = tw2cn || converter('t', 'cn')
  apply((s) => tw2cn(s))
}
function toHongKong() {
  cn2hk = cn2hk || converter('cn', 'hk')
  apply((s) => cn2hk(s))
}
function addPinyin() {
  apply((s) => pinyin(s, { toneType: pyTone.value, type: 'string', nonZh: 'consecutive' }))
}

// 整理类：直接变换
function transform(fn) {
  apply(fn)
}
const tools = [
  { name: '去除多余空白', fn: (s) => s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim() },
  { name: '去除全部空格', fn: (s) => s.replace(/[ \t]/g, '') },
  { name: '去除空行', fn: (s) => s.split('\n').filter((l) => l.trim()).join('\n') },
  { name: '每行去首尾空格', fn: (s) => s.split('\n').map((l) => l.trim()).join('\n') },
  { name: '行去重', fn: (s) => [...new Set(s.split('\n'))].join('\n') },
  { name: '行排序 A→Z', fn: (s) => s.split('\n').sort((a, b) => a.localeCompare(b, 'zh')).join('\n') },
  { name: '行倒序', fn: (s) => s.split('\n').reverse().join('\n') },
  { name: '添加行号', fn: (s) => s.split('\n').map((l, i) => `${i + 1}. ${l}`).join('\n') },
  { name: '全角→半角', fn: (s) => s.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ') },
  { name: '半角→全角', fn: (s) => s.replace(/[\x21-\x7e]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)) },
  { name: '英文大写', fn: (s) => s.toUpperCase() },
  { name: '英文小写', fn: (s) => s.toLowerCase() },
]

async function copyOut() {
  if (!output.value) return
  try {
    await navigator.clipboard.writeText(output.value)
    notice.value = '已复制到剪贴板'
    setTimeout(() => (notice.value = ''), 1500)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = output.value
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    notice.value = '已复制到剪贴板'
    setTimeout(() => (notice.value = ''), 1500)
  }
}

async function saveTxt() {
  if (!output.value) return
  const path = await toolbox.pickSaveFile({
    defaultName: '处理后文本.txt',
    filters: [{ name: '文本', extensions: ['txt'] }],
    bytes: new TextEncoder().encode(output.value),
  })
  if (path) notice.value = `已保存到 ${path}`
}

async function loadTxt(f) {
  if (!f) return
  if (!/\.(txt|md|csv|log|json)$/i.test(f.name)) {
    error.value = '请选择文本文件（txt / md / csv / log / json）'
    return
  }
  try {
    const bytes = new Uint8Array(await f.arrayBuffer())
    input.value = new TextDecoder('utf-8').decode(bytes)
    output.value = ''
    error.value = ''
  } catch (e) {
    error.value = `读取文件失败：${e}`
  }
}

function swap() {
  const t = input.value
  input.value = output.value
  output.value = t
}

function clearAll() {
  input.value = ''
  output.value = ''
  error.value = ''
  notice.value = ''
}

let unlistenNativeDrop = () => {}
onMounted(() => {
  unlistenNativeDrop = useNativeFileDrop({
    onFiles: (list) => loadTxt(list?.[0]),
    onDragState: (v) => {
      dragging.value = v
    },
  })
})
onUnmounted(() => unlistenNativeDrop())
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>文本工具</h1>
      <p class="header__sub">统计 · 简繁 · 拼音 · 批量整理 · 全部本地处理</p>
    </header>

    <main class="body">
      <!-- 输入 -->
      <div
        class="inwrap"
        :class="{ 'inwrap--drag': dragging }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="((dragging = false), loadTxt($event.dataTransfer?.files?.[0]))"
      >
        <textarea v-model="input" class="io" placeholder="在此输入或粘贴文字…（也可拖入 txt 文件）"></textarea>
        <button type="button" class="btn uploadbtn" @click="fileInput?.click()">
          <input ref="fileInput" type="file" accept=".txt,.md,.csv,.log,.json" class="hidden" @change="loadTxt($event.target.files?.[0]); fileInput.value = ''" />
          打开文本文件
        </button>
        <div v-if="stats" class="stats">
          <span>{{ stats.chars }} 字符</span><i />
          <span>不含空格 {{ stats.charsNoSpace }}</span><i />
          <span>汉字 {{ stats.cjk }}</span><i />
          <span>英文单词 {{ stats.words }}</span><i />
          <span>{{ stats.lines }} 行 / {{ stats.paras }} 段</span><i />
          <span>{{ stats.bytes }} 字节(UTF-8)</span>
        </div>
      </div>

      <!-- 工具区 -->
      <div class="groups">
        <div class="group">
          <p class="group__title">简繁转换</p>
          <div class="btns">
            <button type="button" class="tool" @click="toTraditional">简 → 繁(台)</button>
            <button type="button" class="tool" @click="toHongKong">简 → 繁(港)</button>
            <button type="button" class="tool" @click="toSimplified">繁 → 简</button>
          </div>
        </div>
        <div class="group">
          <p class="group__title">拼音标注</p>
          <div class="btns">
            <select v-model="pyTone" class="input input--sm">
              <option value="symbol">声调符号 (hàn)</option>
              <option value="num">数字声调 (han4)</option>
              <option value="none">无声调 (han)</option>
            </select>
            <button type="button" class="tool" @click="addPinyin">转为拼音</button>
          </div>
        </div>
        <div class="group group--wide">
          <p class="group__title">整理</p>
          <div class="btns">
            <button v-for="t in tools" :key="t.name" type="button" class="tool" @click="transform(t.fn)">{{ t.name }}</button>
          </div>
        </div>
      </div>

      <!-- 输出 -->
      <div class="outwrap">
        <textarea v-model="output" class="io" placeholder="结果会显示在这里…"></textarea>
        <div class="outbtns">
          <button type="button" class="btn btn--primary" :disabled="!output" @click="copyOut">复制结果</button>
          <button type="button" class="btn" :disabled="!output" @click="saveTxt">另存为 txt</button>
          <button type="button" class="btn" :disabled="!input && !output" @click="swap">输入⇄输出</button>
          <button type="button" class="btn" @click="clearAll">清空</button>
        </div>
      </div>

      <p v-if="notice" class="notice">{{ notice }}</p>
      <p v-if="error" class="error">{{ error }}</p>
    </main>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; overflow-y: auto; }
.header { text-align: center; padding: 16px 16px 6px; }
.header h1 { margin: 0 0 5px; font-size: 21px; }
.header__sub { margin: 0; font-size: 13px; color: var(--c-text-muted); }
.body { width: 100%; max-width: 880px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; padding: 6px 22px 20px; }

.inwrap, .outwrap { position: relative; display: flex; flex-direction: column; }
.inwrap--drag :deep(.io) { border-color: var(--c-primary); background: rgba(59, 130, 246, 0.04); }
.io {
  width: 100%; box-sizing: border-box; min-height: 110px; padding: 12px 14px;
  border: 1px solid var(--c-border); border-radius: 12px; background: var(--c-surface);
  font-size: 14px; line-height: 1.7; color: var(--c-text); font-family: inherit; resize: vertical;
}
.io:focus { outline: 2px solid var(--c-primary); outline-offset: -1px; }
.uploadbtn { position: absolute; top: 8px; right: 10px; font-size: 12px; padding: 4px 10px; }
.hidden { display: none; }

.stats { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 12px; color: var(--c-text-muted); margin-top: 6px; }
.stats i { width: 1px; height: 10px; background: var(--c-border); }

.groups { display: flex; flex-direction: column; gap: 8px; }
.group { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 10px; padding: 8px 12px; }
.group--wide .btns { flex-wrap: wrap; }
.group__title { margin: 0 0 6px; font-size: 12px; font-weight: 700; color: var(--c-text-muted); }
.btns { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tool {
  border: 1px solid var(--c-border); background: var(--c-bg); color: var(--c-text);
  padding: 6px 12px; border-radius: 8px; font-size: 12.5px; cursor: pointer;
}
.tool:hover { border-color: var(--c-primary); color: var(--c-primary); }

.input { padding: 6px 9px; border: 1px solid var(--c-border); border-radius: 8px; font-size: 12.5px; background: var(--c-bg); color: var(--c-text); font-family: inherit; }
.input--sm { width: auto; }
.outbtns { display: flex; gap: 10px; margin-top: 8px; }

.notice { margin: 0; font-size: 12.5px; color: #16a34a; }
.error { margin: 0; color: var(--c-danger); font-size: 13px; }
</style>
