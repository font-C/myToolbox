<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { toolbox, useNativeFileDrop } from '@toolbox/plugin-sdk'

const items = ref([]) // [{ file, name, bytes, w, h, url }]
const widthMode = ref('widest') // widest | custom
const customWidth = ref(800)
const gap = ref(12)
const margin = ref(16)
const bgColor = ref('#ffffff')
const outFormat = ref('image/png') // image/png | image/jpeg
const quality = ref(90)
const processing = ref(false)
const result = ref(null) // { bytes, url, w, h }
const error = ref('')
const notice = ref('')
const dragging = ref(false)
const fileInput = ref(null)

const MAX_DIM = 8192

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
  items.value.forEach((f) => f.url && URL.revokeObjectURL(f.url))
  if (result.value) URL.revokeObjectURL(result.value.url)
})

function fmt(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function addFiles(list) {
  const imgs = Array.from(list || []).filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name))
  if (!imgs.length) {
    error.value = '请选择图片文件（JPG / PNG / WebP）'
    return
  }
  error.value = ''
  if (result.value) {
    URL.revokeObjectURL(result.value.url)
    result.value = null
  }
  for (const f of imgs) {
    const item = { file: f, name: f.name, bytes: new Uint8Array(), w: 0, h: 0, url: URL.createObjectURL(f) }
    items.value.push(item)
    // 异步读尺寸
    const img = new Image()
    img.onload = () => {
      item.w = img.naturalWidth
      item.h = img.naturalHeight
    }
    img.onerror = () => {
      item.error = '无法解码'
    }
    img.src = item.url
  }
}

function removeAt(i) {
  const f = items.value[i]
  if (f?.url) URL.revokeObjectURL(f.url)
  items.value.splice(i, 1)
}

function move(i, dir) {
  const j = i + dir
  if (j < 0 || j >= items.value.length) return
  const arr = items.value
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

function clearAll() {
  items.value.forEach((f) => f.url && URL.revokeObjectURL(f.url))
  items.value = []
  if (result.value) URL.revokeObjectURL(result.value.url)
  result.value = null
  error.value = ''
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('DECODE_FAIL'))
    img.src = url
  })
}

const totalHeight = computed(() => {
  if (!items.value.length) return 0
  const W = targetWidth.value
  let h = margin.value * 2
  items.value.forEach((it, i) => {
    const iw = it.w || W
    const ih = it.h || W
    const s = W / iw
    h += Math.round(ih * s)
    if (i < items.value.length - 1) h += gap.value
  })
  return h
})

const targetWidth = computed(() => {
  if (widthMode.value === 'custom') return Math.max(64, Number(customWidth.value) || 800)
  const ws = items.value.map((x) => x.w).filter(Boolean)
  return ws.length ? Math.max(...ws) : 800
})

async function generate() {
  if (!items.value.length || processing.value) return
  processing.value = true
  error.value = ''
  if (result.value) URL.revokeObjectURL(result.value.url)
  result.value = null

  try {
    // 读全部图像
    const imgs = []
    for (const it of items.value) {
      imgs.push({ it, img: await loadImage(it.url) })
    }
    // 目标宽度：最宽原图 或 自定义
    let W = widthMode.value === 'custom' ? Math.max(64, Number(customWidth.value) || 800) : Math.max(...imgs.map((x) => x.img.width))
    // 原始整条高度
    const rawH =
      margin.value * 2 + imgs.reduce((s, x, i) => {
        const dw = W
        const dh = Math.round((x.img.height / x.img.width) * dw)
        return s + dh + (i < imgs.length - 1 ? gap.value : 0)
      }, 0)
    // 超 8192：整体等比缩小（宽度跟着变小）
    let scale = 1
    if (rawH > MAX_DIM) {
      scale = MAX_DIM / rawH
      W = Math.max(64, Math.round(W * scale))
    }
    const H = Math.round(rawH * scale)

    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = bgColor.value
    ctx.fillRect(0, 0, W, H)

    let y = Math.round(margin.value * scale)
    const g = Math.round(gap.value * scale)
    const m = Math.round(margin.value * scale)
    y = m
    for (let i = 0; i < imgs.length; i++) {
      const { img } = imgs[i]
      const dw = W
      const dh = Math.round((img.height / img.width) * W)
      ctx.drawImage(img, m, y, dw, dh)
      y += dh
      if (i < imgs.length - 1) y += g
    }

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('ENCODE_FAIL'))),
        outFormat.value,
        outFormat.value === 'image/jpeg' ? quality.value / 100 : undefined,
      )
    })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    result.value = { bytes, url: URL.createObjectURL(blob), w: W, h: H }
  } catch (e) {
    error.value = `拼接失败：${e.message || e}`
  } finally {
    processing.value = false
  }
}

async function save() {
  if (!result.value) return
  const ext = outFormat.value === 'image/png' ? 'png' : 'jpg'
  const path = await toolbox.pickSaveFile({
    defaultName: `拼长图.${ext}`,
    filters: [{ name: outFormat.value === 'image/png' ? 'PNG' : 'JPEG', extensions: [ext] }],
    bytes: result.value.bytes,
  })
  if (path) notice.value = `已保存到 ${path}`
}
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>拼长图</h1>
      <p class="header__sub">多张图片按顺序纵向拼接 · 聊天记录 / 截图合并 · 全离线</p>
    </header>

    <main class="body">
      <template v-if="!items.length && !result">
        <div
          class="empty"
          :class="{ 'empty--drag': dragging }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="((dragging = false), addFiles($event.dataTransfer?.files))"
          @click="fileInput?.click()"
        >
          <input ref="fileInput" type="file" accept=".jpg,.jpeg,.png,.webp" multiple class="hidden" @change="addFiles($event.target.files); fileInput.value = ''" />
          <p class="empty__icon">🧱</p>
          <p class="empty__title">拖入 2 张以上图片，按顺序纵向拼接</p>
          <p class="empty__hint">适合聊天记录、多屏截图合并 · 支持 JPG / PNG / WebP</p>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
      </template>

      <template v-else>
        <!-- 图片顺序列表 -->
        <section class="frameswrap">
          <p class="sectitle">图片顺序（{{ items.length }} 张）——箭头调顺序</p>
          <div class="framelist">
            <div v-for="(f, i) in items" :key="f.url" class="frame">
              <img :src="f.url" class="frame__img" alt="" />
              <span class="frame__num">{{ i + 1 }}</span>
              <span class="frame__dim">{{ f.w || '?' }} × {{ f.h || '?' }}</span>
              <div class="frame__ops">
                <button type="button" class="op" title="上移" :disabled="i === 0" @click="move(i, -1)">↑</button>
                <button type="button" class="op" title="下移" :disabled="i === items.length - 1" @click="move(i, 1)">↓</button>
                <button type="button" class="op op--danger" title="删除" @click="removeAt(i)">×</button>
              </div>
            </div>
            <button type="button" class="frame frame--add" @click="fileInput?.click()">
              <input ref="fileInput" type="file" accept=".jpg,.jpeg,.png,.webp" multiple class="hidden" @change="addFiles($event.target.files); fileInput.value = ''" />
              ＋<span>加图</span>
            </button>
          </div>
        </section>

        <!-- 设置 -->
        <section v-if="!result" class="settings">
          <div class="row">
            <span class="row__label">宽度</span>
            <div class="seg">
              <button type="button" class="segbtn" :class="{ 'segbtn--on': widthMode === 'widest' }" @click="widthMode = 'widest'">按最宽图片</button>
              <button type="button" class="segbtn" :class="{ 'segbtn--on': widthMode === 'custom' }" @click="widthMode = 'custom'">自定义</button>
            </div>
            <input v-if="widthMode === 'custom'" v-model.number="customWidth" type="number" min="64" class="input input--num" />
            <span class="unit">px（窄图居中，宽图等比缩小）</span>
          </div>
          <div class="row">
            <span class="row__label">间距 {{ gap }}px</span>
            <input v-model.number="gap" type="range" min="0" max="48" class="grow" />
            <span class="row__label">边距 {{ margin }}px</span>
            <input v-model.number="margin" type="range" min="0" max="60" class="grow" />
            <label class="check">背景 <input v-model="bgColor" type="color" class="color" /></label>
          </div>
          <div class="row">
            <span class="row__label">输出格式</span>
            <div class="seg">
              <button type="button" class="segbtn" :class="{ 'segbtn--on': outFormat === 'image/png' }" @click="outFormat = 'image/png'">PNG（无损）</button>
              <button type="button" class="segbtn" :class="{ 'segbtn--on': outFormat === 'image/jpeg' }" @click="outFormat = 'image/jpeg'">JPEG（更小）</button>
            </div>
            <label v-if="outFormat === 'image/jpeg'" class="check">质量 {{ quality }}% <input v-model.number="quality" type="range" min="50" max="100" step="5" class="qslider" /></label>
          </div>
          <p v-if="totalHeight" class="muted">
            预计长图：{{ targetWidth }} × {{ Math.round(totalHeight) }} px
            <span v-if="totalHeight > 8192">（超出 8192px，生成时将整体等比缩小）</span>
          </p>
          <p v-if="error" class="error">{{ error }}</p>
          <button type="button" class="btn btn--primary run" :disabled="processing || items.length < 2" @click="generate">
            <span v-if="processing" class="spinner" />
            {{ processing ? '拼接中…' : '拼接长图' }}
          </button>
        </section>

        <!-- 结果 -->
        <section v-if="result" class="result">
          <img :src="result.url" class="result__img" alt="" />
          <p class="muted">{{ result.w }} × {{ result.h }} px · {{ fmt(result.bytes.length) }}</p>
          <div class="result__actions">
            <button type="button" class="btn btn--primary" @click="save">保存长图</button>
            <button type="button" class="btn" @click="((result = null), (notice = ''))">重新调整</button>
          </div>
          <p v-if="notice" class="muted">已保存到 {{ notice }}</p>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; overflow-y: auto; }
.header { text-align: center; padding: 18px 16px 6px; }
.header h1 { margin: 0 0 5px; font-size: 21px; }
.header__sub { margin: 0; font-size: 13px; color: var(--c-text-muted); }
.body { width: 100%; max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; padding: 6px 22px 24px; }

.empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  min-height: 220px; border: 2px dashed var(--c-border); border-radius: 14px;
  background: var(--c-surface); cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.empty:hover, .empty--drag { border-color: var(--c-primary); background: rgba(59, 130, 246, 0.05); }
.empty__icon { margin: 0; font-size: 46px; }
.empty__title { margin: 0; font-size: 15px; font-weight: 600; }
.empty__hint { margin: 0; font-size: 12.5px; color: var(--c-text-muted); }
.hidden { display: none; }

.frameswrap { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 12px; }
.sectitle { margin: 0 0 8px; font-size: 12px; font-weight: 700; color: var(--c-text-muted); }
.framelist { display: flex; gap: 10px; overflow-x: auto; }
.frame { position: relative; flex: 0 0 auto; width: 92px; }
.frame__img { width: 92px; height: 70px; object-fit: cover; border: 1px solid var(--c-border); border-radius: 8px; display: block; background: #fff; }
.frame__num { position: absolute; top: 4px; left: 4px; min-width: 18px; height: 18px; padding: 0 4px; background: var(--c-primary); color: #fff; font-size: 11px; border-radius: 9px; display: flex; align-items: center; justify-content: center; }
.frame__dim { display: block; margin-top: 3px; font-size: 10.5px; color: var(--c-text-muted); text-align: center; }
.frame__ops { display: flex; gap: 3px; justify-content: center; margin-top: 2px; }
.op { border: 1px solid var(--c-border); background: var(--c-bg); border-radius: 6px; width: 24px; height: 22px; cursor: pointer; font-size: 12px; color: var(--c-text); }
.op:disabled { opacity: 0.4; }
.op--danger { color: var(--c-danger); }
.frame--add {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 92px; border: 2px dashed var(--c-border); border-radius: 8px; cursor: pointer;
  font-size: 15px; color: var(--c-text-muted); background: var(--c-bg); width: 92px; gap: 2px;
}
.frame--add:hover { border-color: var(--c-primary); color: var(--c-primary); }
.frame--add span { font-size: 11px; }

.settings { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.row__label { font-size: 13px; font-weight: 600; min-width: 84px; }
.grow { flex: 1; }
.check { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
.color { width: 34px; height: 28px; border: 1px solid var(--c-border); border-radius: 6px; background: none; padding: 0; }
.qslider { width: 110px; }
.seg { display: flex; gap: 4px; background: var(--c-bg); border-radius: 8px; padding: 3px; }
.segbtn { border: none; background: transparent; padding: 5px 11px; font-size: 12.5px; border-radius: 6px; cursor: pointer; color: var(--c-text-muted); }
.segbtn--on { background: var(--c-primary); color: #fff; }
.input { padding: 8px 10px; border: 1px solid var(--c-border); border-radius: 8px; font-size: 13px; background: var(--c-bg); color: var(--c-text); font-family: inherit; }
.input:focus { outline: 2px solid var(--c-primary); outline-offset: -1px; }
.input--num { width: 84px; text-align: center; }
.unit { font-size: 12px; color: var(--c-text-muted); }
.run { align-self: stretch; justify-content: center; padding: 12px; }
.muted { margin: 0; font-size: 12.5px; color: var(--c-text-muted); }

.result { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; align-items: center; }
.result__img { max-width: 100%; max-height: 420px; object-fit: contain; border: 1px solid var(--c-border); border-radius: 8px; background: #fff; }
.result__actions { display: flex; gap: 12px; }
</style>
