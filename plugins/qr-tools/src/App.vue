<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { useNativeFileDrop } from '@toolbox/plugin-sdk'
import { toolbox } from '@toolbox/plugin-sdk'

// ---------- 公共 ----------
const tab = ref('gen') // gen | scan
function switchTab(t) {
  tab.value = t
  error.value = ''
}

const error = ref('')
const savedPath = ref('')

function fmtSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // 剪贴板 API 不可用时退化为选中文本让用户 Ctrl+C
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }
}
const copied = ref(false)

// ---------- 生成 ----------
const contentType = ref('text') // text | wifi | card
const text = ref('')
const wifi = ref({ ssid: '', password: '', encryption: 'WPA', hidden: false })
const card = ref({ name: '', phone: '', email: '', org: '', url: '' })
const size = ref(512)
const ecc = ref('M')

function wifiPayload() {
  const w = wifi.value
  return `WIFI:T:${w.encryption};S:${w.ssid};P:${w.password};${w.hidden ? 'H:true;' : ''};`
}
function escVCard(s) {
  return String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n')
}
function cardPayload() {
  const c = card.value
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escVCard(c.name)}`,
    `FN:${escVCard(c.name)}`,
    c.phone ? `TEL;TYPE=CELL:${escVCard(c.phone)}` : '',
    c.email ? `EMAIL:${escVCard(c.email)}` : '',
    c.org ? `ORG:${escVCard(c.org)}` : '',
    c.url ? `URL:${escVCard(c.url)}` : '',
    'END:VCARD',
  ].filter(Boolean).join('\n')
}

const payload = computed(() => {
  try {
    if (contentType.value === 'text') return text.value
    if (contentType.value === 'wifi') return wifi.value.ssid ? wifiPayload() : ''
    if (contentType.value === 'card') return card.value.name ? cardPayload() : ''
  } catch (e) {
    error.value = String(e)
  }
  return ''
})

const canvasEl = ref(null)
const empty = computed(() => !payload.value.trim())

watch([payload, size, ecc], render, { deep: true })
onMounted(render)
async function render() {
  await nextTick()
  if (!canvasEl.value) return
  if (empty.value) {
    const ctx = canvasEl.value.getContext('2d')
    ctx.clearRect(0, 0, canvasEl.value.width, canvasEl.value.height)
    return
  }
  try {
    await QRCode.toCanvas(canvasEl.value, payload.value, {
      width: Number(size.value),
      errorCorrectionLevel: ecc.value,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    })
    error.value = ''
  } catch (e) {
    error.value = `生成失败：${e}`
  }
}

async function savePng() {
  if (empty.value) return
  // 用离屏 canvas 按选择尺寸导出（确保与预览一致）
  const off = document.createElement('canvas')
  await QRCode.toCanvas(off, payload.value, {
    width: Number(size.value),
    errorCorrectionLevel: ecc.value,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  })
  const dataUrl = off.toDataURL('image/png')
  const bin = atob(dataUrl.split(',')[1])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const nameHint = payload.value.slice(0, 24).replace(/[\\/:*?"<>|\s]+/g, '_') || 'qrcode'
  const path = await toolbox.pickSaveFile({
    defaultName: `二维码_${nameHint}.png`,
    filters: [{ name: 'PNG', extensions: ['png'] }],
    bytes,
  })
  if (path) savedPath.value = path
}

// ---------- 识别 ----------
const scanPreview = ref('')
const scanResult = ref('')
const scanIsWifi = ref(false)
const scanWifi = ref({ ssid: '', password: '', encryption: '' })
const scanDragging = ref(false)
const fileInput = ref(null)

let unlistenNativeDrop = () => {}
onMounted(() => {
  unlistenNativeDrop = useNativeFileDrop({
    onFiles: (files) => handleScanFile(files?.[0]),
    onDragState: (v) => {
      scanDragging.value = v
    },
  })
})
onUnmounted(() => unlistenNativeDrop())

function parseWifiPayload(s) {
  const get = (k) => {
    const m = s.match(new RegExp(`${k}:((?:\\\\.|[^;])*);`))
    return m ? m[1].replace(/\\(.)/g, '$1') : ''
  }
  return { ssid: get('S'), password: get('P'), encryption: get('T') }
}

async function handleScanFile(f) {
  if (!f) return
  error.value = ''
  scanResult.value = ''
  scanPreview.value = ''
  scanIsWifi.value = false
  try {
    const url = URL.createObjectURL(f)
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = () => reject(new Error('系统无法解码该图片格式（HEIC 请先转为 JPG/PNG）'))
      img.src = url
    })
    const maxDim = 1600
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height, 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(img.width * scale))
    canvas.height = Math.max(1, Math.floor(img.height * scale))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    scanPreview.value = canvas.toDataURL('image/png')

    let code = null
    // 原图 + 放大两档尝试，提高小码识别率
    for (const s of [1, 2]) {
      const w = canvas.width * s
      const h = canvas.height * s
      const c2 = document.createElement('canvas')
      c2.width = Math.floor(w)
      c2.height = Math.floor(h)
      const ctx2 = c2.getContext('2d', { willReadFrequently: true })
      ctx2.imageSmoothingEnabled = s > 1
      ctx2.drawImage(canvas, 0, 0, c2.width, c2.height)
      code = jsQR(ctx2.getImageData(0, 0, c2.width, c2.height).data, c2.width, c2.height)
      if (code) break
    }
    if (!code) {
      error.value = '未在图片中找到二维码（可尝试更清晰/更大的截图）'
      return
    }
    scanResult.value = code.data
    if (code.data.startsWith('WIFI:')) {
      scanIsWifi.value = true
      scanWifi.value = parseWifiPayload(code.data)
    }
  } catch (e) {
    error.value = `识别失败：${e.message || e}`
  }
}
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>二维码工具</h1>
      <p class="header__sub">生成与识别全离线 · 图片不外传</p>
    </header>

    <main class="body">
      <div class="tabs">
        <button type="button" class="tab" :class="{ 'tab--active': tab === 'gen' }" @click="switchTab('gen')">生成二维码</button>
        <button type="button" class="tab" :class="{ 'tab--active': tab === 'scan' }" @click="switchTab('scan')">识别二维码</button>
      </div>

      <!-- 生成 -->
      <section v-if="tab === 'gen'" class="gen">
        <div class="ctabs">
          <button type="button" class="ctab" :class="{ 'ctab--active': contentType === 'text' }" @click="contentType = 'text'">文本 / 网址</button>
          <button type="button" class="ctab" :class="{ 'ctab--active': contentType === 'wifi' }" @click="contentType = 'wifi'">WiFi</button>
          <button type="button" class="ctab" :class="{ 'ctab--active': contentType === 'card' }" @click="contentType = 'card'">名片</button>
        </div>

        <div v-if="contentType === 'text'" class="field">
          <textarea v-model="text" class="input textarea" rows="4" placeholder="输入文字或网址，例如 https://example.com"></textarea>
        </div>

        <div v-else-if="contentType === 'wifi'" class="grid">
          <label class="gfield"><span>WiFi 名称 (SSID)</span><input v-model="wifi.ssid" class="input" placeholder="WiFi 名称" /></label>
          <label class="gfield"><span>密码</span><input v-model="wifi.password" class="input" placeholder="WiFi 密码" /></label>
          <label class="gfield"><span>加密方式</span>
            <select v-model="wifi.encryption" class="input">
              <option value="WPA">WPA / WPA2 / WPA3（常用）</option>
              <option value="WEP">WEP（老旧）</option>
              <option value="nopass">无密码</option>
            </select>
          </label>
          <label class="gfield gfield--check"><input v-model="wifi.hidden" type="checkbox" /> 隐藏网络</label>
        </div>

        <div v-else class="grid">
          <label class="gfield"><span>姓名 *</span><input v-model="card.name" class="input" /></label>
          <label class="gfield"><span>电话</span><input v-model="card.phone" class="input" /></label>
          <label class="gfield"><span>邮箱</span><input v-model="card.email" class="input" /></label>
          <label class="gfield"><span>单位</span><input v-model="card.org" class="input" /></label>
          <label class="gfield"><span>网址</span><input v-model="card.url" class="input" /></label>
        </div>

        <div class="opts">
          <label class="opt"><span>尺寸 {{ size }}px</span><input v-model.number="size" type="range" min="256" max="1024" step="64" /></label>
          <label class="opt"><span>纠错</span>
            <select v-model="ecc" class="input input--sm">
              <option value="L">低（容量大）</option>
              <option value="M">中（推荐）</option>
              <option value="Q">较高</option>
              <option value="H">高（可遮挡）</option>
            </select>
          </label>
        </div>

        <div class="preview">
          <canvas ref="canvasEl" class="qrcanvas" />
          <p v-if="empty" class="muted">填写左侧内容后自动生成</p>
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <div class="actions">
          <button type="button" class="btn btn--primary" :disabled="empty" @click="savePng">保存 PNG（{{ size }}px）</button>
        </div>
        <p v-if="savedPath" class="muted">已保存到 {{ savedPath }}</p>
      </section>

      <!-- 识别 -->
      <section v-else class="scan">
        <div
          class="dropzone"
          :class="{ 'dropzone--drag': scanDragging }"
          @dragover.prevent="scanDragging = true"
          @dragleave="scanDragging = false"
          @drop.prevent="((scanDragging = false), handleScanFile($event.dataTransfer?.files?.[0]))"
          @click="fileInput?.click()"
        >
          <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="handleScanFile($event.target.files?.[0]); fileInput.value = ''" />
          <p class="dropzone__title">拖入二维码图片，或点击选择</p>
          <p class="dropzone__hint">支持 JPG / PNG / WebP 截图与拍照</p>
        </div>

        <div v-if="scanPreview" class="scanresult">
          <img :src="scanPreview" class="scanresult__img" alt="" />
          <div class="scanresult__body">
            <template v-if="scanIsWifi">
              <p class="scanresult__label">这是一个 WiFi 二维码：</p>
              <p class="scanresult__text">名称：{{ scanWifi.ssid }}</p>
              <p class="scanresult__text">密码：{{ scanWifi.password || '（无）' }}</p>
              <p class="scanresult__text">加密：{{ scanWifi.encryption }}</p>
            </template>
            <template v-else>
              <p class="scanresult__label">识别结果：</p>
              <textarea class="input textarea" rows="4" readonly :value="scanResult"></textarea>
            </template>
            <button type="button" class="btn btn--primary" @click="copyText(scanResult)">
              {{ copied ? '已复制 ✓' : '复制内容' }}
            </button>
          </div>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; align-items: center; overflow-y: auto; }
.header { text-align: center; padding: 20px 16px 8px; }
.header h1 { margin: 0 0 6px; font-size: 22px; }
.header__sub { margin: 0; font-size: 13px; color: var(--c-text-muted); }
.body { width: 100%; max-width: 760px; display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 6px 24px 32px; }

.tabs { width: 100%; display: grid; grid-template-columns: 1fr 1fr; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 4px; gap: 4px; }
.tab { border: none; background: transparent; padding: 10px; font-size: 14px; font-weight: 600; border-radius: 8px; cursor: pointer; color: var(--c-text-muted); }
.tab--active { background: var(--c-primary); color: #fff; }

.ctabs { display: flex; gap: 8px; }
.ctab { border: 1px solid var(--c-border); background: var(--c-surface); padding: 7px 14px; border-radius: 999px; font-size: 13px; cursor: pointer; color: var(--c-text-muted); }
.ctab--active { border-color: var(--c-primary); color: var(--c-primary); background: rgba(59, 130, 246, 0.06); }

.gen, .scan { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.grid { width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.gfield { display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 600; }
.gfield--check { flex-direction: row; align-items: center; gap: 8px; align-self: end; padding-bottom: 8px; }
.field { width: 100%; display: flex; flex-direction: column; gap: 6px; }
.input { padding: 9px 11px; border: 1px solid var(--c-border); border-radius: 8px; font-size: 14px; background: var(--c-bg); color: var(--c-text); font-family: inherit; }
.input:focus { outline: 2px solid var(--c-primary); outline-offset: -1px; }
.input--sm { width: auto; }
.input textarea, .textarea { resize: vertical; line-height: 1.6; }

.opts { display: flex; gap: 22px; align-items: center; }
.opt { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--c-text-muted); }

.preview { display: flex; flex-direction: column; align-items: center; gap: 8px; min-height: 200px; }
.qrcanvas { border: 1px solid var(--c-border); border-radius: 10px; background: #fff; }
.actions { display: flex; gap: 12px; }

.scan { width: 100%; }
.dropzone {
  width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 170px; border: 2px dashed var(--c-border); border-radius: 14px;
  background: var(--c-surface); cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.dropzone:hover, .dropzone--drag { border-color: var(--c-primary); background: rgba(59, 130, 246, 0.05); }
.dropzone__title { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
.dropzone__hint { margin: 0; font-size: 12.5px; color: var(--c-text-muted); }
.hidden { display: none; }

.scanresult { width: 100%; display: flex; gap: 16px; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 16px; }
.scanresult__img { width: 180px; height: auto; border-radius: 8px; border: 1px solid var(--c-border); align-self: start; }
.scanresult__body { flex: 1; display: flex; flex-direction: column; gap: 10px; }
.scanresult__label { margin: 0; font-weight: 700; font-size: 14px; }
.scanresult__text { margin: 0; font-size: 14px; }

.muted { margin: 0; font-size: 13px; color: var(--c-text-muted); }
.error { margin: 0; color: var(--c-danger); font-size: 13px; }
</style>
