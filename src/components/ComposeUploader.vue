<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { COMPOSE_ACCEPT } from '../constants/pdf'
import { useNativeFileDrop } from '../composables/useNativeFileDrop'

const emit = defineEmits(['files'])
const dragging = ref(false)
const inputEl = ref(null)

// Tauri 内用原生拖拽事件补足 Finder 拖放（HTML5 dataTransfer.files 为空）
let unlistenNativeDrop = () => {}
onMounted(() => {
  unlistenNativeDrop = useNativeFileDrop({
    onFiles: (files) => handleFiles(files),
    onDragState: (v) => {
      dragging.value = v
    },
  })
})
onUnmounted(() => unlistenNativeDrop())

function isValid(file) {
  return file && /\.(png|jpe?g|pdf)$/i.test(file.name || '')
}

// 收集有效文件（图片/PDF 混合，可能多个），交给父组件 store.importFiles
function handleFiles(list) {
  const files = Array.from(list || [])
  const valid = files.filter(isValid)
  if (valid.length === 0) return
  emit('files', valid)
}

function onDrop(e) {
  dragging.value = false
  e.preventDefault()
  handleFiles(e.dataTransfer?.files)
}

function onInputChange(e) {
  handleFiles(e.target.files)
  if (inputEl.value) inputEl.value.value = ''
}

// 全局拖拽置灰（拖到窗口任意处高亮上传区）
function onWindowDragOver(e) {
  dragging.value = true
  e.preventDefault()
}
function onWindowDragLeave() {
  dragging.value = false
}
</script>

<template>
  <div
    class="c-uploader"
    :class="{ 'c-uploader--drag': dragging }"
    @dragover.prevent="onWindowDragOver"
    @dragleave="onWindowDragLeave"
    @drop="onDrop"
    @click="inputEl?.click()"
  >
    <input
      ref="inputEl"
      type="file"
      :accept="COMPOSE_ACCEPT"
      multiple
      class="c-uploader__input"
      @change="onInputChange"
    />
    <div class="c-uploader__icon">🧩</div>
    <p class="c-uploader__title">拖拽图片 / PDF 到此处，或点击选择文件</p>
    <p class="c-uploader__hint">支持一次选择多个文件（PNG/JPG 与 PDF 混选）· 按页拼版</p>
    <button type="button" class="btn btn--primary c-uploader__btn">选择文件</button>
  </div>
</template>

<style scoped>
.c-uploader {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 560px;
  min-height: 320px;
  border: 2px dashed var(--c-border);
  border-radius: 16px;
  background: var(--c-surface);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  padding: 40px 24px;
}

.c-uploader:hover,
.c-uploader--drag {
  border-color: var(--c-primary);
  background: rgba(59, 130, 246, 0.05);
}

.c-uploader__input {
  display: none;
}

.c-uploader__icon {
  font-size: 52px;
  line-height: 1;
  margin-bottom: 16px;
}

.c-uploader__title {
  margin: 0 0 6px;
  font-size: 17px;
  font-weight: 600;
}

.c-uploader__hint {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--c-text-muted);
}
</style>