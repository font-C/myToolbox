<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { toolbox, useNativeFileDrop } from '@toolbox/plugin-sdk'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'

const frames = ref([]) // [{ file, name, bytes, w, h, url }]
const delayMs = ref(400)
const outWidth = ref(360) // 0 = 首帧原尺寸（上限 640）
const loopCount = ref(0) // 0 = 无限循环
const processing = ref(false)
const result = ref(null) // { bytes, url, w, h }
const error = ref('')
const notice = ref('')
const dragging = ref(false)
const fileInput = ref(null)

const MAX_DIM = 640

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
  frames.value.forEach((f) => f.url && URL.revokeObjectURL(f.url))
  if (result.value) URL.revokeObjectURL(result.value.url)
})

function addFiles(list) {
  const imgs = Array.from(list || []).filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f.name))
  if (!imgs.length) {
    error.value = '请选择图片文件（JPG / PNG / WebP / GIF）'
    return
  }
  error.value = ''
  if (result.value) {
    URL.revokeObjectURL(result.value.url)
    result.value = null
  }
  for (const f of imgs) {
    frames.value.push({
      file: f,
      name: f.name,
      url: URL.createObjectURL(f),
      w: 0,
      h: 0,
    })
  }
}

function removeAt(i) {
  const f = frames.value[i]
  if (f?.url) URL.revokeObjectURL(f.url)
  frames.value.splice(i, 1)
}

function move(i, dir) {
  const j = i + dir
  if (j < 0 || j >= frames.value.length) return
  const arr = frames.value
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

function clearAll() {
  frames.value.forEach((f) => f.url && URL.revokeObjectURL(f.url))
  frames.value = []
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

async function generate() {
  if (frames.value.length < 1 || processing.value) return
  processing.value = true
  error.value = ''
  if (result.value) URL.revokeObjectURL(result.value.url)
  result.value = null
  try {
    // 统一帧尺寸：以第一帧宽高比 + 输出宽度为准
    const first = await loadImage(frames.value[0].url)
    const ratio = first.height / first.width
    const W = Math.min(MAX_DIM, outWidth.value > 0 ? outWidth.value : Math.min(first.width, MAX_DIM))
    const H = Math.max(1, Math.round(W * ratio))
    const delay = Math.max(20, Number(delayMs.value) || 400)

    const gif = GIFEncoder()
    for (let i = 0; i < frames.value.length; i++) {
      notice.value = `编码第 ${i + 1} / ${frames.value.length} 帧…`
      const img = await loadImage(frames.value[i].url)
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
      // contain 绘制（比例不同的帧不变形）
      const s = Math.min(W / img.width, H / img.height)
      const dw = img.width * s
      const dh = img.height * s
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)
      const data = ctx.getImageData(0, 0, W, H).data
      const palette = quantize(data, 256)
      const index = applyPalette(data, palette)
      gif.writeFrame(index, W, H, { palette, delay, repeat: loopCount.value })
    }
    gif.finish()
    const bytes = gif.bytes()
    const blob = new Blob([bytes], { type: 'image/gif' })
    result.value = { bytes, url: URL.createObjectURL(blob), w: W, h: H }
    notice.value = ''
  } catch (e) {
    error.value = `生成失败：${e.message || e}`
  } finally {
    processing.value = false
    notice.value = ''
  }
}

async function save() {
  if (!result.value) return
  const path = await toolbox.pickSaveFile({
    defaultName: '表情包.gif',
    filters: [{ name: 'GIF', extensions: ['gif'] }],
    bytes: result.value.bytes,
  })
  if (path) notice.value = `已保存到 ${path}`
}

const totalSeconds = computed(() =>
  frames.value.length ? ((Number(delayMs.value) || 400) * frames.value.length) / 1000 : 0,
)

function fmt(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>GIF 表情包</h1>
      <p class="header__sub">多张图片合成动图 · 纯本地编码，不上传</p>
    </header>

    <main class="body">
      <template v-if="!frames.length && !result">
        <div
          class="empty"
          :class="{ 'empty--drag': dragging }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="((dragging = false), addFiles($event.dataTransfer?.files))"
          @click="fileInput?.click()"
        >
          <input ref="fileInput" type="file" accept=".jpg,.jpeg,.png,.webp,.gif" multiple class="hidden" @change="addFiles($event.target.files); fileInput.value = ''" />
          <p class="empty__icon">🎞️</p>
          <p class="empty__title">拖入 2 张以上图片作为帧</p>
          <p class="empty__hint">按导入顺序播放 · 支持 JPG / PNG / WebP / GIF（取首帧）</p>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
      </template>

      <template v-else>
        <!-- 帧列表 -->
        <section v-if="frames.length" class="frameswrap">
          <p class="sectitle">帧（{{ frames.length }} 帧 · 循环约 {{ totalSeconds.toFixed(1) }} 秒）——点击选择，箭头调顺序</p>
          <div class="framelist">
            <div v-for="(f, i) in frames" :key="f.url" class="frame" :class="{ 'frame--first': i === 0 }">
              <img :src="f.url" class="frame__img" alt="" />
              <span class="frame__num">{{ i + 1 }}</span>
              <div class="frame__ops">
                <button type="button" class="op" title="上移" :disabled="i === 0" @click="move(i, -1)">↑</button>
                <button type="button" class="op" title="下移" :disabled="i === frames.length - 1" @click="move(i, 1)">↓</button>
                <button type="button" class="op op--danger" title="删除" @click="removeAt(i)">×</button>
              </div>
            </div>
            <button type="button" class="frame frame--add" @click="fileInput?.click()">
              <input ref="fileInput" type="file" accept=".jpg,.jpeg,.png,.webp,.gif" multiple class="hidden" @change="addFiles($event.target.files); fileInput.value = ''" />
              ＋<span>加帧</span>
            </button>
          </div>
        </section>

        <!-- 设置 -->
        <section class="settings">
          <div class="row">
            <span class="row__label">每帧停留</span>
            <input v-model.number="delayMs" type="number" min="20" max="3000" step="20" class="input input--num" />
            <span class="unit">毫秒</span>
            <span class="muted">（500 ≈ 每秒 2 帧）</span>
          </div>
          <div class="row">
            <span class="row__label">宽度</span>
            <input v-model.number="outWidth" type="number" min="80" max="640" step="40" class="input input--num" />
            <span class="unit">像素</span>
            <span class="muted">高度按首帧比例自动计算，上限 640</span>
          </div>
          <div class="row">
            <span class="row__label">循环</span>
            <select v-model.number="loopCount" class="input input--num">
              <option :value="0">无限循环</option>
              <option :value="1">播放 1 次</option>
              <option :value="3">播放 3 次</option>
            </select>
          </div>
          <p v-if="error" class="error">{{ error }}</p>
          <p v-else-if="notice" class="notice">{{ notice }}</p>
          <button type="button" class="btn btn--primary run" :disabled="processing || frames.length < 1" @click="generate">
            <span v-if="processing" class="spinner" />
            {{ processing ? '生成中…' : '生成 GIF' }}
          </button>
        </section>

        <!-- 结果 -->
        <section v-if="result" class="result">
          <img :src="result.url" class="result__gif" alt="" />
          <p class="result__meta">
            {{ result.w }} × {{ result.h }} px · {{ fmt(result.bytes.length) }}
          </p>
          <div class="result__actions">
            <button type="button" class="btn btn--primary" @click="save">保存 GIF</button>
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
.header { text-align: center; padding: 16px 16px 6px; }
.header h1 { margin: 0 0 5px; font-size: 21px; }
.header__sub { margin: 0; font-size: 13px; color: var(--c-text-muted); }
.body { flex: 1; width: 100%; max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; padding: 6px 22px 24px; }

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
.frame { position: relative; flex: 0 0 auto; width: 108px; }
.frame--first::after { content: '首帧'; position: absolute; top: 4px; right: 4px; font-size: 10px; background: var(--c-primary); color: #fff; border-radius: 4px; padding: 1px 5px; }
.frame__img { width: 108px; height: 82px; object-fit: cover; border: 1px solid var(--c-border); border-radius: 8px; display: block; background: #fff; }
.frame__num { position: absolute; top: 4px; left: 4px; min-width: 18px; height: 18px; padding: 0 4px; background: rgba(15, 23, 42, 0.75); color: #fff; font-size: 11px; border-radius: 9px; display: flex; align-items: center; justify-content: center; }
.frame__ops { display: flex; gap: 4px; justify-content: center; margin-top: 4px; }
.op { border: 1px solid var(--c-border); background: var(--c-bg); border-radius: 6px; width: 26px; height: 24px; cursor: pointer; font-size: 12px; color: var(--c-text); }
.op:disabled { opacity: 0.4; }
.op--danger { color: var(--c-danger); }
.frame--add {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 108px; border: 2px dashed var(--c-border); border-radius: 8px; cursor: pointer;
  font-size: 16px; color: var(--c-text-muted); background: var(--c-bg); gap: 2px;
}
.frame--add:hover { border-color: var(--c-primary); color: var(--c-primary); }
.frame--add span { font-size: 11px; }

.settings { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.row__label { font-size: 13px; font-weight: 600; min-width: 68px; }
.unit, .muted { font-size: 12px; color: var(--c-text-muted); }
.input { padding: 8px 10px; border: 1px solid var(--c-border); border-radius: 8px; font-size: 13px; background: var(--c-bg); color: var(--c-text); font-family: inherit; }
.input:focus { outline: 2px solid var(--c-primary); outline-offset: -1px; }
.input--num { width: 90px; text-align: center; }
.run { align-self: stretch; justify-content: center; padding: 12px; }

.result { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px; align-items: center; }
.result__gif { max-width: 100%; border: 1px solid var(--c-border); border-radius: 8px; background: #fff; }
.result__meta { margin: 0; font-size: 12.5px; color: var(--c-text-muted); }
.result__actions { display: flex; gap: 12px; }
.notice { margin: 0; font-size: 12.5px; color: #16a34a; }
.error { margin: 0; color: var(--c-danger); font-size: 13px; }
</style>
