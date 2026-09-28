<script setup>
defineProps({
  pageCount: { type: Number, default: 0 },
  appliedCount: { type: Number, default: 0 },
  hasCrops: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
})
defineEmits(['apply-all', 'reset', 'print', 'export'])
</script>

<template>
  <div class="toolbar">
    <p class="toolbar__meta">
      <template v-if="pageCount">共 {{ pageCount }} 页 · 已裁剪 {{ appliedCount }} 页</template>
    </p>
    <div class="toolbar__actions">
      <button type="button" class="btn" :disabled="busy || !pageCount" @click="$emit('apply-all')">
        应用到所有页
      </button>
      <button type="button" class="btn" :disabled="busy || !hasCrops" @click="$emit('reset')">
        重置裁剪
      </button>
      <button type="button" class="btn" :disabled="busy || !hasCrops" @click="$emit('print')">
        🖨️ 打印
      </button>
      <button
        type="button"
        class="btn btn--primary"
        :disabled="busy || !hasCrops"
        @click="$emit('export')"
      >
        📥 导出 PDF
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
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

.toolbar__meta {
  margin: 0;
  font-size: 13px;
  color: var(--c-text-muted);
}

.toolbar__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
</style>