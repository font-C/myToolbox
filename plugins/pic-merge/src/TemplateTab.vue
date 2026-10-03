<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { toolbox } from '@toolbox/plugin-sdk'
import { imgStore, shuffleItems } from './images.js'
import { useLoadedImages, debounce, canvasToBytes } from './useLoadedImages.js'
import { TEMPLATES, filterTemplates, customGridTemplate } from './templates.js'
import { renderTemplate } from './collage.js'
import TemplateThumb from './TemplateThumb.vue'

const FILTERS = [
  { id: '', label: '全部' },
  { id: '2', label: '2' },
  { id: '3', label: '3' },
  { id: '4', label: '4' },
  { id: '5', label: '5' },
  { id: '6', label: '6' },
  { id: 'more', label: '更多' },
  { id: 'custom', label: '自定义' },
  { id: 'shape', label: '异形' },
]

const filter = ref('')
const tplId = ref('g4')
const customRows = ref(3)
const customCols = ref(3)
const gap = ref(10)
const margin = ref(16)
const radius = ref(0)
const fit = ref('cover') // cover | contain
const bgColor = ref('#ffffff')
const transparent = ref(false)
const outFormat = ref('image/png')
const quality = ref(90)
const outLong = ref(2048)

const saving = ref(false)
const error = ref('')
const notice = ref('')
const cv = ref(null)

const imgs = useLoadedImages()

const list = computed(() => filterTemplates(filter.value))
const tpl = computed(() => {
  if (filter.value === 'custom') return customGridTemplate(customRows.value, customCols.value)
  return TEMPLATES.find((t) => t.id === tplId.value) || TEMPLATES[0]
})

watch(filter, (f) => {
  if (f === 'custom') return
  const first = filterTemplates(f)[0]
  if (first) tplId.value = first.id
})

const need = computed(() => tpl.value.cells.length)
const have = computed(() => imgs.value.length)
const usage = computed(() => {
  if (!have.value) return ''
  if (have.value > need.value) return `模板需 ${need.value} 张，将使用前 ${need.value} 张（共 ${have.value} 张）`
  if (have.value < need.value) return `模板需 ${need.value} 张，剩余 ${need.value - have.value} 格将留空`
  return `已填满 ${need.value} 格`
})

function randomLayout() {
  const pool = filter.value === 'custom' ? TEMPLATES : list.value
  if (!pool.length) return
  tplId.value = pool[Math.floor(Math.random() * pool.length)].id
  if (filter.value === 'custom') filter.value = ''
}

const previewBox = { w: 340, h: 400 }
function renderPreview() {
  const el = cv.value
  const t = tpl.value
  if (!el || !t) return
  const aspect = t.aspect || 1
  let W
  let H
  if (aspect >= 1) {
    W = previewBox.w
    H = Math.round(W / aspect)
    if (H > previewBox.h) {
      H = previewBox.h
      W = Math.round(H * aspect)
    }
  } else {
    H = previewBox.h
    W = Math.round(H * aspect)
    if (W > previewBox.w) {
      W = previewBox.w
      H = Math.round(W / aspect)
    }
  }
  const dpr = window.devicePixelRatio || 1
  el.width = Math.round(W * dpr)
  el.height = Math.round(H * dpr)
  el.style.width = `${W}px`
  el.style.height = `${H}px`
  renderTemplate(el, t, imgs.value, {
    gap: gap.value,
    margin: margin.value,
    radius: radius.value,
    fit: fit.value,
    bg: bgColor.value,
    transparent: outFormat.value === 'image/png' && transparent.value,
    previewEmpty: true,
  })
}
const scheduleRender = debounce(renderPreview, 120)
watch([tpl, imgs, gap, margin, radius, fit, bgColor, transparent, outFormat], scheduleRender, { deep: true })
onMounted(renderPreview)

async function save() {
  const t = tpl.value
  if (!t || saving.value) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const long = outLong.value
    const W = t.aspect >= 1 ? long : Math.round(long * t.aspect)
    const H = t.aspect >= 1 ? Math.round(long / t.aspect) : long
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    renderTemplate(canvas, t, imgs.value, {
      gap: gap.value,
      margin: margin.value,
      radius: radius.value,
      fit: fit.value,
      bg: bgColor.value,
      transparent: outFormat.value === 'image/png' && transparent.value,
    })
    const bytes = await canvasToBytes(canvas, outFormat.value, quality.value)
    const ext = outFormat.value === 'image/png' ? 'png' : 'jpg'
    const path = await toolbox.pickSaveFile({
      defaultName: `拼图.${ext}`,
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
    <section class="panel picker">
      <div class="chips">
        <button
          v-for="f in FILTERS"
          :key="f.id"
          type="button"
          class="chip"
          :class="{ 'chip--on': filter === f.id }"
          @click="filter = f.id"
        >
          {{ f.label }}
        </button>
      </div>

      <div v-if="filter === 'custom'" class="customrow">
        <span class="row__label">行列</span>
        <div class="stepper">
          <button type="button" @click="customRows = Math.max(1, customRows - 1)">−</button>
          <b>{{ customRows }}</b>
          <button type="button" @click="customRows = Math.min(6, customRows + 1)">＋</button>
        </div>
        <span class="unit">×</span>
        <div class="stepper">
          <button type="button" @click="customCols = Math.max(1, customCols - 1)">−</button>
          <b>{{ customCols }}</b>
          <button type="button" @click="customCols = Math.min(8, customCols + 1)">＋</button>
        </div>
        <span class="unit">宫格 · 共 {{ customRows * customCols }} 格</span>
      </div>

      <div v-else class="tplgrid">
        <button
          v-for="t in list"
          :key="t.id"
          type="button"
          class="tpl"
          :class="{ 'tpl--on': t.id === tpl.id }"
          :title="`${t.name} · ${t.cells.length} 格`"
          @click="tplId = t.id"
        >
          <TemplateThumb :tpl="t" />
          <span class="tpl__name">{{ t.name }}</span>
          <span class="tpl__count">{{ t.cells.length }}格</span>
        </button>
      </div>

      <div class="row">
        <span class="row__label">间距 {{ gap }}px</span>
        <input v-model.number="gap" type="range" min="0" max="40" class="grow" />
        <span class="row__label">边距 {{ margin }}px</span>
        <input v-model.number="margin" type="range" min="0" max="60" class="grow" />
        <span class="row__label">圆角 {{ radius }}px</span>
        <input v-model.number="radius" type="range" min="0" max="60" class="grow" />
      </div>
      <div class="row">
        <span class="row__label">填充</span>
        <div class="seg">
          <button type="button" class="segbtn" :class="{ 'segbtn--on': fit === 'cover' }" @click="fit = 'cover'">裁剪填满</button>
          <button type="button" class="segbtn" :class="{ 'segbtn--on': fit === 'contain' }" @click="fit = 'contain'">完整显示</button>
        </div>
        <label class="check">背景 <input v-model="bgColor" type="color" class="color" :disabled="transparent" /></label>
        <label v-if="outFormat === 'image/png'" class="check"><input v-model="transparent" type="checkbox" /> 透明背景</label>
        <button type="button" class="mini" title="打乱图片顺序" @click="shuffleItems">🎲 随机顺序</button>
      </div>
      <div class="row">
        <span class="row__label">输出</span>
        <div class="seg">
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
        <span class="unit">长边</span>
      </div>
      <div class="row">
        <span class="row__label">输出格式</span>
        <div class="seg">
          <button type="button" class="segbtn" :class="{ 'segbtn--on': outFormat === 'image/png' }" @click="outFormat = 'image/png'">PNG（无损）</button>
          <button type="button" class="segbtn" :class="{ 'segbtn--on': outFormat === 'image/jpeg' }" @click="outFormat = 'image/jpeg'">JPEG（更小）</button>
        </div>
        <label v-if="outFormat === 'image/jpeg'" class="check">质量 {{ quality }}% <input v-model.number="quality" type="range" min="50" max="100" step="5" class="qslider" /></label>
      </div>
      <p v-if="usage" class="muted">{{ usage }}</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section class="panel preview">
      <div class="preview__head">
        <p class="sectitle">实时预览 · {{ tpl.name }}</p>
        <button type="button" class="mini" @click="randomLayout">🎲 随机切换布局</button>
      </div>
      <div class="preview__box">
        <canvas ref="cv" class="preview__cv" />
      </div>
      <p class="muted">输出 {{ tpl.aspect >= 1 ? outLong : Math.round(outLong * tpl.aspect) }} × {{ tpl.aspect >= 1 ? Math.round(outLong / tpl.aspect) : outLong }} px</p>
      <p v-if="notice" class="muted">{{ notice }}</p>
      <button type="button" class="btn btn--primary run" :disabled="saving || !have" @click="save">
        <span v-if="saving" class="spinner" />
        {{ saving ? '正在生成…' : '生成并保存拼图' }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.wrap { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-start; }
.panel { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 14px 16px; }
.picker { flex: 1 1 380px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.preview { flex: 0 1 380px; display: flex; flex-direction: column; gap: 8px; position: sticky; top: 0; }
.preview__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.preview__box { min-height: 220px; display: flex; align-items: flex-start; justify-content: center; overflow: auto; }
.preview__cv { max-width: 100%; border: 1px solid var(--c-border); border-radius: 8px; background: repeating-conic-gradient(#f1f5f9 0 25%, #ffffff 0 50%) 0 0 / 16px 16px; }

.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { border: 1px solid var(--c-border); background: var(--c-bg); color: var(--c-text-muted); border-radius: 16px; font-size: 12.5px; padding: 4px 14px; cursor: pointer; }
.chip--on { background: var(--c-primary); border-color: var(--c-primary); color: #fff; }

.tplgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(86px, 1fr)); gap: 8px; max-height: 300px; overflow-y: auto; padding: 2px; }
.tpl { border: 1.5px solid var(--c-border); background: var(--c-bg); border-radius: 10px; padding: 8px 4px 6px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.tpl:hover { border-color: var(--c-primary); }
.tpl--on { border-color: var(--c-primary); background: rgba(59, 130, 246, 0.07); }
.tpl__name { font-size: 11.5px; color: var(--c-text); }
.tpl__count { font-size: 10px; color: var(--c-text-muted); }

.customrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.stepper { display: flex; align-items: center; gap: 8px; background: var(--c-bg); border-radius: 8px; padding: 3px 6px; }
.stepper b { min-width: 20px; text-align: center; font-size: 14px; }
.stepper button { border: none; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 6px; width: 24px; height: 24px; cursor: pointer; font-size: 13px; }

.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.row__label { font-size: 13px; font-weight: 600; }
.grow { flex: 1; min-width: 80px; }
.check { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
.color { width: 34px; height: 28px; border: 1px solid var(--c-border); border-radius: 6px; background: none; padding: 0; }
.color:disabled { opacity: 0.4; }
.qslider { width: 110px; }
.seg { display: flex; gap: 4px; background: var(--c-bg); border-radius: 8px; padding: 3px; flex-wrap: wrap; }
.segbtn { border: none; background: transparent; padding: 5px 11px; font-size: 12.5px; border-radius: 6px; cursor: pointer; color: var(--c-text-muted); }
.segbtn--on { background: var(--c-primary); color: #fff; }
.unit { font-size: 12px; color: var(--c-text-muted); }
.mini { border: 1px solid var(--c-border); background: var(--c-bg); color: var(--c-text-muted); border-radius: 6px; font-size: 12px; padding: 5px 10px; cursor: pointer; }
.mini:hover { color: var(--c-primary); border-color: var(--c-primary); }
.run { justify-content: center; padding: 12px; }
.muted { margin: 0; font-size: 12.5px; color: var(--c-text-muted); }
.error { margin: 0; font-size: 12.5px; color: var(--c-danger); }
.sectitle { margin: 0; font-size: 12px; font-weight: 700; color: var(--c-text-muted); }
</style>
