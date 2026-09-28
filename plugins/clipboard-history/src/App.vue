<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { toolbox } from '@toolbox/plugin-sdk'

const items = ref([]) // [{ id, text, time }]
const error = ref('')
const watching = ref(false)
const copiedId = ref('')
let timer = null
let lastText = null
let seq = 0
const MAX = 100

const STORE_KEY = 'clipboard_history_v1'

function loadStored() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) items.value = JSON.parse(raw).slice(0, MAX)
    if (items.value.length) lastText = items.value[0].text
  } catch {
    // 自定义协议下 localStorage 可能不可用：仅保留会话内历史
  }
}
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items.value.slice(0, MAX)))
  } catch {}
}

function nowTime() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

async function poll() {
  try {
    const text = await toolbox.readClipboardText()
    if (text === null || text === lastText || items.value[0]?.text === text) return
    lastText = text
    items.value.unshift({ id: ++seq + '_' + Date.now(), text, time: nowTime() })
    if (items.value.length > MAX) items.value.length = MAX
    persist()
  } catch (e) {
    error.value = String(e)
  }
}

function start() {
  if (watching.value) return
  watching.value = true
  poll()
  timer = setInterval(poll, 1000)
}
function stop() {
  watching.value = false
  if (timer) clearInterval(timer)
  timer = null
}

async function copyBack(item) {
  try {
    await toolbox.writeClipboardText(item.text)
    lastText = item.text // 避免把刚写入的内容再次记录
    copiedId.value = item.id
    setTimeout(() => (copiedId.value = ''), 1200)
  } catch (e) {
    error.value = String(e)
  }
}

function removeItem(id) {
  items.value = items.value.filter((x) => x.id !== id)
  persist()
}

function clearAll() {
  items.value = []
  persist()
}

function summary(text) {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > 120 ? one.slice(0, 120) + '…' : one || '（空白）'
}

onMounted(() => {
  loadStored()
  start()
})
onUnmounted(stop)
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>剪贴板历史</h1>
      <p class="header__sub">自动记录复制过的文本 · 数据仅保存在本机</p>
    </header>

    <main class="body">
      <div class="bar">
        <span class="watch" :class="{ 'watch--on': watching }">
          <span class="dot" /> {{ watching ? '正在监控剪贴板' : '已停止监控' }}
        </span>
        <button type="button" class="btn" @click="watching ? stop() : start()">{{ watching ? '暂停' : '开始' }}</button>
        <span class="spacer" />
        <span class="count">{{ items.length }} 条</span>
        <button type="button" class="link danger" @click="clearAll" v-if="items.length">清空全部</button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="!items.length" class="empty">
        <p class="empty__icon">📋</p>
        <p class="empty__title">复制任何文字（Ctrl/Cmd+C），这里会自动记录</p>
        <p class="empty__hint">点击任意条目即可放回剪贴板，随时取回</p>
      </div>

      <ul v-else class="list">
        <li v-for="item in items" :key="item.id" class="item" :class="{ 'item--copied': copiedId === item.id }">
          <div class="item__main" @click="copyBack(item)">
            <p class="item__text">{{ summary(item.text) }}</p>
            <p class="item__meta">
              {{ item.time }} · {{ item.text.length }} 字符
              <span v-if="copiedId === item.id" class="copied">已复制到剪贴板 ✓</span>
            </p>
          </div>
          <button type="button" class="link danger" @click.stop="removeItem(item.id)">删除</button>
        </li>
      </ul>

      <p class="privacy">🔒 历史仅保存在本机浏览器存储中，关闭窗口即停止记录；不会上传任何内容。</p>
    </main>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.header { text-align: center; padding: 18px 16px 8px; }
.header h1 { margin: 0 0 5px; font-size: 21px; }
.header__sub { margin: 0; font-size: 13px; color: var(--c-text-muted); }
.body { flex: 1; width: 100%; max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; padding: 8px 22px 20px; min-height: 0; }

.bar { display: flex; align-items: center; gap: 10px; }
.watch { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--c-text-muted); }
.watch--on { color: #16a34a; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c-border); }
.watch--on .dot { background: #16a34a; animation: pulse 1.6s infinite; }
@keyframes pulse { 50% { opacity: 0.35; } }
.spacer { flex: 1; }
.count { font-size: 12.5px; color: var(--c-text-muted); }
.link { border: none; background: none; color: var(--c-primary); cursor: pointer; font-size: 12.5px; padding: 2px 4px; }
.link.danger { color: var(--c-danger); }

.empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  border: 2px dashed var(--c-border); border-radius: 14px; background: var(--c-surface);
}
.empty__icon { margin: 0; font-size: 44px; }
.empty__title { margin: 0; font-size: 15px; font-weight: 600; }
.empty__hint { margin: 0; font-size: 12.5px; color: var(--c-text-muted); }

.list { list-style: none; margin: 0; padding: 0; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.item {
  display: flex; align-items: center; gap: 10px;
  background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 10px; padding: 10px 14px;
  cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.item:hover { border-color: var(--c-primary); }
.item--copied { border-color: #16a34a; background: rgba(22, 163, 74, 0.05); }
.item__main { flex: 1; min-width: 0; }
.item__text { margin: 0; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item__meta { margin: 3px 0 0; font-size: 11.5px; color: var(--c-text-muted); }
.copied { color: #16a34a; margin-left: 6px; }

.privacy { margin: 0; font-size: 11.5px; color: var(--c-text-muted); text-align: center; }
.error { margin: 0; color: var(--c-danger); font-size: 13px; }
</style>
