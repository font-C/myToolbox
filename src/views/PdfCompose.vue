<script setup>
import { ref, computed, onMounted, onUnmounted, onBeforeUnmount, watch } from 'vue'
import { useComposeStore } from '../stores/compose'
import ComposeUploader from '../components/ComposeUploader.vue'
import ComposePage from '../components/ComposePage.vue'
import ComposeToolbar from '../components/ComposeToolbar.vue'
import { downloadComposedPdf, printComposedPdf } from '../composables/useComposeExport'
import { COMPOSE_ACCEPT } from '../constants/pdf'

const store = useComposeStore()
const fileInput = ref(null)
const busy = ref(false)
const toast = ref('')
const toaster = ref(null)

// 标注工具：'select' | 'cover' | 'mosaic'
const tool = ref('select')
// 排序模式（点击「排序」后整体缩放、整页拖动排序）
const sortMode = ref(false)
// 当前选中页 id（决定 8 点控点显示在哪一页）
const activePageId = ref('')
// 选中目标（element 为元素，annotation 为标注）
const selectedKind = ref('')
const selectedId = ref('')

const loaded = computed(() => store.assets.length > 0 || store.pages.length > 0)
const canAnnotate = computed(() => loaded.value && !store.isEmpty)
// 当前选中的标注（供底部属性面板调整字体/字号/打码样式）
const selectedAnnotation = computed(() =>
  selectedId.value ? store.annotations.find((a) => a.id === selectedId.value) || null : null,
)
// 当前选中的元素（图片），用于剪切/复制
const selectedElement = computed(
  () => (selectedKind.value === 'element' && selectedId.value ? store.elements.find((e) => e.id === selectedId.value) || null : null),
)

// 鼠标指针（视口坐标），用于快捷键粘贴到鼠标所在位置
const mousePos = ref({ x: 0, y: 0 })
function onMouseMove(e) {
  mousePos.value = { x: e.clientX, y: e.clientY }
}

// 打码默认样式记忆：选中打码调整样式后，后续新建沿用
const selMosaic = computed(() =>
  selectedAnnotation.value && selectedAnnotation.value.type === 'mosaic' ? selectedAnnotation.value : null,
)
watch(
  () => selMosaic.value?.style,
  (v) => { if (v) store.defaultMosaic.style = v },
)
watch(
  () => selMosaic.value?.color,
  (v) => { if (v) store.defaultMosaic.color = v },
)

// 剪切/复制选中图片，随后点击任意页面画布粘贴到鼠标位置
function doCopyCut(cutting) {
  if (!selectedElement.value) return
  store.copyElement(selectedElement.value.id, cutting)
  notify(cutting ? '已剪切，点击目标页面粘贴' : '已复制，点击目标页面粘贴')
}

// 把剪贴板中的图片粘贴到鼠标所在位置（即使鼠标悬停在 PDF/图片上层也能贴到其上方）
function pasteAtMouse() {
  if (!store.copyBuffer) {
    notify('请先复制或剪切一张图片')
    return
  }
  const pos = mousePos.value
  let pageId = ''
  let point = { x: 0.5, y: 0.5 }
  // 找出光标所在的页面画布，换算归一化坐标
  const cards = Array.from(document.querySelectorAll('[data-page-id]'))
  for (const el of cards) {
    const r = el.getBoundingClientRect()
    if (pos.x >= r.left && pos.x <= r.right && pos.y >= r.top && pos.y <= r.bottom) {
      pageId = el.dataset.pageId
      point = {
        x: Math.min(Math.max((pos.x - r.left) / r.width, 0), 1),
        y: Math.min(Math.max((pos.y - r.top) / r.height, 0), 1),
      }
      break
    }
  }
  // 鼠标不在任何页面上时，落到当前激活页（或首页）的中心
  if (!pageId) pageId = activePageId.value || (store.pages[0] && store.pages[0].id)
  if (!pageId) return
  const el = store.pasteElementAt(pageId, point)
  if (!el) return
  store.copyBuffer = null
  tool.value = 'select'
  sortMode.value = false
  onSelect({ kind: 'element', id: el.id })
  notify('已粘贴')
}

function notify(msg) {
  toast.value = msg
  clearTimeout(toaster.value)
  toaster.value = setTimeout(() => {
    toast.value = ''
  }, 2600)
}

function onSelect({ kind, id }) {
  selectedKind.value = kind
  selectedId.value = id
  // 选中元素/标注时记录其所在页为当前页
  if (kind === 'element') {
    const el = store.elements.find((e) => e.id === id)
    if (el) activePageId.value = el.pageId
  } else if (kind === 'annotation') {
    const a = store.annotations.find((x) => x.id === id)
    if (a) activePageId.value = a.pageId
  }
}

// 点击某页空白：把该页置为当前页
function onPageActivate(pageId) {
  activePageId.value = pageId
}

function toggleSort() {
  sortMode.value = !sortMode.value
  sortFromId.value = ''
  dropBeforeId.value = ''
  // 退出排序时清空选中
  if (!sortMode.value) {
    selectedKind.value = ''
    selectedId.value = ''
  }
}

// —— 排序模式：自定义指针拖拽（WKWebView 对 HTML5 DnD 支持不稳，改用 mouse 补齐）——
// 被拖页以固定浮层跟随鼠标移动，目标前插入位显示高亮竖线。
const listWrapRef = ref(null)
const sortFromId = ref('') // 当前被拖动的页 id
const sortX = ref(0) // 被拖页浮层位置（视口坐标）
const sortY = ref(0)
const dragOffX = ref(0) // 按下点在被拖页内的偏移
const dragOffY = ref(0)
const dropBeforeId = ref('') // 目标页 id（其前方显示插入竖线）

function othersList() {
  return store.pages.filter((p) => p.id !== sortFromId.value).map((p) => p.id)
}
// 依据指针横向位置返回「others 数组（排除被拖页）」的插入下标；并更新目标页
function locateInsertIndex(clientX) {
  const id = sortFromId.value || ''
  const cards = Array.from(listWrapRef.value?.querySelectorAll('[data-page-id]') || [])
    .filter((el) => el.dataset.pageId !== id)
  dropBeforeId.value = ''
  if (cards.length === 0) return 0
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect()
    if (clientX < r.left + r.width / 2) {
      dropBeforeId.value = cards[i].dataset.pageId
      return i
    }
  }
  return cards.length // 末尾
}

function onSortPointerDown(e) {
  if (!sortMode.value || e.button !== 0) return
  const target = e.target.closest('[data-page-id]')
  if (!target) return
  e.preventDefault()
  sortFromId.value = target.dataset.pageId
  const r = target.getBoundingClientRect()
  dragOffX.value = e.clientX - r.left
  dragOffY.value = e.clientY - r.top
  sortX.value = e.clientX - dragOffX.value
  sortY.value = e.clientY - dragOffY.value
  locateInsertIndex(e.clientX)
  window.addEventListener('mousemove', onSortPointerMove)
  window.addEventListener('mouseup', onSortPointerUp)
}
function onSortPointerMove(e) {
  if (!sortFromId.value) return
  sortX.value = e.clientX - dragOffX.value
  sortY.value = e.clientY - dragOffY.value
  locateInsertIndex(e.clientX)
}
function onSortPointerUp() {
  window.removeEventListener('mousemove', onSortPointerMove)
  window.removeEventListener('mouseup', onSortPointerUp)
  const fromId = sortFromId.value
  // 先基于当前状态取出「除被拖页外的其余顺序」，再据此计算插入位
  const base = store.pages.filter((p) => p.id !== fromId).map((p) => p.id)
  let ti = dropBeforeId.value ? base.indexOf(dropBeforeId.value) : -1
  if (ti < 0) ti = base.length // 末尾
  sortFromId.value = ''
  dropBeforeId.value = ''
  if (!fromId) return
  base.splice(Math.min(ti, base.length), 0, fromId)
  store.reorderPages(base)
}
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onSortPointerMove)
  window.removeEventListener('mouseup', onSortPointerUp)
})

// —— 键盘快捷键（非输入框聚焦时生效）——
// Cmd/Ctrl+X 剪切、Cmd/Ctrl+C 复制选中图片；Cmd/Ctrl+V 准备粘贴；
// Delete/Backspace 删除选中目标。
function onKeydown(e) {
  const tag = (e.target.tagName || '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  const mod = e.metaKey || e.ctrlKey
  if (mod) {
    const k = e.key.toLowerCase()
    if (k === 'x') {
      e.preventDefault()
      doCopyCut(true)
    } else if (k === 'c') {
      e.preventDefault()
      doCopyCut(false)
    } else if (k === 'v') {
      e.preventDefault()
      pasteAtMouse()
    }
    return
  }
  if (e.key !== 'Delete' && e.key !== 'Backspace') return
  if (selectedKind.value === 'element' && selectedId.value) {
    store.removeElement(selectedId.value)
  } else if (selectedKind.value === 'annotation' && selectedId.value) {
    store.removeAnnotation(selectedId.value)
  } else {
    return
  }
  selectedKind.value = ''
  selectedId.value = ''
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('mousemove', onMouseMove)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('mousemove', onMouseMove)
})

// —— 跨页拖拽：接收 ComposePage 的 move-out，决定目标页并放置 ——
function onMoveOut({ id, direction }) {
  const el = store.elements.find((e) => e.id === id)
  if (!el) return
  const idx = store.pages.findIndex((p) => p.id === el.pageId)
  let targetId = ''
  let nx = el.x
  let ny = el.y
  if (direction === '__new__') {
    targetId = '__new__' // 新建页承接
    notify('已新建页承接')
  } else if (direction === 'up') {
    if (idx > 0) {
      targetId = store.pages[idx - 1].id // 上→前一页末尾
      ny = Math.max(0, 1 - el.h)
    } else {
      targetId = '__new__'
      notify('已新建页承接')
    }
  } else {
    // down
    if (idx >= 0 && idx < store.pages.length - 1) {
      targetId = store.pages[idx + 1].id // 下→后一页开头
      ny = 0
    } else {
      targetId = '__new__'
      notify('已新建页承接')
    }
  }
  store.moveElement(id, targetId, nx, ny)
}

function onDelete({ kind, id }) {
  if (kind === 'element') store.removeElement(id)
  else store.removeAnnotation(id)
  selectedKind.value = ''
  selectedId.value = ''
}

// —— 导入 / 添加文件 ——
async function handleImport(files) {
  try {
    await store.importFiles(files)
    if (store.errorMsg) notify(store.errorMsg)
  } catch {
    notify(store.errorMsg || '导入失败，请检查文件是否有效。')
  }
}

function openFilePicker() {
  fileInput.value?.click()
}

async function onInputChange(e) {
  await handleImport(e.target.files)
  if (fileInput.value) fileInput.value.value = ''
}

// —— 页操作 ——
function handleAddPage() {
  store.addPage()
}
function handleDeleteLastPage() {
  if (store.pages.length <= 1) {
    notify('至少保留一页')
    return
  }
  store.removePage(store.pages[store.pages.length - 1].id)
}
function handlePageSize({ width, height }) {
  for (const p of store.pages) store.setPageSize(p.id, width, height)
  notify('已应用页面尺寸')
}

// —— 打印 / 导出（Tauri 原生链路）——
async function handlePrint() {
  busy.value = true
  try {
    await printComposedPdf()
  } catch {
    notify('打印失败，请重试。')
  } finally {
    busy.value = false
  }
}
async function handleExport() {
  busy.value = true
  try {
    const ok = await downloadComposedPdf('document')
    notify(ok ? '已导出合并 PDF' : '导出已取消')
  } catch {
    notify('导出失败，请重试。')
  } finally {
    busy.value = false
  }
}

function handleClose() {
  store.reset()
  tool.value = 'select'
  selectedKind.value = ''
  selectedId.value = ''
  toast.value = ''
  clearTimeout(toaster.value)
}
</script>

<template>
  <div class="compose">
    <header class="compose__header">
      <div class="compose__header-actions">
        <span v-if="loaded" class="compose__filename">已导入 {{ store.assets.length }} 个资源</span>
        <button v-if="loaded" type="button" class="btn" @click="openFilePicker">添加文件</button>
        <button v-if="loaded" type="button" class="btn compose__close" @click="handleClose">关闭</button>
      </div>
    </header>

    <main class="compose__main">
      <!-- 空态：上传区 -->
      <div v-if="!loaded && !store.loading" class="compose__uploader-wrap">
        <ComposeUploader @files="handleImport" />
      </div>

      <!-- 加载中 -->
      <div v-if="store.loading" class="compose__loading">
        <div class="spinner"></div>
        <p>正在解析文件…</p>
      </div>

      <!-- 已加载：输出页列表 + 标注工具 + 工具栏 -->
      <template v-else-if="loaded">
        <div class="compose__tools">
          <div class="compose__tools-inner">
          <!-- 选中标注时的属性面板（工具栏左侧，不打折整行） -->
          <div v-if="selectedAnnotation && !sortMode" class="compose__anno-panel">
            <template v-if="selectedAnnotation.type === 'cover'">
              <label class="compose__anno-field">
                字体
                <select v-model="selectedAnnotation.fontFamily">
                  <option value="sans-serif">无衬线</option>
                  <option value="serif">衬线</option>
                  <option value="monospace">等宽</option>
                  <option value="cursive">手写</option>
                  <option value="'SimHei', 'Heiti SC', sans-serif">黑体</option>
                  <option value="'SimSun', 'Songti SC', serif">宋体</option>
                  <option value="'KaiTi', 'Kaiti SC', serif">楷体</option>
                  <option value="'Georgia', serif">Georgia</option>
                  <option value="'Impact', fantasy">Impact</option>
                </select>
              </label>
              <label class="compose__anno-field">
                字号
                <input v-model.number="selectedAnnotation.fontSize" type="number" min="6" max="120" />
              </label>
              <label class="compose__anno-field">
                颜色
                <input v-model="selectedAnnotation.color" type="color" />
              </label>
              <label class="compose__anno-field">
                横对齐
                <select v-model="selectedAnnotation.alignH">
                  <option value="left">左</option>
                  <option value="center">中</option>
                  <option value="right">右</option>
                </select>
              </label>
              <label class="compose__anno-field">
                纵对齐
                <select v-model="selectedAnnotation.alignV">
                  <option value="top">上</option>
                  <option value="middle">中</option>
                  <option value="bottom">下</option>
                </select>
              </label>
            </template>
            <template v-else>
              <label class="compose__anno-field">
                样式
                <select v-model="selectedAnnotation.style">
                  <option value="grid">灰白格</option>
                  <option value="solid">纯色</option>
                </select>
              </label>
              <label v-if="selectedAnnotation.style === 'solid'" class="compose__anno-field">
                颜色
                <input v-model="selectedAnnotation.color" type="color" />
              </label>
            </template>
          </div>

          <!-- 工具按钮（右侧）：选择 / 批注 / 打码 / 排序 -->
          <div class="compose__tools-actions">
            <button
              type="button"
              class="btn compose__tool compose__tool--icon"
              :class="{ 'compose__tool--active': tool === 'select' && !sortMode }"
              title="选择 / 移动"
              @click="tool = 'select'; sortMode = false"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l6 15 2.5-5.5L18 11z" stroke-linejoin="round"/></svg>
              <span>选择</span>
            </button>
            <button
              type="button"
              class="btn compose__tool compose__tool--icon"
              :class="{ 'compose__tool--active': tool === 'cover' }"
              :disabled="!canAnnotate || sortMode"
              title="批注"
              @click="tool = 'cover'; sortMode = false"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9" stroke-linecap="round"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" stroke-linejoin="round"/></svg>
              <span>批注</span>
            </button>
            <button
              type="button"
              class="btn compose__tool compose__tool--icon"
              :class="{ 'compose__tool--active': tool === 'mosaic' }"
              :disabled="!canAnnotate || sortMode"
              title="打码"
              @click="tool = 'mosaic'; sortMode = false"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg>
              <span>打码</span>
            </button>
            <button
              type="button"
              class="btn compose__tool compose__tool--icon"
              :class="{ 'compose__tool--active': sortMode }"
              title="排序"
              @click="toggleSort"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6l-3 3M8 6v11M8 6h8M16 18l3-3M16 18V7" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>排序</span>
            </button>
          </div>
          </div>
        </div>

        <div class="compose__list" :class="{ 'compose__list--sort': sortMode }" ref="listWrapRef" @mousedown="onSortPointerDown">
          <div
            v-for="(p, i) in store.pages"
            :key="p.id"
            class="compose__page-card"
            :class="{ 'is-dragging': p.id === sortFromId }"
            :style="p.id === sortFromId ? { position: 'fixed', left: sortX + 'px', top: sortY + 'px', zIndex: 20, opacity: 0.92, margin: 0, pointerEvents: 'none', boxShadow: '0 12px 30px rgba(15, 23, 42, 0.3)' } : null"
          >
            <div class="compose__page-head">
              <span class="compose__page-label">第 {{ i + 1 }} 页</span>
              <button
                v-if="store.pages.length > 1"
                type="button"
                class="compose__page-delete"
                @click="store.removePage(p.id)"
              >删除此页</button>
            </div>
            <ComposePage
              :page="p"
              :tool="tool"
              :selected-id="selectedId"
              :selected-kind="selectedKind"
              :active="activePageId === p.id"
              :sort="sortMode"
              :drop-before="p.id === dropBeforeId"
              @select="onSelect"
              @move-out="onMoveOut"
              @delete="onDelete"
            />
          </div>
        </div>

        <ComposeToolbar
          class="compose__toolbar"
          :busy="busy"
          :total-pages="store.totalPages"
          :element-count="store.elementCount"
          :is-empty="store.isEmpty"
          @add-page="handleAddPage"
          @delete-page="handleDeleteLastPage"
          @reset="handleClose"
          @print="handlePrint"
          @export="handleExport"
          @page-size="handlePageSize"
        />
      </template>
    </main>

    <input
      ref="fileInput"
      type="file"
      :accept="COMPOSE_ACCEPT"
      multiple
      style="display: none"
      @change="onInputChange"
    />

    <transition name="toast">
      <div v-if="toast" class="compose__toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.compose {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.compose__header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 24px;
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
  flex-wrap: wrap;
}

.compose__header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-left: auto;
}
.compose__filename {
  font-size: 13px;
  color: var(--c-text-muted);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.compose__close {
  color: var(--c-danger);
}

.compose__main {
  flex: 1;
  overflow: hidden; /* 滚动收敛到列表容器，保证面板与底栏固定不被遮挡 */
  display: flex;
  flex-direction: column;
}

.compose__uploader-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
}

.compose__loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--c-text-muted);
}

.compose__tools {
  position: sticky;
  top: 0;
  z-index: 5;
  padding: 12px 24px;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border);
}
/* 属性面板靠左、工具按钮靠右，同处一行 */
.compose__tools-inner {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}
.compose__tools-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  margin-left: auto;
}
.compose__tool--icon {
  padding: 8px 12px;
  white-space: nowrap;
}
.compose__tool--active {
  background: var(--c-primary);
  border-color: var(--c-primary);
  color: #fff;
}
.compose__tool--active:hover {
  color: #fff;
}

.compose__list {
  flex: 1;
  min-height: 0; /* 允许 flex 子项收缩，使列表内部滚动而不溢出遮挡底栏 */
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px;
}

/* 排序模式：横向排布页卡片，方便拖动到两页中间插入 */
.compose__list--sort {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 16px;
}
.compose__list--sort .compose__page-card {
  width: auto;
  flex: 0 0 auto;
}
.compose__list--sort .c-page {
  margin: 0;
}
.compose__anno-panel {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  padding: 6px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  max-width: 100%;
  overflow: hidden;
}
.compose__anno-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #334155;
}
.compose__anno-field select,
.compose__anno-field input[type='number'] {
  padding: 4px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
}
.compose__anno-field input[type='number'] {
  width: 72px;
}
.compose__anno-field input[type='color'] {
  width: 36px;
  height: 28px;
  padding: 0 2px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
.compose__list--sort .compose__page-card.is-dragging {
  will-change: transform, top, left;
  cursor: grabbing;
}
.compose__list--sort .compose__page-card.is-dragging .compose__page-head {
  display: none; /* 拖动浮层只含页面，不带页头/按钮 */
}

.compose__page-card {
  width: 100%;
}
.compose__page-head {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 820px;
  margin: 0 auto 6px;
}
.compose__page-label {
  font-weight: 600;
  font-size: 14px;
}
.compose__page-delete {
  font-size: 12px;
  color: var(--c-danger);
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 999px;
  padding: 2px 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.compose__page-delete:hover {
  background: rgba(239, 68, 68, 0.12);
}

.compose__toolbar {
  margin-top: auto;
}

.compose__toast {
  position: fixed;
  left: 50%;
  bottom: 90px;
  transform: translateX(-50%);
  background: #1e293b;
  color: #fff;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 14px;
  z-index: 200;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.3);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>