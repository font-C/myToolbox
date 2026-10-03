<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { toolbox } from '@toolbox/plugin-sdk'
import { imgStore } from './images.js'
import { getLoaded } from './imgcache.js'
import { debounce, canvasToBytes } from './useLoadedImages.js'

const ASPECTS = [
  { id: '1:1', label: '1:1', v: 1 },
  { id: '4:3', label: '4:3', v: 4 / 3 },
  { id: '3:4', label: '3:4', v: 3 / 4 },
  { id: '16:9', label: '16:9', v: 16 / 9 },
  { id: '9:16', label: '9:16', v: 9 / 16 },
]

let seq = 0
const layers = ref([]) // { id, url, ix, nx, ny, nw, aspect, rot }
const selId = ref(null)
const aspectId = ref('1:1')
const zoom = ref(1)
const bgColor = ref('#ffffff')
const transparent = ref(false)
const outFormat = ref('image/png')
const quality = ref(90)
const outLong = ref(2048)

const saving = ref(false)
const error = ref('')
const notice = ref('')
const viewport = ref(null)
const box = ref(null)

const A = computed(() => ASPECTS.find((a) => a.id === aspectId.value).v)
const sel = computed(() => layers.value.find((l) => l.id === selId.value) || null)

/* ---------- 加入画布 ---------- */

function placeDefaults(item) {
  const aspect = item.w && item.h ? item.w / item.h : 1
  const nw = Math.min(0.6, (0.6 * aspect) / A.value)
  const i = layers.value.length
  return {
    id: ++seq,
    url: item.url,
    ix: imgStore.items.indexOf(item),
    nx: Math.min(0.86, Math.max(0.14, 0.5 + (i % 5) * 0.05 - 0.1)),
    ny: Math.min(0.86, Math.max(0.14, 0.5 + (i % 7) * 0.06 - 0.18)),
    nw,
    aspect,
    rot: 0,
  }
}

function placeOne(ix) {
  const item = imgStore.items[ix]
  if (!item || !item.w) return
  layers.value.push(placeDefaults(item))
  selId.value = layers.value[layers.value.length - 1].id
}

function addAll() {
  for (const item of imgStore.items) {
    if (!item.w || layers.value.some((l) => l.url === item.url)) continue
    layers.value.push(placeDefaults(item))
  }
  if (layers.value.length) selId.value = layers.value[layers.value.length - 1].id
}

// 图片从库中移除时,同步清理画布上的图层
watch(
  () => imgStore.items.map((i) => i.url).join('|'),
  () => {
    const urls = new Set(imgStore.items.map((i) => i.url))
    layers.value = layers.value.filter((l) => urls.has(l.url))
    if (sel.value && !urls.has(sel.value.url)) selId.value = null
  },
)

/* ---------- 图层操作 ---------- */

function bringToFront(id) {
  const i = layers.value.findIndex((l) => l.id === id)
  if (i < 0) return
  const [l] = layers.value.splice(i, 1)
  layers.value.push(l)
}
function forward(id) {
  const i = layers.value.findIndex((l) => l.id === id)
  if (i < 0 || i === layers.value.length - 1) return
  const arr = layers.value
  ;[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
}
function backward(id) {
  const i = layers.value.findIndex((l) => l.id === id)
  if (i <= 0) return
  const arr = layers.value
  ;[arr[i], arr[i - 1]] = [arr[i - 1], arr[i]]
}
function duplicate(id) {
  const l = layers.value.find((x) => x.id === id)
  if (!l) return
  const copy = { ...l, id: ++seq, nx: Math.min(0.95, l.nx + 0.06), ny: Math.min(0.95, l.ny + 0.06) }
  layers.value.push(copy)
  selId.value = copy.id
}
function removeLayer(id) {
  layers.value = layers.value.filter((l) => l.id !== id)
  if (selId.value === id) selId.value = null
}

function onKeydown(e) {
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  if ((e.key === 'Delete' || e.key === 'Backspace') && selId.value) {
    e.preventDefault()
    removeLayer(selId.value)
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

/* ---------- 画布缩放 ---------- */

function fitZoom() {
  const vp = viewport.value
  if (!vp) return
  const vw = vp.clientWidth - 28
  const vh = vp.clientHeight - 28
  if (vw <= 0 || vh <= 0) return
  // box 宽 = zoom × vw,须满足 boxW ≤ vw 且 boxH = boxW/A ≤ vh
  zoom.value = Math.max(0.15, Math.min(1, (vh * A.value) / vw))
}
function zoomIn() {
  zoom.value = Math.min(2.5, zoom.value + 0.2)
}
function zoomOut() {
  zoom.value = Math.max(0.2, zoom.value - 0.2)
}
watch(aspectId, () => nextTick(fitZoom))
onMounted(() => nextTick(fitZoom))

/* ---------- 拖拽 / 缩放 / 旋转 ---------- */

let drag = null // { mode, id, startX, startY, rect, startNx, startNy, startNw, startAng, startRot }

function boxRect() {
  return box.value?.getBoundingClientRect()
}

function onLayerDown(e, l) {
  if (e.button !== 0) return
  selId.value = l.id
  const rect = boxRect()
  drag = { mode: 'move', id: l.id, startX: e.clientX, startY: e.clientY, rect, startNx: l.nx, startNy: l.ny }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
function onScaleDown(e, l) {
  e.stopPropagation()
  selId.value = l.id
  const rect = boxRect()
  const cx = rect.left + l.nx * rect.width
  const cy = rect.top + l.ny * rect.height
  drag = {
    mode: 'scale',
    id: l.id,
    rect,
    cx,
    cy,
    startDist: Math.max(4, Math.hypot(e.clientX - cx, e.clientY - cy)),
    startNw: l.nw,
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
function onRotateDown(e, l) {
  e.stopPropagation()
  selId.value = l.id
  const rect = boxRect()
  const cx = rect.left + l.nx * rect.width
  const cy = rect.top + l.ny * rect.height
  drag = {
    mode: 'rotate',
    id: l.id,
    cx,
    cy,
    startAng: Math.atan2(e.clientY - cy, e.clientX - cx),
    startRot: l.rot,
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
function onMove(e) {
  const l = layers.value.find((x) => x.id === drag?.id)
  if (!l) return
  if (drag.mode === 'move') {
    l.nx = Math.min(1.05, Math.max(-0.05, drag.startNx + (e.clientX - drag.startX) / drag.rect.width))
    l.ny = Math.min(1.05, Math.max(-0.05, drag.startNy + (e.clientY - drag.startY) / drag.rect.height))
  } else if (drag.mode === 'scale') {
    const d = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy)
    l.nw = Math.min(2.2, Math.max(0.04, drag.startNw * (d / drag.startDist)))
  } else if (drag.mode === 'rotate') {
    const ang = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx)
    let rot = drag.startRot + ((ang - drag.startAng) * 180) / Math.PI
    const snap = Math.round(rot / 45) * 45
    if (Math.abs(rot - snap) < 4) rot = snap
    l.rot = Math.round(((rot % 360) + 360) % 360)
  }
}
function onUp() {
  drag = null
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
}

function layerStyle(l) {
  return {
    left: `${l.nx * 100}%`,
    top: `${l.ny * 100}%`,
    width: `${l.nw * 100}%`,
    height: `${((l.nw * A.value) / l.aspect) * 100}%`,
    transform: `translate(-50%, -50%) rotate(${l.rot}deg)`,
  }
}

/* ---------- 导出 ---------- */

async function save() {
  if (!layers.value.length || saving.value) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const a = A.value
    const long = outLong.value
    const W = a >= 1 ? long : Math.round(long * a)
    const H = a >= 1 ? Math.round(long / a) : long
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    const transparentOut = outFormat.value === 'image/png' && transparent.value
    if (!transparentOut) {
      ctx.fillStyle = bgColor.value
      ctx.fillRect(0, 0, W, H)
    }
    const imgs = await Promise.all(layers.value.map((l) => getLoaded(l.url).catch(() => null)))
    layers.value.forEach((l, i) => {
      const img = imgs[i]
      if (!img || !img.width) return
      const w = l.nw * W
      const h = w / l.aspect
      ctx.save()
      ctx.translate(l.nx * W, l.ny * H)
      ctx.rotate((l.rot * Math.PI) / 180)
      ctx.drawImage(img, -w / 2, -h / 2, w, h)
      ctx.restore()
    })
    const bytes = await canvasToBytes(canvas, outFormat.value, quality.value)
    const ext = outFormat.value === 'image/png' ? 'png' : 'jpg'
    const path = await toolbox.pickSaveFile({
      defaultName: `自由拼图.${ext}`,
      filters: [{ name: outFormat.value === 'image/png' ? 'PNG' : 'JPEG', extensions: [ext] }],
      bytes,
    })
    if (path) notice.value = `已保存到 ${path}`
  } catch (e) {
    error.value = `保存失败：${e.message || e}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="wrap">
    <section class="panel canvaspanel">
      <div class="toolbar">
        <button type="button" class="btn" :disabled="!imgStore.items.length" @click="addAll">把图片加入画布</button>
        <button type="button" class="op" title="置顶" :disabled="!sel" @click="bringToFront(sel.id)">⤒</button>
        <button type="button" class="op" title="上移一层" :disabled="!sel" @click="forward(sel.id)">↑</button>
        <button type="button" class="op" title="下移一层" :disabled="!sel" @click="backward(sel.id)">↓</button>
        <button type="button" class="op" title="复制" :disabled="!sel" @click="duplicate(sel.id)">⧉</button>
        <button type="button" class="op op--danger" title="删除" :disabled="!sel" @click="removeLayer(sel.id)">×</button>
        <span class="spacer" />
        <button type="button" class="op" title="缩小画布视图" @click="zoomOut">−</button>
        <span class="zoomlabel">{{ Math.round(zoom * 100) }}%</span>
        <button type="button" class="op" title="放大画布视图" @click="zoomIn">＋</button>
        <button type="button" class="mini" @click="fitZoom">适应</button>
      </div>
      <div ref="viewport" class="viewport">
        <div
          ref="box"
          class="canvasbox"
          :class="{ 'canvasbox--checker': outFormat === 'image/png' && transparent }"
          :style="{ width: `${zoom * 100}%`, aspectRatio: aspectId.replace(':', ' / ') }"
        >
          <div
            v-for="l in layers"
            :key="l.id"
            class="layer"
            :class="{ 'layer--sel': l.id === selId }"
            :style="layerStyle(l)"
            @pointerdown="onLayerDown($event, l)"
            @dblclick="bringToFront(l.id)"
          >
            <img :src="l.url" draggable="false" alt="" />
            <template v-if="l.id === selId">
              <span class="stick" />
              <span class="handle handle--rot" title="旋转" @pointerdown="onRotateDown($event, l)" />
              <span class="handle handle--scale" title="缩放" @pointerdown="onScaleDown($event, l)" />
            </template>
          </div>
          <div v-if="!layers.length" class="emptyhint">
            <p>画布还是空的</p>
            <p class="emptyhint__sub">点上方「把图片加入画布」,或点图片条上的 ⊕ 单张加入</p>
          </div>
        </div>
      </div>
      <p class="muted hint">拖动移动 · 右下角缩放 · 顶部圆点旋转(自动吸附 45°) · 双击置顶 · Delete 删除 · 越出画布的部分会被裁掉</p>
    </section>

    <section class="panel settings">
      <div class="row">
        <span class="row__label">画布比例</span>
        <div class="seg seg--wrap">
          <button
            v-for="a in ASPECTS"
            :key="a.id"
            type="button"
            class="segbtn"
            :class="{ 'segbtn--on': aspectId === a.id }"
            @click="aspectId = a.id"
          >
            {{ a.label }}
          </button>
        </div>
      </div>
      <div class="row">
        <span class="row__label">输出</span>
        <div class="seg seg--wrap">
          <button
            v-for="n in [1080, 1600, 2048, 3000, 4096]"
            :key="n"
            type="button"
            class="segbtn"
            :class="{ 'segbtn--on': outLong === n }"
            @click="outLong = n"
          >
            {{ n }}px
          </button>
        </div>
        <span class="unit">长边 · 输出 {{ A >= 1 ? outLong : Math.round(outLong * A) }} × {{ A >= 1 ? Math.round(outLong / A) : outLong }} px</span>
      </div>
      <div class="row">
        <label class="check">背景 <input v-model="bgColor" type="color" class="color" :disabled="transparent" /></label>
        <label v-if="outFormat === 'image/png'" class="check"><input v-model="transparent" type="checkbox" /> 透明背景</label>
      </div>
      <div class="row">
        <span class="row__label">输出格式</span>
        <div class="seg">
          <button type="button" class="segbtn" :class="{ 'segbtn--on': outFormat === 'image/png' }" @click="outFormat = 'image/png'">PNG</button>
          <button type="button" class="segbtn" :class="{ 'segbtn--on': outFormat === 'image/jpeg' }" @click="outFormat = 'image/jpeg'">JPEG</button>
        </div>
        <label v-if="outFormat === 'image/jpeg'" class="check">质量 {{ quality }}% <input v-model.number="quality" type="range" min="50" max="100" step="5" class="qslider" /></label>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="notice" class="muted">{{ notice }}</p>
      <button type="button" class="btn btn--primary run" :disabled="saving || !layers.length" @click="save">
        <span v-if="saving" class="spinner" />
        {{ saving ? '正在生成…' : '生成并保存' }}
      </button>
      <p class="muted">画布上共 {{ layers.length }} 个图层,按叠放顺序导出</p>
    </section>
  </div>
</template>

<style scoped>
.wrap { display: flex; flex-wrap: wrap-reverse; gap: 14px; align-items: flex-start; }
.panel { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 14px 16px; }
.canvaspanel { flex: 1 1 480px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.settings { flex: 0 1 300px; display: flex; flex-direction: column; gap: 12px; }

.toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.spacer { flex: 1; }
.zoomlabel { font-size: 12px; color: var(--c-text-muted); min-width: 42px; text-align: center; }
.op { border: 1px solid var(--c-border); background: var(--c-bg); border-radius: 6px; width: 28px; height: 26px; cursor: pointer; font-size: 13px; color: var(--c-text); }
.op:disabled { opacity: 0.4; }
.op--danger { color: var(--c-danger); }
.mini { border: 1px solid var(--c-border); background: var(--c-bg); color: var(--c-text-muted); border-radius: 6px; font-size: 12px; padding: 5px 10px; cursor: pointer; }
.mini:hover { color: var(--c-primary); border-color: var(--c-primary); }

.viewport { height: 480px; overflow: auto; background: var(--c-bg); border-radius: 10px; padding: 14px; }
.canvasbox { position: relative; margin: 0 auto; background: var(--c-surface); box-shadow: 0 0 0 1px var(--c-border); border-radius: 4px; }
.canvasbox--checker { background: repeating-conic-gradient(#e8edf3 0 25%, #ffffff 0 50%) 0 0 / 18px 18px; }

.layer { position: absolute; cursor: move; touch-action: none; }
.layer img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; user-select: none; }
.layer--sel { outline: 1.5px solid var(--c-primary); outline-offset: 0; }
.handle { position: absolute; width: 13px; height: 13px; border-radius: 50%; background: var(--c-surface); border: 1.5px solid var(--c-primary); cursor: pointer; touch-action: none; z-index: 2; }
.handle--scale { right: -7px; bottom: -7px; cursor: nwse-resize; }
.handle--rot { left: 50%; top: -30px; margin-left: -6.5px; cursor: grab; }
.stick { position: absolute; left: 50%; top: -18px; width: 1.5px; height: 18px; margin-left: -0.75px; background: var(--c-primary); }
.emptyhint { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; pointer-events: none; }
.emptyhint p { margin: 0; font-size: 14px; font-weight: 600; color: var(--c-text-muted); }
.emptyhint__sub { font-size: 12px; font-weight: 400 !important; }

.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.row__label { font-size: 13px; font-weight: 600; min-width: 60px; }
.check { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
.color { width: 34px; height: 28px; border: 1px solid var(--c-border); border-radius: 6px; background: none; padding: 0; }
.color:disabled { opacity: 0.4; }
.qslider { width: 100px; }
.seg { display: flex; gap: 4px; background: var(--c-bg); border-radius: 8px; padding: 3px; flex-wrap: wrap; }
.segbtn { border: none; background: transparent; padding: 5px 11px; font-size: 12.5px; border-radius: 6px; cursor: pointer; color: var(--c-text-muted); }
.segbtn--on { background: var(--c-primary); color: #fff; }
.unit { font-size: 12px; color: var(--c-text-muted); }
.run { justify-content: center; padding: 12px; }
.muted { margin: 0; font-size: 12.5px; color: var(--c-text-muted); }
.hint { font-size: 11.5px; }
.error { margin: 0; font-size: 12.5px; color: var(--c-danger); }
</style>
