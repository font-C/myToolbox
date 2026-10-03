<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { toolbox } from '@toolbox/plugin-sdk'
import { imgStore } from './images.js'
import { useLoadedImages, debounce, canvasToBytes } from './useLoadedImages.js'
import { layoutStrip, capLayout, renderStrip } from './longstrip.js'

const direction = ref('v') // v | h
const sizeMode = ref('widest') // widest | custom
const customSize = ref(800)
const align = ref('fit') // fit | center
const gap = ref(12)
const margin = ref(16)
const bgColor = ref('#ffffff')
const transparent = ref(false)
const outFormat = ref('image/png')
const quality = ref(90)

const saving = ref(false)
const error = ref('')
const notice = ref('')
const cv = ref(null)

const imgs = useLoadedImages()

const rawLayout = computed(() => {
  if (imgs.value.length < 1) return null
  return layoutStrip(
    {
      direction: direction.value,
      mode: sizeMode.value,
      base: customSize.value,
      align: align.value,
      gap: gap.value,
      margin: margin.value,
    },
    imgs.value,
  )
})
const layout = computed(() => (rawLayout.value ? capLayout(rawLayout.value) : null))

const previewBox = { w: 620, h: 430 }
function renderPreview() {
  const el = cv.value
  const lay = layout.value
  if (!el || !lay || !lay.cells.length) return
  const s = Math.min(1, previewBox.w / lay.W, previewBox.h / lay.H)
  el.width = Math.max(1, Math.round(lay.W * s))
  el.height = Math.max(1, Math.round(lay.H * s))
  el.style.width = `${el.width}px`
  el.style.height = `${el.height}px`
  renderStrip(el, lay, { bg: bgColor.value, transparent: outFormat.value === 'image/png' && transparent.value })
}
const scheduleRender = debounce(renderPreview, 120)
watch(
  [layout, bgColor, transparent, outFormat],
  scheduleRender,
)
onMounted(renderPreview)

async function save() {
  const lay = layout.value
  if (!lay || !lay.cells.length || saving.value) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const canvas = document.createElement('canvas')
    canvas.width = lay.W
    canvas.height = lay.H
    renderStrip(canvas, lay, { bg: bgColor.value, transparent: outFormat.value === 'image/png' && transparent.value })
    const bytes = await canvasToBytes(canvas, outFormat.value, quality.value)
    const ext = outFormat.value === 'image/png' ? 'png' : 'jpg'
    const path = await toolbox.pickSaveFile({
      defaultName: `长图.${ext}`,
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
    <section class="panel settings">
      <div class="row">
        <span class="row__label">方向</span>
        <div class="seg">
          <button type="button" class="segbtn" :class="{ 'segbtn--on': direction === 'v' }" @click="direction = 'v'">纵向长图</button>
          <button type="button" class="segbtn" :class="{ 'segbtn--on': direction === 'h' }" @click="direction = 'h'">横向长图</button>
        </div>
        <span class="unit">按顺序首尾相接</span>
      </div>
      <div class="row">
        <span class="row__label">尺寸</span>
        <div class="seg">
          <button type="button" class="segbtn" :class="{ 'segbtn--on': sizeMode === 'widest' }" @click="sizeMode = 'widest'">
            {{ direction === 'v' ? '按最宽图片' : '按最高图片' }}
          </button>
          <button type="button" class="segbtn" :class="{ 'segbtn--on': sizeMode === 'custom' }" @click="sizeMode = 'custom'">自定义</button>
        </div>
        <input v-if="sizeMode === 'custom'" v-model.number="customSize" type="number" min="64" class="input input--num" />
        <span v-if="sizeMode === 'custom'" class="unit">px</span>
      </div>
      <div class="row">
        <span class="row__label">对齐</span>
        <div class="seg">
          <button type="button" class="segbtn" :class="{ 'segbtn--on': align === 'fit' }" @click="align = 'fit'">缩放对齐</button>
          <button type="button" class="segbtn" :class="{ 'segbtn--on': align === 'center' }" @click="align = 'center'">原尺寸居中</button>
        </div>
        <span class="unit">{{ align === 'fit' ? '全部等比缩放到统一宽高' : '宽图缩小、窄图原尺寸居中' }}</span>
      </div>
      <div class="row">
        <span class="row__label">间距 {{ gap }}px</span>
        <input v-model.number="gap" type="range" min="0" max="48" class="grow" />
        <span class="row__label">边距 {{ margin }}px</span>
        <input v-model.number="margin" type="range" min="0" max="60" class="grow" />
      </div>
      <div class="row">
        <label class="check">背景 <input v-model="bgColor" type="color" class="color" :disabled="transparent" /></label>
        <label v-if="outFormat === 'image/png'" class="check"><input v-model="transparent" type="checkbox" /> 透明背景</label>
      </div>
      <div class="row">
        <span class="row__label">输出格式</span>
        <div class="seg">
          <button type="button" class="segbtn" :class="{ 'segbtn--on': outFormat === 'image/png' }" @click="outFormat = 'image/png'">PNG（无损）</button>
          <button type="button" class="segbtn" :class="{ 'segbtn--on': outFormat === 'image/jpeg' }" @click="outFormat = 'image/jpeg'">JPEG（更小）</button>
        </div>
        <label v-if="outFormat === 'image/jpeg'" class="check">质量 {{ quality }}% <input v-model.number="quality" type="range" min="50" max="100" step="5" class="qslider" /></label>
      </div>
      <p v-if="layout" class="muted">
        预计输出：{{ layout.W }} × {{ layout.H }} px
        <span v-if="rawLayout && Math.max(rawLayout.W, rawLayout.H) > 8192">（超出 8192px，已整体等比缩小）</span>
      </p>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="button" class="btn btn--primary run" :disabled="saving || !layout || layout.cells.length < 1" @click="save">
        <span v-if="saving" class="spinner" />
        {{ saving ? '正在生成…' : '生成并保存长图' }}
      </button>
    </section>

    <section class="panel preview">
      <p class="sectitle">实时预览</p>
      <div class="preview__box">
        <canvas v-show="layout" ref="cv" class="preview__cv" />
        <p v-if="!layout" class="muted">加入图片后显示预览</p>
      </div>
      <p v-if="notice" class="muted">{{ notice }}</p>
    </section>
  </div>
</template>

<style scoped>
.wrap { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-start; }
.panel { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 14px 16px; }
.settings { flex: 1 1 360px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.preview { flex: 0 1 360px; display: flex; flex-direction: column; gap: 8px; position: sticky; top: 0; }
.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.row__label { font-size: 13px; font-weight: 600; min-width: 84px; }
.grow { flex: 1; min-width: 90px; }
.check { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
.color { width: 34px; height: 28px; border: 1px solid var(--c-border); border-radius: 6px; background: none; padding: 0; }
.color:disabled { opacity: 0.4; }
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
.error { margin: 0; font-size: 12.5px; color: var(--c-danger); }
.sectitle { margin: 0; font-size: 12px; font-weight: 700; color: var(--c-text-muted); }
.preview__box { min-height: 200px; display: flex; align-items: flex-start; justify-content: center; overflow: auto; }
.preview__cv { max-width: 100%; border: 1px solid var(--c-border); border-radius: 8px; background: repeating-conic-gradient(#f1f5f9 0 25%, #ffffff 0 50%) 0 0 / 16px 16px; }
</style>
