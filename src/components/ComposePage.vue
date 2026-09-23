<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { useComposeStore } from '../stores/compose'
import { normalizeRect, resizeRect } from '../utils/composeMath'

// 8 个缩放控点方向（复用 PageCard 的控点范式，落在「元素」上而非整页）
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const props = defineProps({
  page: { type: Object, required: true }, // { id, width(pt), height(pt) }
  tool: { type: String, default: 'select' }, // 'select' | 'cover' | 'mosaic'
  selectedId: { type: String, default: '' },
  selectedKind: { type: String, default: 'element' },
  active: { type: Boolean, default: false }, // 是否为当前选中页（决定是否显示控点/可编辑）
  sort: { type: Boolean, default: false }, // 排序模式：整体缩放、整页拖动排序、禁止元素编辑
  dropBefore: { type: Boolean, default: false }, // 排序拖拽时此页为插入目标（页前显示竖线）
})
const emit = defineEmits(['select', 'move-out', 'delete'])

const store = useComposeStore()
const wrapRef = ref(null)

const aspect = computed(() => `${props.page.width} / ${props.page.height}`)
const elements = computed(() => store.elementsOf(props.page.id))
const annotations = computed(() => store.annotationsOf(props.page.id))

// —— 选中目标 ——
const selectedElement = computed(() =>
  props.selectedKind === 'element'
    ? store.elements.find((e) => e.id === props.selectedId) || null
    : null,
)
const selectedAnnotation = computed(() =>
  props.selectedKind === 'annotation'
    ? store.annotations.find((a) => a.id === props.selectedId) || null
    : null,
)

// —— 画布坐标换算：client 像素 → 归一化(0~1)，clamp 决定是否夹到页内 ——
function pointFromEvent(e, clamp = true) {
  const rect = wrapRef.value.getBoundingClientRect()
  let x = (e.clientX - rect.left) / rect.width
  let y = (e.clientY - rect.top) / rect.height
  if (clamp) {
    x = Math.min(Math.max(x, 0), 1)
    y = Math.min(Math.max(y, 0), 1)
  }
  return { x, y }
}

const pct = (v) => `${Math.round(v * 1000) / 10}%`

// —— 元素拖动移动（tool=select 点击元素后拖动）——
// 位移按「px 归一化到画布」换算 dx/dy，再调 store.moveElement(..., keepInPage=true)。
// 拖动时为元素加不透明度，松手恢复。
const draggingId = ref(null)
const dragStart = ref({ x: 0, y: 0 })
const dragOrigin = ref({ x: 0, y: 0 })

function onElementDown(e, el) {
  if (e.button !== 0 || props.tool !== 'select') return
  if (props.sort) return // 排序模式下禁止元素编辑
  e.preventDefault()
  e.stopPropagation() // 避免触发画布 else（标注/取消选中）
  emit('select', { kind: 'element', id: el.id })
  // 图片来源（kind=image）可拖动；PDF 页（locked）仅可选中，不可移动/缩放
  if (el.locked) return
  draggingId.value = el.id
  const p = pointFromEvent(e, false)
  dragStart.value = { x: p.x, y: p.y }
  dragOrigin.value = { x: el.x, y: el.y }
  window.addEventListener('mousemove', onElementMove)
  window.addEventListener('mouseup', onElementUp)
}

function endElementDrag() {
  draggingId.value = null
  window.removeEventListener('mousemove', onElementMove)
  window.removeEventListener('mouseup', onElementUp)
}

/**
 * 跨页拖拽机制（拖动移动过程中触发）：
 * - 指针越过本画布下方 → 'down'，越过上方 → 'up'，交由父组件 PdfCompose 决定目标页
 *   （上→前一页末尾，下→后一页开头；超出边界或 Ctrl+拖动 → '__new__' 新建页承接）。
 * - 一旦触发即结束本地拖动（松手语义），父组件调用 store.moveElement 完成跨页放置。
 */
function onElementMove(e) {
  if (!draggingId.value) return
  const el = store.elements.find((it) => it.id === draggingId.value)
  if (!el) return
  const rect = wrapRef.value.getBoundingClientRect()
  // 穿过画布上/下边界 → 跨页
  if (e.clientY < rect.top || e.clientY > rect.bottom) {
    const direction = e.clientY > rect.bottom ? 'down' : 'up'
    emit('move-out', { id: el.id, direction: e.ctrlKey ? '__new__' : direction })
    endElementDrag()
    return
  }
  const p = pointFromEvent(e, false)
  const dx = p.x - dragStart.value.x
  const dy = p.y - dragStart.value.y
  store.moveElement(el.id, el.pageId, dragOrigin.value.x + dx, dragOrigin.value.y + dy, true)
}

function onElementUp() {
  endElementDrag()
}

// —— 元素缩放（选中后拖动 8 控点）——
const resizingId = ref(null)
const resizingHandle = ref('')
const resizeStart = ref({ x: 0, y: 0 })
const resizeOrigin = ref(null)

function onHandleDown(e, el, h) {
  if (e.button !== 0 || props.sort) return
  if (el.locked) return // PDF 页不可缩放
  e.preventDefault()
  e.stopPropagation()
  emit('select', { kind: 'element', id: el.id })
  resizingId.value = el.id
  resizingHandle.value = h
  resizeStart.value = pointFromEvent(e, false)
  resizeOrigin.value = { x: el.x, y: el.y, w: el.w, h: el.h }
  window.addEventListener('mousemove', onHandleMove)
  window.addEventListener('mouseup', onHandleUp)
}

function onHandleMove(e) {
  if (!resizingId.value) return
  const el = store.elements.find((it) => it.id === resizingId.value)
  const p = pointFromEvent(e, false)
  const dx = p.x - resizeStart.value.x
  const dy = p.y - resizeStart.value.y
  store.resizeElement(el.id, resizeRect(resizeOrigin.value, resizingHandle.value, dx, dy))
}

function onHandleUp() {
  resizingId.value = null
  resizingHandle.value = ''
  resizeOrigin.value = null
  window.removeEventListener('mousemove', onHandleMove)
  window.removeEventListener('mouseup', onHandleUp)
}

// 根据控点方向计算定位样式（相对选中元素，百分比偏移画布）
function handleStyle(h) {
  const el = selectedElement.value
  if (!el) return {}
  const xL = el.x
  const xR = el.x + el.w
  const yT = el.y
  const yB = el.y + el.h
  const pos = {
    nw: [xL, yT],
    n: [xL + el.w / 2, yT],
    ne: [xR, yT],
    e: [xR, yT + el.h / 2],
    se: [xR, yB],
    s: [xL + el.w / 2, yB],
    sw: [xL, yB],
    w: [xL, yT + el.h / 2],
  }
  const [left, top] = pos[h] || [0, 0]
  return { left: pct(left), top: pct(top) }
}

// 批注(cover)八角缩放的控点定位样式
function annHandleStyle(h) {
  const a = selectedAnnotation.value
  if (!a) return {}
  const pos = {
    nw: [a.x, a.y],
    n: [a.x + a.w / 2, a.y],
    ne: [a.x + a.w, a.y],
    e: [a.x + a.w, a.y + a.h / 2],
    se: [a.x + a.w, a.y + a.h],
    s: [a.x + a.w / 2, a.y + a.h],
    sw: [a.x, a.y + a.h],
    w: [a.x, a.y + a.h / 2],
  }
  const [left, top] = pos[h] || [0, 0]
  return { left: pct(left), top: pct(top) }
}

// —— 标注绘制（tool=cover/mosaic 时在画布空白处拖出矩形）——
const drawing = ref(false)
const drawStart = ref({ x: 0, y: 0 })
const drawCurrent = ref({ x: 0, y: 0 })
const draftRect = computed(() => {
  if (!drawing.value) return null
  const sx = drawStart.value.x
  const sy = drawStart.value.y
  const ex = drawCurrent.value.x
  const ey = drawCurrent.value.y
  return { x: Math.min(sx, ex), y: Math.min(sy, ey), w: Math.abs(ex - sx), h: Math.abs(ey - sy) }
})

function onCanvasDown(e) {
  if (e.button !== 0) return
  if (props.sort) return // 排序模式由整页拖动承担，禁止页内绘制/选择
  if (props.tool === 'select') {
    // 仅当前选中页可交互
    if (!props.active) {
      emit('select', { kind: '', id: '' })
      return
    }
    // 复制/剪切后：点击画布将图片粘贴到鼠标所在位置
    if (store.copyBuffer) {
      const p = pointFromEvent(e)
      const el = store.pasteElementAt(props.page.id, p)
      if (el) {
        store.copyBuffer = null
        emit('select', { kind: 'element', id: el.id })
      }
      return
    }
    // 点击空白取消选中
    emit('select', { kind: '', id: '' })
    return
  }
  // 已有选中的批注/马赛克时，点击框外先取消选中，而非新建
  if (props.selectedKind === 'annotation' && props.selectedId) {
    emit('select', { kind: '', id: '' })
    return
  }
  e.preventDefault()
  const p = pointFromEvent(e)
  drawStart.value = { x: p.x, y: p.y }
  drawCurrent.value = { x: p.x, y: p.y }
  drawing.value = true
  window.addEventListener('mousemove', onDrawMove)
  window.addEventListener('mouseup', onDrawUp)
}

function onDrawMove(e) {
  if (!drawing.value) return
  drawCurrent.value = pointFromEvent(e)
}

function onDrawUp() {
  if (!drawing.value) return
  const sx = drawStart.value.x
  const sy = drawStart.value.y
  const ex = drawCurrent.value.x
  const ey = drawCurrent.value.y
  const rect = normalizeRect({ x: Math.min(sx, ex), y: Math.min(sy, ey), w: Math.abs(ex - sx), h: Math.abs(ey - sy) })
  drawing.value = false
  window.removeEventListener('mousemove', onDrawMove)
  window.removeEventListener('mouseup', onDrawUp)
  if (!rect) return
  const ann = store.addAnnotation({ pageId: props.page.id, type: props.tool, rect })
  if (ann) emit('select', { kind: 'annotation', id: ann.id })
}

// —— 标注：选中 / 删除（✕）/ cover 文字编辑 ——
// select 工具下按住批注(cover)块可拖动位置；cover/mosaic 工具仅点选高亮。
function onAnnotationDown(e, a) {
  if (e.button !== 0) return
  e.stopPropagation()
  emit('select', { kind: 'annotation', id: a.id })
  if (props.tool !== 'select' || a.type !== 'cover') return // 非 select 或马赛克不拖动
  draggingAnnId.value = a.id
  const p = pointFromEvent(e, false)
  annDragStart.value = { x: p.x, y: p.y }
  annDragOrigin.value = { x: a.x, y: a.y }
  window.addEventListener('mousemove', onAnnotationMove)
  window.addEventListener('mouseup', onAnnotationUp)
}

const draggingAnnId = ref(null)
const annDragStart = ref({ x: 0, y: 0 })
const annDragOrigin = ref({ x: 0, y: 0 })

function onAnnotationMove(e) {
  if (!draggingAnnId.value) return
  const a = store.annotations.find((it) => it.id === draggingAnnId.value)
  if (!a) return
  const p = pointFromEvent(e, false)
  store.moveAnnotation(a.id, annDragOrigin.value.x + (p.x - annDragStart.value.x), annDragOrigin.value.y + (p.y - annDragStart.value.y))
}

function onAnnotationUp() {
  draggingAnnId.value = null
  window.removeEventListener('mousemove', onAnnotationMove)
  window.removeEventListener('mouseup', onAnnotationUp)
}

// —— 批注(cover)八角缩放（选中后拖 8 控点）——
const resizingAnnId = ref(null)
const resizingAnnHandle = ref('')
const annResizeStart = ref({ x: 0, y: 0 })
const annResizeOrigin = ref(null)

function onAnnHandleDown(e, a, h) {
  if (e.button !== 0 || props.sort) return
  e.preventDefault()
  e.stopPropagation()
  emit('select', { kind: 'annotation', id: a.id })
  resizingAnnId.value = a.id
  resizingAnnHandle.value = h
  annResizeStart.value = pointFromEvent(e, false)
  annResizeOrigin.value = { x: a.x, y: a.y, w: a.w, h: a.h }
  window.addEventListener('mousemove', onAnnHandleMove)
  window.addEventListener('mouseup', onAnnHandleUp)
}

function onAnnHandleMove(e) {
  if (!resizingAnnId.value) return
  const a = store.annotations.find((it) => it.id === resizingAnnId.value)
  if (!a) return
  const p = pointFromEvent(e, false)
  const dx = p.x - annResizeStart.value.x
  const dy = p.y - annResizeStart.value.y
  store.resizeAnnotation(a.id, resizeRect(annResizeOrigin.value, resizingAnnHandle.value, dx, dy))
}

function onAnnHandleUp() {
  resizingAnnId.value = null
  resizingAnnHandle.value = ''
  annResizeOrigin.value = null
  window.removeEventListener('mousemove', onAnnHandleMove)
  window.removeEventListener('mouseup', onAnnHandleUp)
}

function onAnnotationDelete(e, a) {
  e.stopPropagation()
  e.preventDefault()
  emit('delete', { kind: 'annotation', id: a.id })
}

function commitCoverText(a, ev) {
  store.setAnnotationText(a.id, ev.target.value)
}

const draftStyle = computed(() => {
  const d = draftRect.value
  if (!d) return {}
  return { left: pct(d.x), top: pct(d.y), width: pct(d.w), height: pct(d.h) }
})

function annStyle(a) {
  // 批注/打码与图片共用递增层级，按覆盖先后叠在上层（高于 PDF 页的 zIndex 1）
  return { left: pct(a.x), top: pct(a.y), width: pct(a.w), height: pct(a.h), zIndex: (a.z || 2) + 2 }
}

// 批注文字样式（字体/字号/颜色/对齐）
// 排序模式下页面整体缩到 max-width:180px，批注字号同步等比缩小（约 0.5 倍）
function coverTextStyle(a) {
  const hmap = { left: 'flex-start', center: 'center', right: 'flex-end' }
  const vmap = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }
  const base = a.fontSize || 12
  // 排序时页面 max-width 180px，典型原始页宽约 360px → scale ≈ 0.5
  const scale = props.sort ? 0.5 : 1
  return {
    fontFamily: a.fontFamily || 'sans-serif',
    fontSize: `${Math.round(base * scale * 100) / 100}px`,
    lineHeight: 1.35,
    color: a.color || '#000',
    whiteSpace: 'pre-wrap',
    textAlign: a.alignH || 'left',
    justifyContent: hmap[a.alignH] || 'flex-start',
    alignItems: vmap[a.alignV] || 'center',
  }
}

// 打码区域背景：纯色 or 特别浅的灰白格
function mosaicBg(a) {
  if (a.style === 'solid') {
    return { backgroundColor: a.color || '#cfd4db', backgroundImage: 'none' }
  }
  return {
    backgroundColor: '#e9ecef',
    backgroundImage:
      'repeating-conic-gradient(#f6f7f9 0% 25%, #e2e7ee 0% 50%, #f6f7f9 0% 75%, #e2e7ee 0% 100%)',
    backgroundSize: '14px 14px',
  }
}

function elementStyle(el) {
  return {
    left: pct(el.x),
    top: pct(el.y),
    width: pct(el.w),
    height: pct(el.h),
    opacity: draggingId.value === el.id ? 0.6 : 1,
    // 层级：PDF 页固定最底层(z=0→zIndex 1)；图片按覆盖先后递增叠加（拖动时临时置顶）
    zIndex:
      el.kind === 'pdf'
        ? 1
        : draggingId.value === el.id
          ? 100000
          : (el.z || 2) + 2,
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onElementMove)
  window.removeEventListener('mouseup', onElementUp)
  window.removeEventListener('mousemove', onHandleMove)
  window.removeEventListener('mouseup', onHandleUp)
  window.removeEventListener('mousemove', onDrawMove)
  window.removeEventListener('mouseup', onDrawUp)
  window.removeEventListener('mousemove', onAnnotationMove)
  window.removeEventListener('mouseup', onAnnotationUp)
  window.removeEventListener('mousemove', onAnnHandleMove)
  window.removeEventListener('mouseup', onAnnHandleUp)
})

// —— 排序模式：HTML5 拖拽整页排序 ——
</script>

<template>
  <div
    class="c-page"
    :class="{ 'c-page--sort': sort, 'c-page--inactive': !active && !sort, 'c-page--drop': dropBefore }"
    :data-page-id="props.page.id"
  >
    <!-- 排序模式页角标（可拖动整页） -->
    <div v-if="sort" class="c-page__sort-badge">☰ 拖动排序</div>
    <div
      ref="wrapRef"
      class="c-page__canvas"
      :class="`c-page__canvas--${tool}`"
      :style="{ aspectRatio: aspect }"
      @mousedown="onCanvasDown"
    >
      <!-- 空态：此页无元素，或留白区，让用户看到「这一页是空的」 -->
      <div v-if="elements.length === 0 && !draggingId" class="c-page__empty">此页为空</div>

      <!-- 元素 -->
      <div
        v-for="el in elements"
        :key="el.id"
        class="c-element"
        :class="{
          'c-element--selected': selectedElement && selectedElement.id === el.id,
          'c-element--locked': el.locked,
          'c-element--unactive': !active && !sort,
        }"
        :style="elementStyle(el)"
        @mousedown="onElementDown($event, el)"
      >
        <img :src="el.src" class="c-element__img" draggable="false" alt="" />
      </div>

      <!-- 选中元素的 8 个缩放控点（仅当前选中页、且非锁定元素显示） -->
      <div v-if="active && selectedElement && !selectedElement.locked" class="c-page__handles">
        <div
          v-for="h in HANDLES"
          :key="h"
          class="c-handle"
          :class="`c-handle--${h}`"
          :style="handleStyle(h)"
          @mousedown="onHandleDown($event, selectedElement, h)"
        ></div>
      </div>
      <!-- 选中的批注(cover)：8 个八角缩放控点（可移动位置 + 缩放大小） -->
      <div
        v-else-if="active && selectedAnnotation && selectedAnnotation.type === 'cover'"
        class="c-page__handles"
      >
        <div
          v-for="h in HANDLES"
          :key="h"
          class="c-handle"
          :class="`c-handle--${h}`"
          :style="annHandleStyle(h)"
          @mousedown="onAnnHandleDown($event, selectedAnnotation, h)"
        ></div>
      </div>

      <!-- 标注：cover（白底+黑字）与 mosaic（马赛克示意） -->
      <template v-for="a in annotations" :key="a.id">
        <div
          v-if="a.type === 'cover'"
          class="c-annotation c-annotation--cover"
          :class="{ 'c-annotation--selected': selectedAnnotation && selectedAnnotation.id === a.id }"
          :style="annStyle(a)"
          @mousedown="onAnnotationDown($event, a)"
        >
          <textarea
            v-if="selectedAnnotation && selectedAnnotation.id === a.id"
            class="c-annotation__input"
            :value="a.text"
            :style="coverTextStyle(a)"
            @input="commitCoverText(a, $event)"
            @blur="commitCoverText(a, $event)"
            @keydown.enter.exact="$event.target.blur()"
            @mousedown.stop
          ></textarea>
          <span v-else-if="a.text" class="c-annotation__text" :style="coverTextStyle(a)">{{ a.text }}</span>
          <button
            v-if="selectedAnnotation && selectedAnnotation.id === a.id"
            type="button"
            class="c-annotation__remove"
            @mousedown.stop
            @click="onAnnotationDelete($event, a)"
          >✕</button>
        </div>
        <div
          v-else
          class="c-annotation c-annotation--mosaic"
          :class="{ 'c-annotation--selected': selectedAnnotation && selectedAnnotation.id === a.id }"
          :style="{ ...annStyle(a), ...mosaicBg(a) }"
          @mousedown="onAnnotationDown($event, a)"
        ></div>
      </template>

      <!-- 绘制中的草稿矩形（蓝边半透明） -->
      <div v-if="draftRect" class="c-page__draft" :style="draftStyle"></div>
    </div>
  </div>
</template>

<style scoped>
.c-page {
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  padding: 4px 0;
}

/* 排序模式：整体缩略、禁用页内编辑、整页可拖拽排序 */
.c-page--sort {
  max-width: 180px;
  cursor: grab;
  user-select: none;
}
.c-page--sort .c-page__canvas {
  pointer-events: none;
}
/* 排序拖入：在页前方显示高亮插入竖线（指示将插入到该页之前/两页中间） */
.c-page--sort.c-page--drop {
  position: relative;
}
.c-page--sort.c-page--drop::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 10px;
  bottom: 10px;
  width: 4px;
  background: var(--c-primary);
  border-radius: 3px;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.7);
  z-index: 6;
}
.c-page__sort-badge {
  text-align: center;
  font-size: 12px;
  color: var(--c-primary);
  padding-bottom: 4px;
  font-weight: 600;
}
/* 非当前选中页：元素半透明提示未激活（控点不显示） */
.c-page--inactive .c-element {
  filter: saturate(0.6);
  opacity: 0.85;
}

.c-page__canvas {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 8px;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  user-select: none;
  touch-action: none;
}

.c-page__canvas--cover,
.c-page__canvas--mosaic {
  cursor: crosshair;
}

/* —— 元素 —— */
/* —— 层级：标注浮于元素之上（修复选择/移动工具下标注被置底不可点）——
   元素 z-index:1，选中元素:2，标注:3（始终在元素上层），手柄容器:4。 */
.c-element {
  position: absolute;
  box-sizing: border-box;
  cursor: grab;
  z-index: 1;
}
.c-element--selected {
  outline: 2px solid var(--c-primary);
  outline-offset: -1px;
  cursor: move;
  z-index: 2;
}
.c-element--locked {
  cursor: default;
}
.c-element__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}

/* —— 缩放开点 —— */
.c-page__handles {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
}
.c-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: #fff;
  border: 2px solid var(--c-primary);
  border-radius: 3px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  box-sizing: border-box;
  pointer-events: auto;
  transform: translate(-50%, -50%);
}
.c-handle:hover {
  background: var(--c-primary);
  border-color: #fff;
}
.c-handle--nw,
.c-handle--se {
  cursor: nwse-resize;
}
.c-handle--ne,
.c-handle--sw {
  cursor: nesw-resize;
}
.c-handle--n,
.c-handle--s {
  cursor: ns-resize;
}
.c-handle--e,
.c-handle--w {
  cursor: ew-resize;
}

/* —— 标注 —— */
.c-annotation {
  position: absolute;
  box-sizing: border-box;
  z-index: 3; /* 置顶：浮于元素上层，选择/移动工具下也可点选 */
}
.c-annotation--selected {
  outline: 2px solid var(--c-primary);
  outline-offset: -1px;
}
.c-annotation--cover {
  background: #ffffff;
}
.c-annotation--mosaic {
  /* 双色方块：不透明的深灰/浅灰棋盘格示意 */
  background-color: #9aa3af;
  background-image: repeating-conic-gradient(
    #6b7280 0% 25%,
    #d1d5db 0% 50%,
    #6b7280 0% 75%,
    #d1d5db 0% 100%
  );
  background-size: 14px 14px;
  box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.4);
  cursor: crosshair;
}
.c-annotation__text {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: #000;
  font-size: 12px;
  line-height: 1.2;
  padding: 2px;
  box-sizing: border-box;
  text-align: center;
  word-break: break-word;
}
.c-annotation__input {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  text-align: inherit;
  font-size: 12px;
  line-height: 1.35;
  color: #000;
  outline: none;
  box-sizing: border-box;
  resize: none;
  overflow: hidden;
  padding: 2px 4px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
}
.c-annotation__remove {
  position: absolute;
  top: -26px;
  right: -6px;
  width: 20px;
  height: 20px;
  line-height: 1;
  border: none;
  border-radius: 50%;
  background: var(--c-danger);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}

/* —— 草稿 —— */
.c-page__draft {
  position: absolute;
  background: rgba(59, 130, 246, 0.1);
  border: 1.5px solid var(--c-primary);
  z-index: 3;
  box-sizing: border-box;
}

/* —— 空态 —— */
.c-page__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--c-text-muted);
  pointer-events: none;
}
</style>