<script setup>
import { ref } from 'vue'
import { ACCEPTED_EXTENSION } from '../constants/pdf'

const emit = defineEmits(['select'])
const dragging = ref(false)
const inputEl = ref(null)

function isValid(file) {
  return file && file.name.toLowerCase().endsWith(ACCEPTED_EXTENSION)
}

function handleFiles(list) {
  const file = list?.[0]
  if (!file) return
  if (!isValid(file)) {
    emit('invalid')
    return
  }
  emit('select', file)
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
function onWindowDragLeave(e) {
  dragging.value = false
}
</script>

<template>
  <div
    class="uploader"
    :class="{ 'uploader--drag': dragging }"
    @dragover.prevent="onWindowDragOver"
    @dragleave="onWindowDragLeave"
    @drop="onDrop"
    @click="inputEl?.click()"
  >
    <input
      ref="inputEl"
      type="file"
      accept=".pdf"
      class="uploader__input"
      @change="onInputChange"
    />
    <div class="uploader__icon">📄</div>
    <p class="uploader__title">拖拽 PDF 到此处，或点击选择文件</p>
    <p class="uploader__hint">支持多页 PDF · 纯本地处理，文件不会上传</p>
    <button type="button" class="btn btn--primary uploader__btn">选择 PDF 文件</button>
  </div>
</template>

<style scoped>
.uploader {
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

.uploader:hover,
.uploader--drag {
  border-color: var(--c-primary);
  background: rgba(59, 130, 246, 0.05);
}

.uploader__input {
  display: none;
}

.uploader__icon {
  font-size: 52px;
  line-height: 1;
  margin-bottom: 16px;
}

.uploader__title {
  margin: 0 0 6px;
  font-size: 17px;
  font-weight: 600;
}

.uploader__hint {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--c-text-muted);
}
</style>