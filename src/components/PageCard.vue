<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { usePdfStore } from '../stores/pdf'
import { getCurrentDoc, renderPageToDataUrl } from '../composables/usePdfRenderer'
import { normalizeCrop, resizeCrop } from '../utils/cropMath'
import { MASK_FILL, CROP_STROKE } from '../constants/pdf'

// 8 个控点方向 + 对应 DOM 定位样式类
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const props = defineProps({
  page: { type: Object, required: true }, // { index, width, height }
  crop: { type: Object, default: null },
})

const store = usePdfStore()
const wrapRef = ref(null)
const src = ref('')
const maskId = `page-mask-${props.page.index}`
const drawing = ref(false)
const start = ref({ x: 0, y: 0 }) // 按下点（归一化）
const current = ref({ x: 0, y: 0 }) // 当前点（归一化）

const resizing = ref(false) // 正在拖动控点
const resizingHandle = ref('') // 当前控点方向
const resizeStart = ref({ x: 0, y: 0 }) // 按下时指针（归一化）
const resizeOrigin = ref(null) // 按下时原始裁剪框

const aspect = computed(() => `${props.page.width} / ${props.page.height}`)

// 实时拖拽框（归一化矩形）
const draftRect = computed(() => {
  if (!drawing.value) return null
  const sx = start.value.x
  const sy = start.value.y
  const ex = current.value.x
  const ey = current.value.y
  const x = Math.min(sx, ex)
  const y = Math.min(sy, ey)
  const w = Math.abs(ex - sx)
  const h = Math.abs(ey - sy)
  return { x, y, w, h }
})

function clamp01(v) {
  return Math.min(Math.max(v, 0), 1)
}

function pointFromEvent(e) {
  const rect = wrapRef.value.getBoundingClientRect()
  return {
    x: clamp01((e.clientX - rect.left) / rect.width),
    y: clamp01((e.clientY - rect.top) / rect.height),
  }
}

// 未夹取版本，供拖动控点时计算位移（resizeCrop 内部会自行夹取边界）
function rawPointFromEvent(e) {
  const rect = wrapRef.value.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  }
}

// 根据控点方向计算定位样式（绑定 crop 归一化坐标，百分比相对画布宽高）
function handleStyle(h) {
  const pct = (v) => `${Math.round(v * 1000) / 10}%`
  const c = props.crop
  const xL = c.x
  const xR = c.x + c.w
  const yT = c.y
  const yB = c.y + c.h
  const pos = {
    nw: [xL, yT],
    n: [xL + c.w / 2, yT],
    ne: [xR, yT],
    e: [xR, yT + c.h / 2],
    se: [xR, yB],
    s: [xL + c.w / 2, yB],
    sw: [xL, yB],
    w: [xL, yT + c.h / 2],
  }
  const [left, top] = pos[h] || [0, 0]
  return { left: pct(left), top: pct(top) }
}

function onHandleDown(e, handle) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation() // 避免触发整页框选
  if (!props.crop) return
  store.setSelectedPage(props.page.index)
  // 切换「绘制新框」为「调整」，直接取消记录中的拖拽
  if (drawing.value) {
    drawing.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  resizing.value = true
  resizingHandle.value = handle
  resizeStart.value = rawPointFromEvent(e)
  resizeOrigin.value = { ...props.crop }
  window.addEventListener('mousemove', onHandleMove)
  window.addEventListener('mouseup', onHandleUp)
}

function onHandleMove(e) {
  if (!resizing.value || !resizeOrigin.value) return
  const p = rawPointFromEvent(e)
  const dx = p.x - resizeStart.value.x
  const dy = p.y - resizeStart.value.y
  store.setCropBox(props.page.index, resizeCrop(resizeOrigin.value, resizingHandle.value, dx, dy))
}

function onHandleUp() {
  if (!resizing.value) return
  resizing.value = false
  resizingHandle.value = ''
  resizeOrigin.value = null
  window.removeEventListener('mousemove', onHandleMove)
  window.removeEventListener('mouseup', onHandleUp)
}

function onMouseDown(e) {
  if (e.button !== 0) return // 仅左键
  e.preventDefault()
  store.setSelectedPage(props.page.index)
  start.value = pointFromEvent(e)
  current.value = { ...start.value }
  drawing.value = true
  // 关键：移动/抬起都监听在 window 上，指针移出卡片也不会丢事件
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function onMove(e) {
  if (!drawing.value) return
  current.value = pointFromEvent(e)
}

function onUp() {
  if (!drawing.value) return
  // 先读取拖拽几何，再重置 drawing（draftRect 依赖 drawing.value，重置后会是 null）
  const sx = start.value.x
  const sy = start.value.y
  const ex = current.value.x
  const ey = current.value.y
  const x = Math.min(sx, ex)
  const y = Math.min(sy, ey)
  const w = Math.abs(ex - sx)
  const h = Math.abs(ey - sy)
  drawing.value = false
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
  const crop = normalizeCrop({ x, y, w, h })
  // 过小视为误触不处理，保留原有裁剪
  if (crop) store.setCropBox(props.page.index, crop)
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
  window.removeEventListener('mousemove', onHandleMove)
  window.removeEventListener('mouseup', onHandleUp)
})

onMounted(async () => {
  try {
    const doc = getCurrentDoc()
    if (doc) src.value = await renderPageToDataUrl(doc, props.page.index)
  } catch (e) {
    console.error('渲染页面失败:', props.page.index, e)
  }
})
</script>

<template>
  <div class="page-card">
    <div class="page-card__head">
      <span class="page-card__label">第 {{ page.index }} 页</span>
      <span v-if="crop" class="page-card__status">已框选</span>
      <span v-else class="page-card__status page-card__status--idle">未框选</span>
      <button
        v-if="crop"
        type="button"
        class="page-card__clear"
        @click.stop="store.clearCropBox(page.index)"
      >清除</button>
    </div>

    <div
      ref="wrapRef"
      class="page-card__canvas"
      :style="{ aspectRatio: aspect }"
      @mousedown="onMouseDown"
    >
      <img v-if="src" :src="src" alt="第" class="page-card__img" draggable="false" />

      <!-- 框选遮罩（归一化坐标 0~1） -->
      <svg class="page-card__overlay" viewBox="0 0 1 1" preserveAspectRatio="none">
        <defs>
          <mask :id="maskId">
            <rect x="0" y="0" width="1" height="1" fill="#fff" />
            <rect
              v-if="crop"
              :x="crop.x"
              :y="crop.y"
              :width="crop.w"
              :height="crop.h"
              fill="#000"
            />
            <rect
              v-if="draftRect"
              :x="draftRect.x"
              :y="draftRect.y"
              :width="draftRect.w"
              :height="draftRect.h"
              fill="#000"
            />
          </mask>
        </defs>
        <!-- 框选外半透明遮罩（框选内保留高亮） -->
        <rect
          v-if="crop || draftRect"
          x="0"
          y="0"
          width="1"
          height="1"
          :fill="MASK_FILL"
          :mask="`url(#${maskId})`"
        />
        <!-- 已确认裁剪框 -->
        <rect
          v-if="crop"
          :x="crop.x"
          :y="crop.y"
          :width="crop.w"
          :height="crop.h"
          fill="rgba(59, 130, 246, 0.08)"
          :stroke="CROP_STROKE"
          stroke-width="0.004"
        />
        <!-- 拖拽中的实时框（更粗更明显） -->
        <rect
          v-if="draftRect"
          :x="draftRect.x"
          :y="draftRect.y"
          :width="draftRect.w"
          :height="draftRect.h"
          fill="rgba(59, 130, 246, 0.10)"
          :stroke="CROP_STROKE"
          stroke-width="0.004"
        />
      </svg>

      <!-- 裁剪框 8 个控点（仅在已框选时显示） -->
      <div v-if="crop" class="crop-handles">
        <div
          v-for="h in HANDLES"
          :key="h"
          class="crop-handle"
          :class="`crop-handle--${h}`"
          :style="handleStyle(h)"
          @mousedown="onHandleDown($event, h)"
        ></div>
      </div>

      <div v-if="!crop && !drawing" class="page-card__hint">在此页面上按住鼠标左键拖动，框选要保留的区域</div>
      <div v-else-if="drawing && draftRect" class="page-card__size">
        {{ Math.round(draftRect.w * 100) }}% × {{ Math.round(draftRect.h * 100) }}%
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-card {
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  padding: 4px 0;
}

.page-card__head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}
.page-card__label {
  font-weight: 600;
  font-size: 14px;
}
.page-card__status {
  font-size: 12px;
  color: var(--c-primary);
  background: rgba(59, 130, 246, 0.12);
  border-radius: 999px;
  padding: 2px 10px;
}
.page-card__status--idle {
  color: var(--c-text-muted);
  background: var(--c-bg);
}
.page-card__clear {
  margin-left: auto;
  font-size: 12px;
  color: #ef4444;
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 999px;
  padding: 2px 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.page-card__clear:hover {
  background: rgba(239, 68, 68, 0.12);
}

.page-card__canvas {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 8px;
  cursor: crosshair;
  user-select: none;
  touch-action: none;
  background: var(--c-bg);
}

.page-card__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
}

.page-card__overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.page-card__hint {
  position: absolute;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  font-size: 13px;
  color: #fff;
  background: rgba(15, 23, 42, 0.55);
  border-radius: 999px;
  padding: 6px 16px;
  pointer-events: none;
  white-space: nowrap;
}

.page-card__size {
  position: absolute;
  right: 12px;
  top: 12px;
  font-size: 12px;
  color: #fff;
  background: rgba(15, 23, 42, 0.65);
  border-radius: 6px;
  padding: 4px 8px;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}

.crop-handles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.crop-handle {
  position: absolute;
  width: 14px;
  height: 14px;
  background: #fff;
  border: 2px solid var(--c-primary);
  border-radius: 3px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  box-sizing: border-box;
  pointer-events: auto;
  transform: translate(-50%, -50%);
}
.crop-handle:hover {
  background: var(--c-primary);
  border-color: #fff;
}

/* 角点斜向 + 中心边点纵向/横向的鼠标光标提示 */
.crop-handle--nw,
.crop-handle--se {
  cursor: nwse-resize;
}
.crop-handle--ne,
.crop-handle--sw {
  cursor: nesw-resize;
}
.crop-handle--n,
.crop-handle--s {
  cursor: ns-resize;
}
.crop-handle--e,
.crop-handle--w {
  cursor: ew-resize;
}
</style>