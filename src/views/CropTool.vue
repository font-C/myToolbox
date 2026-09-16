<script setup>
import { ref, computed } from 'vue'
import { usePdfStore } from '../stores/pdf'
import PdfUploader from '../components/PdfUploader.vue'
import Toolbar from '../components/Toolbar.vue'
import PageCard from '../components/PageCard.vue'
import { downloadCroppedPdf, printCroppedPdf } from '../composables/usePdfExport'

const store = usePdfStore()
const fileInput = ref(null)
const busy = ref(false)
const toast = ref('')
const toaster = ref(null)

const appliedCount = computed(
  () => Object.values(store.cropBoxes).filter((c) => c).length,
)

const loaded = computed(() => !!store.rawBuffer)

function notify(msg) {
  toast.value = msg
  clearTimeout(toaster.value)
  toaster.value = setTimeout(() => {
    toast.value = ''
  }, 2600)
}

async function handleFile(file) {
  await store.openFile(file)
  if (store.errorMsg) notify(store.errorMsg)
}

function openFilePicker() {
  fileInput.value?.click()
}

async function onInputChange(e) {
  const file = e.target.files?.[0]
  if (file) await handleFile(file)
  if (fileInput.value) fileInput.value.value = ''
}

function onInvalidFile() {
  notify('请选择 PDF 文件。')
}

async function handleExport() {
  busy.value = true
  try {
    const ok = await downloadCroppedPdf(
      store.rawBuffer,
      store.exportCropMap,
      store.pageInfos,
      store.fileName,
    )
    if (ok) notify('已导出裁剪后的 PDF。')
  } catch {
    notify('导出失败，请重试。')
  } finally {
    busy.value = false
  }
}

async function handlePrint() {
  busy.value = true
  try {
    await printCroppedPdf(store.rawBuffer, store.exportCropMap, store.pageInfos)
  } catch {
    notify('打印失败，请重试。')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="crop">
    <header class="crop__header">
      <div class="crop__brand">
        <span class="crop__logo">✂️</span>
        <h1 class="crop__title">PDF 裁剪工具</h1>
      </div>
      <div class="crop__header-actions">
        <span v-if="loaded" class="crop__filename">{{ store.fileName }}</span>
        <button v-if="loaded" type="button" class="btn" @click="openFilePicker">打开其他文件</button>
        <button v-if="loaded" type="button" class="btn crop__close" @click="store.reset()">关闭</button>
      </div>
    </header>

    <main class="crop__main">
      <!-- 空态：上传区 -->
      <div v-if="!loaded && !store.loading" class="crop__uploader-wrap">
        <PdfUploader @select="handleFile" @invalid="onInvalidFile" />
      </div>

      <!-- 加载中 -->
      <div v-if="store.loading" class="crop__loading">
        <div class="spinner"></div>
        <p>正在解析 PDF…</p>
      </div>

      <!-- 已加载：页面纵向大图列表 + 工具栏 -->
      <template v-else-if="loaded">
        <div class="crop__list">
          <PageCard
            v-for="p in store.pageInfos"
            :key="p.index"
            :page="p"
            :crop="store.cropBoxes[p.index] || null"
          />
        </div>
        <Toolbar
          class="crop__toolbar"
          :page-count="store.pageCount"
          :applied-count="appliedCount"
          :has-crops="store.hasCrops"
          :busy="busy"
          @apply-all="store.applyToAll(store.selectedPage)"
          @reset="store.resetCrops"
          @print="handlePrint"
          @export="handleExport"
        />
      </template>
    </main>

    <input
      ref="fileInput"
      type="file"
      accept=".pdf"
      style="display: none"
      @change="onInputChange"
    />

    <transition name="toast">
      <div v-if="toast" class="crop__toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.crop {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.crop__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
  flex-wrap: wrap;
}

.crop__brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.crop__logo {
  font-size: 22px;
}
.crop__title {
  margin: 0;
  font-size: 18px;
}

.crop__header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.crop__filename {
  font-size: 13px;
  color: var(--c-text-muted);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.crop__close {
  color: var(--c-danger);
}

.crop__main {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.crop__uploader-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
}

.crop__loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--c-text-muted);
}

.crop__list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px;
}

.crop__toolbar {
  margin-top: auto;
}

.crop__toast {
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