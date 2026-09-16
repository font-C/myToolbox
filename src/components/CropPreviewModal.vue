<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { usePdfStore } from '../stores/pdf'
import { getCurrentDoc, renderCropPreview } from '../composables/usePdfRenderer'

const props = defineProps({
  page: { type: Object, required: true }, // { index, width, height }
})
const emit = defineEmits(['close'])
const store = usePdfStore()

const imgSrc = ref('')
const failed = ref(false)

function onKeydown(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  loadPreview()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

async function loadPreview() {
  const crop = store.cropBoxes[props.page.index]
  if (!crop) return
  const doc = getCurrentDoc()
  if (!doc) return
  try {
    imgSrc.value = await renderCropPreview(doc, props.page.index, crop)
  } catch (e) {
    console.error(e)
    failed.value = true
  }
}
</script>

<template>
  <div class="preview-backdrop" @click.self="emit('close')">
    <div class="preview-card" role="dialog" aria-label="裁剪预览">
      <div class="preview-card__head">
        <h3>第 {{ page.index }} 页裁剪预览</h3>
        <button type="button" class="preview-card__close" @click="emit('close')">✕</button>
      </div>
      <div class="preview-card__body">
        <div v-if="imgSrc" class="preview-card__image">
          <img :src="imgSrc" alt="裁剪预览" />
        </div>
        <p v-else-if="failed" class="preview-card__empty">预览失败，请重新框选后再试。</p>
        <p v-else class="preview-card__empty">该页尚未框选裁剪区域。</p>
      </div>
      <p class="preview-card__tip">关闭后回到原始整页，可继续调整裁剪框。</p>
    </div>
  </div>
</template>

<style scoped>
.preview-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.preview-card {
  background: var(--c-surface);
  border-radius: var(--radius);
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.25);
  width: min(640px, 92vw);
  padding: 16px 20px 14px;
}

.preview-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.preview-card__head h3 {
  margin: 0;
  font-size: 16px;
}

.preview-card__close {
  border: none;
  background: transparent;
  font-size: 16px;
  cursor: pointer;
  color: var(--c-text-muted);
  padding: 4px 8px;
  border-radius: 6px;
}
.preview-card__close:hover {
  background: var(--c-bg);
  color: var(--c-text);
}

.preview-card__body {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--c-bg);
  border-radius: 8px;
  padding: 12px;
}

.preview-card__image {
  width: 100%;
  max-height: 64vh;
  overflow: auto;
  text-align: center;
}
.preview-card__image img {
  max-width: 100%;
  height: auto;
  box-shadow: var(--shadow);
}

.preview-card__empty {
  color: var(--c-text-muted);
  font-size: 14px;
}

.preview-card__tip {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--c-text-muted);
}
</style>