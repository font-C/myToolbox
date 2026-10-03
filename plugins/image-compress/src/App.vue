<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { toolbox } from '@toolbox/plugin-sdk'
import { useNativeFileDrop } from '@toolbox/plugin-sdk'
import { zipSync } from 'fflate'
import { jpegSetDpi, pngSetDpi } from './dpiMeta'

const files = ref([]) // [{ file, name, bytes, w, h, url }]
const currentIdx = ref(0)
const view = ref('preview') // preview | result
const results = ref([]) // [{ name, bytes, origSize, w, h, skippedOnly?, dpiOnly? }]
const processing = ref(false)
const progress = ref(0)
const error = ref('')
const savedPath = ref('')
const dragging = ref(false)
const fileInput = ref(null)

// 全局设置（弹框「好」后生效）
const settings = reactive({
  format: 'image/jpeg', // image/jpeg | image/png | image/webp
  quality: 75,
  resize: { unit: 'px', w: 0, h: 0, lock: true, resValue: 28.35, resUnit: 'cm', resample: true },
  watermark: { enabled: false, text: '© 我的水印', size: 28, opacity: 40, pos: 'br', color: '#ffffff' },
})

// 弹框编辑副本（取消丢弃、好应用）
const resizeOpen = ref(false)
const resizeDraft = ref(null)
const wmOpen = ref(false)
const wmDraft = ref(null)

// —— 设置持久化（宿主 storage）：重启后保留 ——
const SETTINGS_KEY = 'settings'
let settingsHydrated = false
onMounted(async () => {
  try {
    const saved = await toolbox.storageGet(SETTINGS_KEY)
    if (saved && typeof saved === 'object') {
      if (['image/jpeg', 'image/png', 'image/webp'].includes(saved.format)) settings.format = saved.format
      if (Number.isFinite(saved.quality)) settings.quality = Math.min(100, Math.max(1, saved.quality))
      if (saved.resize && typeof saved.resize === 'object') Object.assign(settings.resize, saved.resize)
      if (saved.watermark && typeof saved.watermark === 'object') Object.assign(settings.watermark, saved.watermark)
    }
  } catch {}
  settingsHydrated = true
})
watch(
  settings,
  () => {
    if (!settingsHydrated) return
    toolbox.storageSet(SETTINGS_KEY, JSON.parse(JSON.stringify(settings))).catch(() => {})
  },
  { deep: true }
)

const extOf = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const formatNames = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' }
const unitNames = { px: '像素', mm: '毫米', cm: '厘米', in: '英寸' }

function fmtSize(n) {
  if (n === undefined || n === null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const totalOrig = computed(() => files.value.reduce((s, f) => s + (f.bytes?.length || 0), 0))
const totalNew = computed(() => results.value.reduce((s, r) => s + (r.skippedOnly ? 0 : r.bytes.length), 0))
const ratio = computed(() => {
  if (!totalOrig.value || !totalNew.value) return 0
  return Math.max(0, Math.round((1 - totalNew.value / totalOrig.value) * 100))
})

const current = computed(() => files.value[currentIdx.value] || null)

let unlistenNativeDrop = () => {}
onMounted(() => {
  unlistenNativeDrop = useNativeFileDrop({
    onFiles: (list) => addFiles(list),
    onDragState: (v) => {
      dragging.value = v
    },
  })
})
onUnmounted(() => {
  unlistenNativeDrop()
  files.value.forEach((f) => f.url && URL.revokeObjectURL(f.url))
})

function onInputChange(e) {
  addFiles(e.target.files)
  if (fileInput.value) fileInput.value.value = ''
}

function addFiles(list) {
  // FileList 是类数组没有 .filter，必须先转数组（拖拽路径传入的才是真数组）
  const imgs = Array.from(list || []).filter((f) => /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name))
  if (!imgs.length) {
    error.value = '请选择图片文件（JPG / PNG / WebP / HEIC）'
    return
  }
  error.value = ''
  results.value = []
  savedPath.value = ''
  view.value = 'preview'
  for (const f of imgs) {
    if (files.value.some((x) => x.name === f.name && x.bytes?.length)) continue
    files.value.push({ file: f, name: f.name, bytes: new Uint8Array(), w: 0, h: 0, url: URL.createObjectURL(f) })
  }
  // 异步读取字节与尺寸
  files.value
    .filter((x) => !x.bytes.length)
    .forEach(async (x) => {
      try {
        x.bytes = new Uint8Array(await x.file.arrayBuffer())
      } catch {
        x.bytes = new Uint8Array(0)
      }
      try {
        const img = new Image()
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = () => reject(new Error('decode fail'))
          img.src = x.url
        })
        x.w = img.naturalWidth
        x.h = img.naturalHeight
      } catch {
        x.w = 0
        x.h = 0
      }
    })
  currentIdx.value = Math.max(0, files.value.length - imgs.length)
}

function removeAt(i) {
  const f = files.value[i]
  if (f?.url) URL.revokeObjectURL(f.url)
  files.value.splice(i, 1)
  results.value = []
  savedPath.value = ''
  if (currentIdx.value >= files.value.length) currentIdx.value = Math.max(0, files.value.length - 1)
}

function clearAll() {
  files.value.forEach((f) => f.url && URL.revokeObjectURL(f.url))
  files.value = []
  results.value = []
  savedPath.value = ''
  error.value = ''
  currentIdx.value = 0
  view.value = 'preview'
}

// ---------- 调整大小（弹框） ----------
function openResize() {
  const f = files.value.find((x) => x.w > 0)
  const d = { ...settings.resize }
  if ((!d.w || !d.h) && f) {
    d.w = f.w
    d.h = f.h
  }
  resizeDraft.value = d
  resizeOpen.value = true
}
function cancelResize() {
  resizeOpen.value = false
}
function applyResize() {
  if (resizeDraft.value) settings.resize = { ...resizeDraft.value }
  resizeOpen.value = false
}

/** 每英寸像素数（DPI） */
function dpiPerInch(cfg) {
  const v = Number(cfg.resValue)
  return cfg.resUnit === 'cm' ? v * 2.54 : v || 72
}

/**
 * 计算某张图的目标输出
 * @returns {{ w:number, h:number, dpi:number|null, resample:boolean }}
 */
function computeTarget(cfg, item) {
  const srcW = item?.w || 0
  const srcH = item?.h || 0
  const unit = cfg.unit
  const wv = Number(cfg.w) || 0
  const hv = Number(cfg.h) || 0
  if (unit === 'px') {
    const w = Math.max(1, Math.round(wv))
    const h = cfg.lock ? Math.max(1, Math.round((w * srcH) / srcW)) : Math.max(1, Math.round(hv))
    return { w, h, dpi: null, resample: true }
  }
  const dpi = dpiPerInch(cfg)
  const wPx = targetPx(wv, unit, cfg)
  const dpiOut = Math.round(dpi)
  if (!cfg.resample) {
    // 仅改 DPI：像素保持原样，打印尺寸 = 像素 / 新DPI
    return { w: srcW, h: srcH, dpi: dpiOut, resample: false }
  }
  const w = wPx
  const h = cfg.lock ? Math.max(1, Math.round((w * srcH) / srcW)) : Math.max(1, targetPx(hv, unit, cfg))
  return { w, h, dpi: dpiOut, resample: true }
}

function targetPx(value, unit, cfg) {
  if (unit === 'px') return Math.max(1, Math.round(value))
  const div = unit === 'mm' ? 25.4 : unit === 'cm' ? 2.54 : 1
  return Math.max(1, Math.round((value / div) * dpiPerInch(cfg)))
}

const resizeSummary = computed(() => {
  const c = settings.resize
  if (!c.w) return '未调整'
  if (c.unit === 'px') return `${c.w} × ${c.h} px${c.lock ? ' · 锁比例' : ''}`
  const res = c.resUnit === 'in' ? `${dpiPerInch(c).toFixed(0)} DPI` : `${c.resValue} 像素/厘米`
  return `${c.w} × ${c.h} ${unitNames[c.unit]} @ ${res}${c.resample ? '' : ' · 仅改DPI'}`
})

/** 弹框中的目标预览（基于第一张有尺寸的图） */
const draftPreview = computed(() => {
  const d = resizeDraft.value
  const f = files.value.find((x) => x.w > 0)
  if (!d || !f) return null
  const t = computeTarget(d, f)
  const pct = f.w ? Math.round((t.w / f.w) * 100) : 100
  return { t, pct, srcW: f.w, srcH: f.h }
})

function onDraftW() {
  const d = resizeDraft.value
  const f = files.value.find((x) => x.w > 0)
  if (!d || !f || !d.lock) return
  if (d.w > 0) d.h = Math.round((d.w * f.h) / f.w)
}

// ---------- 水印（弹框） ----------
function openWm() {
  wmDraft.value = { ...settings.watermark }
  wmOpen.value = true
}
function applyWm() {
  if (wmDraft.value) {
    wmDraft.value.enabled = !!wmDraft.value.text.trim()
    settings.watermark = { ...wmDraft.value }
  }
  wmOpen.value = false
}

function drawWatermark(ctx, w, h, wm) {
  if (!wm.enabled || !wm.text.trim()) return
  const fs = Math.max(14, Math.round((wm.size * Math.max(w, h)) / 1000))
  ctx.font = `${fs}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillStyle = wm.color
  ctx.globalAlpha = wm.opacity / 100
  ctx.textBaseline = 'top'
  const text = wm.text
  const m = ctx.measureText(text)
  const pad = Math.round(fs * 0.6)
  if (wm.pos === 'tile') {
    const stepX = m.width + fs * 2
    const stepY = fs * 3
    ctx.rotate(-0.35)
    for (let y = -h; y < h * 1.5; y += stepY) {
      for (let x = -w; x < w * 1.5; x += stepX) ctx.fillText(text, x, y)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  } else {
    const x = wm.pos[1] === 'l' ? pad : wm.pos[1] === 'c' ? (w - m.width) / 2 : w - m.width - pad
    const y = wm.pos[0] === 't' ? pad : wm.pos[0] === 'c' ? (h - fs) / 2 : h - fs - pad
    ctx.fillText(text, x, y)
  }
  ctx.globalAlpha = 1
}

// ---------- 处理 ----------
async function processOne(item) {
  const t = computeTarget(settings.resize, item)
  const base = item.name.replace(/\.[^.]+$/, '')
  const outName = `${base}.${extOf[settings.format]}`

  // 仅改 DPI：不重编码，直接改原文件字节（要求输出格式与原图一致）
  if (!t.resample) {
    const isJpgSrc = /\.jpe?g$/i.test(item.name)
    const isPngSrc = /\.png$/i.test(item.name)
    const sameType = (isJpgSrc && settings.format === 'image/jpeg') || (isPngSrc && settings.format === 'image/png')
    if (settings.format === 'image/webp' || !sameType) {
      return { name: outName, bytes: item.bytes, origSize: item.bytes.length, skippedOnly: '仅改 DPI 需输出格式与原图一致（JPEG/PNG），或改用「重新采样」' }
    }
    const patched = settings.format === 'image/jpeg' ? jpegSetDpi(item.bytes, t.dpi) : pngSetDpi(item.bytes, t.dpi)
    if (!patched) {
      return { name: outName, bytes: item.bytes, origSize: item.bytes.length, skippedOnly: '该文件不支持写入分辨率元数据' }
    }
    return { name: outName, bytes: patched, origSize: item.bytes.length, w: t.w, h: t.h, dpiOnly: true }
  }

  // 重新采样：canvas 缩放编码
  const url = URL.createObjectURL(item.file)
  const img = new Image()
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject(new Error('DECODE_FAIL'))
    img.src = url
  })
  URL.revokeObjectURL(url)

  let w = t.w || img.width
  let h = t.h || img.height
  if (Math.max(w, h) > 8192) throw new Error('TOO_BIG')

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (settings.format === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
  }
  ctx.drawImage(img, 0, 0, w, h)
  drawWatermark(ctx, w, h, settings.watermark)

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('ENCODE_FAIL'))),
      settings.format,
      settings.format === 'image/png' ? undefined : settings.quality / 100,
    )
  })
  let bytes = new Uint8Array(await blob.arrayBuffer())
  // 物理尺寸模式：把分辨率写进文件元数据（像素 / 物理 = 设定值）
  if (t.dpi) {
    const patched =
      settings.format === 'image/jpeg' ? jpegSetDpi(bytes, t.dpi) : settings.format === 'image/png' ? pngSetDpi(bytes, t.dpi) : null
    if (patched) bytes = patched
  }
  return { name: outName, bytes, origSize: item.bytes.length, w, h }
}

async function run() {
  if (!files.value.length || processing.value) return
  processing.value = true
  error.value = ''
  results.value = []
  savedPath.value = ''
  progress.value = 0
  const out = []
  try {
    await Promise.all(
      files.value.map(async (x) => {
        if (!x.bytes.length) {
          try {
            x.bytes = new Uint8Array(await x.file.arrayBuffer())
          } catch {
            x.bytes = new Uint8Array(0)
          }
        }
      }),
    )
    for (let i = 0; i < files.value.length; i++) {
      const item = files.value[i]
      try {
        out.push(await processOne(item))
      } catch (e) {
        const msg = String(e.message || e)
        if (msg === 'DECODE_FAIL' && /\.(heic|heif)$/i.test(item.name)) {
          out.push({ name: item.name, bytes: item.bytes, origSize: item.bytes.length, skippedOnly: '此系统不支持 HEIC 解码，请先转为 JPG' })
        } else if (msg === 'TOO_BIG') {
          out.push({ name: item.name, bytes: item.bytes, origSize: item.bytes.length, skippedOnly: '图片过大（超 8192px），已跳过' })
        } else if (msg === 'DECODE_FAIL') {
          out.push({ name: item.name, bytes: item.bytes, origSize: item.bytes.length, skippedOnly: '无法解码该图片' })
        } else {
          throw e
        }
      }
      progress.value = Math.round(((i + 1) / files.value.length) * 100)
      results.value = [...out]
    }
    view.value = 'result'
  } finally {
    processing.value = false
  }
}

async function saveZip() {
  const ok = results.value.filter((r) => !r.skippedOnly)
  if (!ok.length) return
  const map = {}
  for (const r of ok) {
    let name = r.name
    let i = 2
    while (map[name]) name = r.name.replace(/\.(\w+)$/, `_${i}.$1`)
    map[name] = r.bytes
  }
  const zip = zipSync(map, { level: 6 })
  const path = await toolbox.pickSaveFile({
    defaultName: `图片_${formatNames[settings.format]}.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
    bytes: zip,
  })
  if (path) savedPath.value = `${path}（${ok.length} 张）`
}

async function saveOne(r) {
  const path = await toolbox.pickSaveFile({
    defaultName: r.name,
    filters: [{ name: formatNames[settings.format], extensions: [extOf[settings.format]] }],
    bytes: r.bytes,
  })
  if (path) savedPath.value = path
}
</script>

<template>
  <div class="page">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <button type="button" class="btn" @click="fileInput?.click()">
        <input ref="fileInput" type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif" multiple class="hidden" @change="onInputChange" />
        ＋ 添加图片
      </button>
      <template v-if="view === 'preview' && files.length">
        <div class="seg">
          <button
            v-for="f in ['image/jpeg', 'image/png', 'image/webp']"
            :key="f"
            type="button"
            class="segbtn"
            :class="{ 'segbtn--on': settings.format === f }"
            @click="settings.format = f"
          >
            {{ formatNames[f] }}
          </button>
        </div>
        <div v-if="settings.format !== 'image/png'" class="quality">
          质量 {{ settings.quality }}%
          <input v-model.number="settings.quality" type="range" min="30" max="100" step="5" class="qslider" />
        </div>
        <button type="button" class="toolbtn" @click="openResize">
          📐 调整大小<span class="toolbtn__sub">{{ resizeSummary }}</span>
        </button>
        <button type="button" class="toolbtn" :class="{ 'toolbtn--on': settings.watermark.enabled }" @click="openWm">
          💧 水印<span class="toolbtn__sub">{{ settings.watermark.enabled ? '开' : '关' }}</span>
        </button>
        <span class="spacer" />
        <button type="button" class="btn btn--primary" :disabled="processing" @click="run">
          <span v-if="processing" class="spinner" />
          {{ processing ? `处理中 ${progress}%` : `处理 ${files.length} 张` }}
        </button>
      </template>
      <template v-if="view === 'result'">
        <button type="button" class="toolbtn" @click="view = 'preview'">← 返回预览</button>
        <span class="spacer" />
        <button type="button" class="btn btn--primary" @click="saveZip">
          打包 zip（{{ results.filter((r) => !r.skippedOnly).length }}）
        </button>
      </template>
    </div>
    <p v-if="error" class="error error--bar">{{ error }}</p>
    <p v-if="savedPath" class="saved saved--bar">已保存到 {{ savedPath }}</p>

    <!-- 预览视图 -->
    <div v-if="view === 'preview'" class="previewwrap">
      <template v-if="files.length">
        <div
          class="previewarea"
          :class="{ 'previewarea--drag': dragging }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="((dragging = false), addFiles($event.dataTransfer?.files))"
        >
          <img v-if="current" :src="current.url" class="previewimg" alt="" />
          <div v-if="current" class="previewmeta">
            {{ currentIdx + 1 }} / {{ files.length }} · {{ current.name }}
            <span v-if="current.w">· {{ current.w }} × {{ current.h }} px</span>
            <span>· {{ fmtSize(current.bytes?.length) }}</span>
          </div>
        </div>
        <div class="thumbsbar">
          <button
            v-for="(f, i) in files"
            :key="f.url"
            type="button"
            class="thumb"
            :class="{ 'thumb--on': i === currentIdx }"
            @click="currentIdx = i"
          >
            <img :src="f.url" alt="" />
          </button>
        </div>
      </template>
      <div
        v-else
        class="empty"
        :class="{ 'empty--drag': dragging }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="((dragging = false), addFiles($event.dataTransfer?.files))"
      >
        <p class="empty__icon">🖼️</p>
        <p class="empty__title">拖入图片开始，或点击上方「＋ 添加图片」</p>
        <p class="empty__hint">支持 JPG / PNG / WebP / HEIC · 可多选 · 全部本地处理</p>
      </div>
    </div>

    <!-- 结果视图 -->
    <div v-else class="resultwrap">
      <p class="result__title">
        已处理 {{ results.filter((r) => !r.skippedOnly).length }} 张
        <span v-if="ratio > 0" class="result__ratio">体积减少 {{ ratio }}%（{{ fmtSize(totalOrig) }} → {{ fmtSize(totalNew) }}）</span>
      </p>
      <ul class="result__list">
        <li v-for="(r, i) in results" :key="r.name + i" class="result__item">
          <span class="result__name">{{ r.name }}</span>
          <span class="result__size" :class="{ good: !r.skippedOnly && r.bytes.length < r.origSize }">
            {{
              r.skippedOnly
                ? r.skippedOnly
                : r.dpiOnly
                  ? `${r.w}×${r.h} px · ${fmtSize(r.bytes.length)}（仅更新 DPI）`
                  : `${r.w ? r.w + '×' + r.h + ' · ' : ''}${fmtSize(r.origSize)} → ${fmtSize(r.bytes.length)}（${r.bytes.length < r.origSize ? '-' + Math.round((1 - r.bytes.length / r.origSize) * 100) + '%' : '已是最优'}）`
            }}
          </span>
          <button v-if="!r.skippedOnly" type="button" class="link" @click="saveOne(r)">另存</button>
        </li>
      </ul>
      <p v-if="savedPath" class="muted">已保存到 {{ savedPath }}</p>
    </div>

    <!-- 调整大小弹框 -->
    <div v-if="resizeOpen" class="mask" @click.self="cancelResize">
      <div class="modal">
        <p class="modal__title">图像尺寸</p>
        <div class="mrow">
          <span class="mlabel">宽度</span>
          <input v-model.number="resizeDraft.w" type="number" min="1" class="input mnum" @input="onDraftW" />
          <button
            type="button"
            class="lockbtn"
            :class="{ 'lockbtn--on': resizeDraft.lock }"
            :title="resizeDraft.lock ? '已锁定比例：改宽自动算高' : '未锁定比例'"
            @click="resizeDraft.lock = !resizeDraft.lock"
          >
            {{ resizeDraft.lock ? '🔒' : '🔓' }}
          </button>
          <span class="mlabel">高度</span>
          <input v-model.number="resizeDraft.h" type="number" min="1" class="input mnum" :disabled="resizeDraft.lock" />
          <select v-model="resizeDraft.unit" class="input mselect">
            <option v-for="u in ['px', 'mm', 'cm', 'in']" :key="u" :value="u">{{ unitNames[u] }}</option>
          </select>
        </div>
        <div class="mrow">
          <span class="mlabel">分辨率</span>
          <input v-model.number="resizeDraft.resValue" type="number" min="1" step="0.01" class="input mnum" :disabled="resizeDraft.unit === 'px'" />
          <select v-model="resizeDraft.resUnit" class="input mselect" :disabled="resizeDraft.unit === 'px'">
            <option value="in">像素/英寸</option>
            <option value="cm">像素/厘米</option>
          </select>
        </div>
        <label class="mcheck">
          <input v-model="resizeDraft.resample" type="checkbox" :disabled="resizeDraft.unit === 'px'" />
          重新采样图像（不勾选：像素不变，仅更新分辨率元数据）
        </label>
        <p v-if="resizeDraft.unit !== 'px' && !resizeDraft.resample && settings.format === 'image/webp'" class="error">
          WebP 不支持分辨率元数据：「仅改 DPI」请把输出格式切换为 JPEG 或 PNG
        </p>
        <div class="mresult">
          <p class="mresult__pct" v-if="draftPreview">{{ draftPreview.pct }}%</p>
          <p class="mresult__size" v-if="draftPreview">
            {{ draftPreview.t.w }} × {{ draftPreview.t.h }} 像素（原图 {{ draftPreview.srcW }} × {{ draftPreview.srcH }}）
          </p>
        </div>
        <div class="modal__actions">
          <button type="button" class="btn" @click="cancelResize">取消</button>
          <button type="button" class="btn btn--primary" @click="applyResize">好</button>
        </div>
      </div>
    </div>

    <!-- 水印弹框 -->
    <div v-if="wmOpen" class="mask" @click.self="wmOpen = false">
      <div class="modal">
        <p class="modal__title">文字水印</p>
        <label class="mcheck"><input v-model="wmDraft.enabled" type="checkbox" /> 启用水印</label>
        <template v-if="wmDraft.enabled">
          <div class="mrow">
            <span class="mlabel">内容</span>
            <input v-model="wmDraft.text" class="input grow" placeholder="水印文字" />
          </div>
          <div class="mrow">
            <span class="mlabel">位置</span>
            <div class="seg seg--wrap">
              <button v-for="p in ['tl', 'tc', 'tr', 'cl', 'c', 'cr', 'bl', 'bc', 'br', 'tile']" :key="p" type="button" class="segbtn" :class="{ 'segbtn--on': wmDraft.pos === p }" @click="wmDraft.pos = p">
                {{ { tl: '左上', tc: '上', tr: '右上', cl: '左', c: '中', cr: '右', bl: '左下', bc: '下', br: '右下', tile: '平铺' }[p] }}
              </button>
            </div>
          </div>
          <div class="mrow">
            <span class="mlabel">大小 {{ wmDraft.size }}‰</span>
            <input v-model.number="wmDraft.size" type="range" min="14" max="80" class="grow" />
          </div>
          <div class="mrow">
            <span class="mlabel">透明度 {{ wmDraft.opacity }}%</span>
            <input v-model.number="wmDraft.opacity" type="range" min="10" max="90" class="grow" />
          </div>
        </template>
        <div class="modal__actions">
          <button type="button" class="btn" @click="wmOpen = false">取消</button>
          <button type="button" class="btn btn--primary" @click="applyWm">好</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; background: var(--c-bg); }

.toolbar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 14px; background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
}
.quality { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--c-text-muted); white-space: nowrap; }
.qslider { width: 110px; }
.toolbtn {
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  border: 1px solid var(--c-border); background: var(--c-bg); border-radius: 8px;
  padding: 5px 12px; font-size: 13px; cursor: pointer; color: var(--c-text);
}
.toolbtn--on { border-color: var(--c-primary); color: var(--c-primary); }
.toolbtn__sub { font-size: 11px; color: var(--c-text-muted); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spacer { flex: 1; }
.hidden { display: none; }

.error--bar, .saved--bar { margin: 0; padding: 6px 14px; font-size: 12.5px; }
.error--bar { color: var(--c-danger); background: rgba(220, 38, 38, 0.06); }
.saved--bar { color: var(--c-text-muted); }

.previewwrap { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.previewarea { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; padding: 16px; min-height: 0; }
.previewarea--drag { outline: 2px dashed var(--c-primary); outline-offset: -8px; }
.previewimg { max-width: 100%; max-height: calc(100% - 34px); object-fit: contain; border-radius: 6px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1); background: #fff; }
.previewmeta { margin-top: 10px; font-size: 12.5px; color: var(--c-text-muted); text-align: center; }

.thumbsbar { display: flex; gap: 8px; padding: 10px 14px; overflow-x: auto; border-top: 1px solid var(--c-border); background: var(--c-surface); }
.thumb { flex: 0 0 auto; width: 76px; height: 58px; border-radius: 6px; overflow: hidden; border: 2px solid transparent; padding: 0; cursor: pointer; background: none; }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb--on { border-color: var(--c-primary); }

.empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  margin: 16px; border: 2px dashed var(--c-border); border-radius: 16px; background: var(--c-surface);
  cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.empty:hover, .empty--drag { border-color: var(--c-primary); background: rgba(59, 130, 246, 0.05); }
.empty__icon { margin: 0; font-size: 48px; line-height: 1; }
.empty__title { margin: 0; font-size: 16px; font-weight: 600; }
.empty__hint { margin: 0; font-size: 12.5px; color: var(--c-text-muted); }

.resultwrap { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; }
.result__title { margin: 0; font-size: 15px; font-weight: 700; }
.result__ratio { font-size: 13px; color: var(--c-primary); margin-left: 8px; }
.result__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.result__item { display: flex; align-items: center; gap: 10px; font-size: 12.5px; padding: 7px 10px; border-radius: 8px; background: var(--c-surface); border: 1px solid var(--c-border); }
.result__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result__size { color: var(--c-text-muted); }
.result__size.good { color: #16a34a; }
.link { border: none; background: none; color: var(--c-primary); cursor: pointer; font-size: 12.5px; padding: 2px 4px; }
.muted { margin: 0; font-size: 12.5px; color: var(--c-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.error { margin: 0; color: var(--c-danger); font-size: 13px; }

.seg { display: flex; gap: 4px; background: var(--c-bg); border-radius: 8px; padding: 3px; }
.seg--wrap { flex-wrap: wrap; }
.segbtn { border: none; background: transparent; padding: 5px 11px; font-size: 12.5px; border-radius: 6px; cursor: pointer; color: var(--c-text-muted); }
.segbtn--on { background: var(--c-primary); color: #fff; }

/* 弹框 */
.mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal {
  width: 560px; max-width: calc(100vw - 48px); max-height: calc(100vh - 64px); overflow-y: auto;
  background: var(--c-surface); border-radius: 14px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  padding: 18px 20px; display: flex; flex-direction: column; gap: 13px;
}
.modal__title { margin: 0 0 2px; font-size: 16px; font-weight: 700; }
.mrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mlabel { font-size: 13px; font-weight: 600; min-width: 44px; }
.munit { font-size: 12.5px; color: var(--c-text-muted); }
.mnum { width: 96px; }
.mselect { min-width: 170px; }
.mcheck { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--c-text); }
.mhint { margin: 0; font-size: 12.5px; line-height: 1.6; color: var(--c-text-muted); background: var(--c-bg); border-radius: 8px; padding: 8px 10px; }
.lockbtn { border: 1px solid var(--c-border); background: var(--c-bg); border-radius: 6px; width: 34px; height: 32px; cursor: pointer; font-size: 14px; }
.lockbtn--on { border-color: var(--c-primary); background: rgba(59, 130, 246, 0.08); }
.grow { flex: 1; }
.input { padding: 8px 10px; border: 1px solid var(--c-border); border-radius: 8px; font-size: 13px; background: var(--c-bg); color: var(--c-text); font-family: inherit; }
.input:focus { outline: 2px solid var(--c-primary); outline-offset: -1px; }
.input:disabled { opacity: 0.55; }
.modal__actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
.mresult { background: var(--c-bg); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.mresult__pct { margin: 0; font-size: 16px; font-weight: 700; }
.mresult__size { margin: 0; font-size: 12.5px; color: var(--c-text-muted); }
</style>
