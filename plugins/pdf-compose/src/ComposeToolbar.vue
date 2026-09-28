<script setup>
import { ref } from 'vue'

const props = defineProps({
  busy: { type: Boolean, default: false },
  totalPages: { type: Number, default: 0 },
  elementCount: { type: Number, default: 0 },
  isEmpty: { type: Boolean, default: true },
})
const emit = defineEmits(['add-page', 'delete-page', 'reset', 'print', 'export', 'page-size'])

// 可选页尺寸预设（pt）
const PRESETS = [
  { label: 'A4', width: 595.28, height: 841.89 },
  { label: 'A3', width: 841.89, height: 1190.55 },
  { label: 'Letter', width: 612, height: 792 },
]
const sizeIndex = ref(0)

// 选中即对所有页应用
function onSizeChange(e) {
  const preset = PRESETS[Number(e.target.value)]
  if (preset) emit('page-size', { width: preset.width, height: preset.height })
}
</script>

<template>
  <div class="c-toolbar">
    <p class="c-toolbar__meta">
      共 {{ totalPages }} 页 · {{ elementCount }} 个元素
    </p>
    <div class="c-toolbar__actions">
      <label class="c-toolbar__size">
        <span>页尺寸</span>
        <select :value="sizeIndex" @change="onSizeChange">
          <option v-for="(p, i) in PRESETS" :key="p.label" :value="i">{{ p.label }}</option>
        </select>
      </label>
      <button type="button" class="btn" :disabled="busy" @click="$emit('add-page')">新增页</button>
      <button type="button" class="btn" :disabled="busy || totalPages <= 1" @click="$emit('delete-page')">删除末页</button>
      <button type="button" class="btn" :disabled="busy" @click="$emit('reset')">重置</button>
      <button type="button" class="btn" :disabled="busy || isEmpty" @click="$emit('print')">🖨️ 打印</button>
      <button
        type="button"
        class="btn btn--primary"
        :disabled="busy || isEmpty"
        @click="$emit('export')"
      >📥 导出 PDF</button>
    </div>
  </div>
</template>

<style scoped>
.c-toolbar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 24px;
  background: var(--c-surface);
  border-top: 1px solid var(--c-border);
  flex-wrap: wrap;
}

.c-toolbar__meta {
  margin: 0;
  font-size: 13px;
  color: var(--c-text-muted);
}

.c-toolbar__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.c-toolbar__size {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--c-text-muted);
}

.c-toolbar__size select {
  padding: 6px 8px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-surface);
  color: var(--c-text);
  font-size: 13px;
  cursor: pointer;
  outline: none;
}

.c-toolbar__size select:focus {
  border-color: var(--c-primary);
}
</style>