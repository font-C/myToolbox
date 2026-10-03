<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { toolbox, isTauri } from '@toolbox/plugin-sdk'
import { generatePapers, validateOptions } from './mentalMath.js'
import {
  A4,
  PX,
  LAYOUT,
  rowHeight,
  paginate,
  paginateAnswers,
  answerText,
  renderHeaderPng,
  renderAnswerHeaderPng,
  buildWorksheetPdf,
} from './worksheet.js'

// —— 题卡配置（题目参数与口算练习一致，另加版面项）——
const wConfig = reactive({
  ops: ['+', '-', '*', '/'],
  lo: 1,
  hi: 20,
  resultMin: 1,
  resultMax: 100,
  count: 50,
  mixed: false,
  division: 'exact',
  cols: 4,
  withAnswers: false,
})

const OP_LABELS = {
  '+': '加法',
  '-': '减法',
  '*': '乘法',
  '/': '除法',
}

const hasDivision = computed(() => wConfig.ops.includes('/'))

// —— 预览状态 ——
const sheetItems = ref([])
const headerPng = ref(null)
const ansHeaderPng = ref(null)
const showPreview = ref(false)
const working = ref(false)
const note = ref('')

const pageChunks = computed(() => paginate(sheetItems.value, wConfig.cols))
const ansChunks = computed(() =>
  wConfig.withAnswers ? paginateAnswers(sheetItems.value, wConfig.cols) : []
)
const totalPages = computed(() => pageChunks.value.length + ansChunks.value.length)

/** 某页之前累计的题目数（用于跨页连续编号） */
function pageOffset(pi) {
  return pageChunks.value.slice(0, pi).reduce((n, p) => n + p.length, 0)
}
/** 答案页编号与题号一一对应，从 1 起 */
function ansOffset(pi) {
  return ansChunks.value.slice(0, pi).reduce((n, p) => n + p.length, 0)
}

function toggleOp(code) {
  const i = wConfig.ops.indexOf(code)
  if (i >= 0) wConfig.ops.splice(i, 1)
  else wConfig.ops.push(code)
}

/** 生成一批题目并进入预览（每次调用都是新的一批，即「换一批」） */
function genSheet() {
  const err = validateOptions(wConfig)
  if (err) {
    alert(err)
    return
  }
  if (wConfig.count < 1 || wConfig.count > 500) {
    alert('题目数量需在 1 ~ 500 之间。')
    return
  }
  const items = generatePapers(
    {
      ops: wConfig.ops.slice(),
      lo: wConfig.lo,
      hi: wConfig.hi,
      resultMin: wConfig.resultMin,
      resultMax: wConfig.resultMax,
      mixed: wConfig.mixed,
      division: wConfig.division,
    },
    wConfig.count
  )
  if (!items.length) {
    alert('当前范围配置下无法生成题目，请调整数字范围或结果范围后重试。')
    return
  }
  sheetItems.value = items
  headerPng.value = renderHeaderPng()
  ansHeaderPng.value = wConfig.withAnswers ? renderAnswerHeaderPng(items.length) : null
  note.value = ''
  showPreview.value = true
}

function toConfig() {
  showPreview.value = false
}

// —— 预览缩放：整张 A4（794×1123px）按容器宽度等比缩放 ——
const SHEET_W = A4.w * PX
const SHEET_H = A4.h * PX
const wrapEl = ref(null)
const scale = ref(1)
let ro = null

// —— 题卡配置持久化（宿主 storage）：重启后保留 ——
const WS_CONFIG_KEY = 'worksheetConfig'
let wsHydrated = false

onMounted(async () => {
  attachScale()
  try {
    const saved = await toolbox.storageGet(WS_CONFIG_KEY)
    if (saved && typeof saved === 'object') {
      if (Array.isArray(saved.ops) && saved.ops.length) {
        wConfig.ops = saved.ops.filter((o) => ['+', '-', '*', '/'].includes(o))
      }
      for (const k of ['lo', 'hi', 'resultMin', 'resultMax', 'count']) {
        if (Number.isFinite(saved[k]) && saved[k] > 0) wConfig[k] = saved[k]
      }
      if (typeof saved.mixed === 'boolean') wConfig.mixed = saved.mixed
      if (saved.division === 'exact' || saved.division === 'remainder') wConfig.division = saved.division
      if ([2, 3, 4, 5].includes(saved.cols)) wConfig.cols = saved.cols
      if (typeof saved.withAnswers === 'boolean') wConfig.withAnswers = saved.withAnswers
    }
  } catch {}
  wsHydrated = true
})
onBeforeUnmount(() => ro?.disconnect())

watch(wConfig, () => {
  if (!wsHydrated) return
  toolbox.storageSet(WS_CONFIG_KEY, { ...wConfig, ops: [...wConfig.ops] }).catch(() => {})
})

// 预览区由 v-if 渲染：进入预览后 wrapEl 才存在，需（重新）挂观察器
watch(showPreview, async (v) => {
  if (v) {
    await nextTick()
    attachScale()
  }
})

function attachScale() {
  ro?.disconnect()
  if (wrapEl.value) {
    ro ??= new ResizeObserver(updateScale)
    ro.observe(wrapEl.value)
  }
  updateScale()
}

function updateScale() {
  const w = wrapEl.value?.clientWidth ?? 0
  if (w > 0) scale.value = Math.min(1, (w - 4) / SHEET_W)
}

const pt = (v) => `${v * PX}px`

// —— 打印 / 保存 ——
async function buildPdfBytes() {
  return buildWorksheetPdf(sheetItems.value, {
    cols: wConfig.cols,
    withAnswers: wConfig.withAnswers,
  })
}

async function printSheet() {
  working.value = true
  try {
    if (isTauri()) {
      await toolbox.printPdf(await buildPdfBytes(), { name: '口算题卡' })
    } else {
      printViaBrowser()
    }
  } catch (e) {
    alert(`打印失败：${e?.message ?? e}`)
  } finally {
    working.value = false
  }
}

async function savePdf() {
  working.value = true
  try {
    const bytes = await buildPdfBytes()
    if (isTauri()) {
      const path = await toolbox.pickSaveFile({
        defaultName: '口算题卡.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        bytes,
      })
      if (path) note.value = `已保存：${path}`
    } else {
      browserDownload(bytes, '口算题卡.pdf')
      note.value = '已下载 口算题卡.pdf'
    }
  } catch (e) {
    alert(`保存失败：${e?.message ?? e}`)
  } finally {
    working.value = false
  }
}

/** 浏览器兜底下载 */
function browserDownload(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 浏览器兜底打印：克隆题卡页为打印层后 window.print（与 PDF 版式同源） */
function printViaBrowser() {
  document.getElementById('print-root')?.remove()
  if (!document.getElementById('print-root-style')) {
    const st = document.createElement('style')
    st.id = 'print-root-style'
    st.textContent = `
      body.print-active > :not(#print-root){display:none !important}
      #print-root{margin:0;padding:0;background:#fff}
      #print-root .pv__frame{width:auto !important;height:auto !important}
      #print-root .sheet{transform:none !important;width:210mm;height:297mm;margin:0;box-shadow:none;border-radius:0}
      #print-root .sheet:last-child{page-break-after:auto}
      #print-root .sheet{page-break-after:always}
      @media print{@page{size:A4 portrait;margin:0}}
    `
    document.head.appendChild(st)
  }
  const root = document.createElement('div')
  root.id = 'print-root'
  document.querySelectorAll('.sheet').forEach((n) => root.appendChild(n.cloneNode(true)))
  document.body.classList.add('print-active')
  document.body.appendChild(root)
  const finish = () => {
    window.removeEventListener('afterprint', finish)
    document.body.classList.remove('print-active')
    root.remove()
  }
  window.addEventListener('afterprint', finish)
  window.print()
  finish()
}
</script>

<template>
  <div class="ws">
    <!-- 配置区 -->
    <section v-if="!showPreview" class="panel wscfg">
      <h2 class="config__title">口算题卡（A4 打印）</h2>

      <div class="config__group">
        <span class="config__label">运算类型（可多选）</span>
        <div class="config__ops">
          <label
            v-for="(label, code) in OP_LABELS"
            :key="code"
            class="config__op"
            :class="{ 'config__op--on': wConfig.ops.includes(code) }"
          >
            <input
              type="checkbox"
              :checked="wConfig.ops.includes(code)"
              @change="toggleOp(code)"
            />
            {{ label }}
          </label>
        </div>
      </div>

      <div class="config__group">
        <span class="config__label">待计算的数字范围</span>
        <div class="config__range">
          <input v-model.number="wConfig.lo" type="number" class="input" />
          <span>至</span>
          <input v-model.number="wConfig.hi" type="number" class="input" />
        </div>
      </div>

      <div class="config__group">
        <span class="config__label">结果的范围</span>
        <div class="config__range">
          <input v-model.number="wConfig.resultMin" type="number" class="input" />
          <span>至</span>
          <input v-model.number="wConfig.resultMax" type="number" class="input" />
        </div>
      </div>

      <div class="config__group">
        <span class="config__label">除法结果</span>
        <div class="config__ops">
          <label
            class="config__op"
            :class="{ 'config__op--on': wConfig.division === 'exact' }"
            :style="{ opacity: !hasDivision ? 0.5 : 1 }"
          >
            <input
              type="radio"
              value="exact"
              v-model="wConfig.division"
              :disabled="!hasDivision"
            />
            整除
          </label>
          <label
            class="config__op"
            :class="{ 'config__op--on': wConfig.division === 'remainder' }"
            :style="{ opacity: !hasDivision ? 0.5 : 1 }"
          >
            <input
              type="radio"
              value="remainder"
              v-model="wConfig.division"
              :disabled="!hasDivision"
            />
            有余数
          </label>
        </div>
      </div>

      <label class="config__switch">
        <input v-model="wConfig.mixed" type="checkbox" />
        <span class="config__switch__text">混合运算（如 1 + 3 × 2、（9 − 5）÷ 2）</span>
      </label>

      <div class="wscfg__row">
        <div class="config__group wscfg__count">
          <span class="config__label">题目数量</span>
          <input
            v-model.number="wConfig.count"
            type="number"
            class="input input--sm"
            min="1"
            max="500"
          />
        </div>
        <div class="config__group">
          <span class="config__label">每行列数</span>
          <div class="config__ops">
            <label
              v-for="n in [2, 3, 4]"
              :key="n"
              class="config__op"
              :class="{ 'config__op--on': wConfig.cols === n }"
            >
              <input v-model.number="wConfig.cols" type="radio" :value="n" />
              {{ n }} 列
            </label>
          </div>
        </div>
      </div>

      <label class="config__switch">
        <input v-model="wConfig.withAnswers" type="checkbox" />
        <span class="config__switch__text">末尾附带参考答案页</span>
      </label>

      <button type="button" class="btn btn--primary config__submit" @click="genSheet">
        生成题卡
      </button>
    </section>

    <!-- 预览区 -->
    <section v-else class="pvw">
      <div class="pvw__bar">
        <span class="pvw__meta">
          共 {{ sheetItems.length }} 题 · {{ totalPages }} 页（A4）
          <template v-if="wConfig.withAnswers"> · 含答案页</template>
        </span>
        <span v-if="note" class="pvw__note" v-text="note" />
        <span class="pvw__spacer" />
        <button
          type="button"
          class="btn"
          :disabled="working"
          @click="genSheet"
        >
          换一批
        </button>
        <button type="button" class="btn" @click="toConfig">调整配置</button>
        <button type="button" class="btn" :disabled="working" @click="savePdf">
          保存 PDF
        </button>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="working"
          @click="printSheet"
        >
          {{ working ? '处理中…' : '🖨 打印' }}
        </button>
      </div>

      <div ref="wrapEl" class="pvw__scroll">
        <div class="pvw__stack" :style="{ width: `${SHEET_W * scale}px` }">
          <div
            v-for="(chunk, pi) in pageChunks"
            :key="`p${pi}`"
            class="pvw__frame"
            :style="{
              width: `${SHEET_W * scale}px`,
              height: `${SHEET_H * scale}px`,
            }"
          >
            <div class="sheet" :style="{ transform: `scale(${scale})` }">
              <img
                v-if="pi === 0 && headerPng"
                class="sheet__header"
                :src="headerPng.dataUrl"
                :style="{
                  left: pt(LAYOUT.marginX),
                  top: pt(LAYOUT.marginTop),
                  width: pt(headerPng.wPt),
                  height: pt(headerPng.hPt),
                }"
                alt=""
              />
                <div
                  class="sheet__grid"
                  :style="{
                    left: pt(LAYOUT.marginX),
                    right: pt(LAYOUT.marginX),
                    top: pt(LAYOUT.marginTop + (pi === 0 ? LAYOUT.headerTotal : 0)),
                    gridTemplateColumns: `repeat(${wConfig.cols}, 1fr)`,
                    gridAutoRows: pt(rowHeight(wConfig.cols)),
                  }"
                >
                <div v-for="(it, i) in chunk" :key="i" class="cell">
                  <span
                    class="cell__no"
                    :style="{ width: pt(LAYOUT.numW), fontSize: pt(LAYOUT.numFontSize) }"
                    v-text="`${pageOffset(pi) + i + 1}.`"
                  />
                  <span
                    class="cell__q"
                    :style="{ fontSize: pt(LAYOUT.fontSize) }"
                    v-text="`${it.text} =`"
                  />
                  <span
                    class="cell__line"
                    :style="{
                      marginLeft: pt(8),
                      minWidth: pt(20),
                      maxWidth: pt(44),
                    }"
                  />
                </div>
              </div>
              <div
                class="sheet__footer"
                :style="{ fontSize: pt(LAYOUT.footerFontSize), bottom: pt(14) }"
                v-text="`${pi + 1} / ${totalPages}`"
              />
            </div>
          </div>

          <!-- 答案页 -->
          <template v-if="wConfig.withAnswers">
            <div
              v-for="(chunk, pi) in ansChunks"
              :key="`a${pi}`"
              class="pvw__frame"
              :style="{
                width: `${SHEET_W * scale}px`,
                height: `${SHEET_H * scale}px`,
              }"
            >
              <div class="sheet" :style="{ transform: `scale(${scale})` }">
                <img
                  v-if="pi === 0 && ansHeaderPng"
                  class="sheet__header"
                  :src="ansHeaderPng.dataUrl"
                  :style="{
                    left: pt(LAYOUT.marginX),
                    top: pt(LAYOUT.marginTop),
                    width: pt(ansHeaderPng.wPt),
                    height: pt(ansHeaderPng.hPt),
                  }"
                  alt=""
                />
                <div
                  class="sheet__grid"
                  :style="{
                    left: pt(LAYOUT.marginX),
                    right: pt(LAYOUT.marginX),
                    top: pt(LAYOUT.marginTop + (pi === 0 ? LAYOUT.ansHeaderTotal : 0)),
                    gridTemplateColumns: `repeat(${wConfig.cols}, 1fr)`,
                    gridAutoRows: pt(LAYOUT.ansRowH),
                  }"
                >
                  <div
                    v-for="(it, i) in chunk"
                    :key="i"
                    class="cell cell--ans"
                    :style="{ fontSize: pt(LAYOUT.ansFontSize) }"
                    v-text="`${ansOffset(pi) + i + 1}. ${answerText(it)}`"
                  />
                </div>
                <div
                  class="sheet__footer"
                  :style="{ fontSize: pt(LAYOUT.footerFontSize), bottom: pt(14) }"
                  v-text="`${pageChunks.length + pi + 1} / ${totalPages}`"
                />
              </div>
            </div>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ws {
  width: 100%;
  margin-top: 24px;
}

/* 题目正文用与 PDF 一致的 Helvetica 系 */
.sheet,
.cell {
  font-family: Helvetica, Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.wscfg {
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
}
.wscfg__row {
  display: flex;
  gap: 24px;
  align-items: flex-end;
}
.wscfg__count {
  margin-bottom: 16px;
}

/* 预览 */
.pvw {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}
.pvw__bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: var(--c-bg);
  /* 通栏铺满窗口宽度，吸顶时左右不留缝 */
  margin: 0 -24px;
  padding: 10px 24px 8px;
  border-bottom: 1px solid var(--c-border);
}
.pvw__meta {
  font-size: 13px;
  color: var(--c-text-muted);
}
.pvw__note {
  font-size: 13px;
  color: #16a34a;
}
.pvw__spacer {
  flex: 1;
}
.pvw__scroll {
  flex: 1;
  overflow: visible;
  min-height: 0;
}
.pvw__stack {
  margin: 0 auto;
  padding-bottom: 16px;
}
.pvw__frame {
  overflow: visible;
  margin-bottom: 16px;
}
.pvw__frame:last-child {
  margin-bottom: 0;
}

/* 题卡页：几何全部由 LAYOUT（pt）换算，与 PDF 同源 */
.sheet {
  position: relative;
  width: 793.7px;
  height: 1122.5px;
  background: #fff;
  transform-origin: top left;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
}
.sheet__header {
  position: absolute;
}
.sheet__grid {
  position: absolute;
  display: grid;
}
.cell {
  display: flex;
  align-items: center;
  min-width: 0;
}
.cell__no {
  flex: none;
  color: #8c8c8c;
}
.cell__q {
  flex: none;
  white-space: nowrap;
  color: #212121;
}
.cell__line {
  flex: 0 1 auto;
  border-bottom: 1px solid #333;
  height: 1px;
  align-self: center;
  margin-top: 6px;
}
.cell--ans {
  color: #212121;
  white-space: nowrap;
  overflow: hidden;
}
.sheet__footer {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  color: #8c8c8c;
}
</style>
