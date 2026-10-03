<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useNativeFileDrop } from '@toolbox/plugin-sdk'
import { imgStore, addFiles } from './images.js'
import ImageStrip from './ImageStrip.vue'
import LongTab from './LongTab.vue'
import TemplateTab from './TemplateTab.vue'
import FreeTab from './FreeTab.vue'

const TABS = [
  { id: 'long', label: '长图拼接' },
  { id: 'tpl', label: '模板拼图' },
  { id: 'free', label: '自由拼图' },
]

const tab = ref('long')
const dragging = ref(false)

let unlistenNativeDrop = () => {}
onMounted(() => {
  unlistenNativeDrop = useNativeFileDrop({
    onFiles: (list) => addFiles(list),
    onDragState: (v) => {
      dragging.value = v
    },
  })
})
onUnmounted(() => unlistenNativeDrop())
</script>

<template>
  <div
    class="page"
    @dragover.prevent="dragging = true"
    @dragleave.self="dragging = false"
    @drop.prevent="((dragging = false), addFiles($event.dataTransfer?.files))"
  >
    <header class="header">
      <h1>图片拼接</h1>
      <p class="header__sub">长图拼接 · 模板拼图 · 自由拼贴 · 全离线</p>
    </header>

    <main class="body">
      <ImageStrip :show-place="tab === 'free'" />

      <nav class="tabs">
        <button
          v-for="t in TABS"
          :key="t.id"
          type="button"
          class="tab"
          :class="{ 'tab--on': tab === t.id }"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </nav>

      <p v-if="imgStore.error" class="error">{{ imgStore.error }}</p>
      <LongTab v-show="tab === 'long'" />
      <TemplateTab v-show="tab === 'tpl'" />
      <FreeTab v-show="tab === 'free'" />
    </main>

    <div v-if="dragging" class="dropmask">松开以添加图片</div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; overflow-y: auto; position: relative; }
.header { text-align: center; padding: 18px 16px 6px; }
.header h1 { margin: 0 0 5px; font-size: 21px; }
.header__sub { margin: 0; font-size: 13px; color: var(--c-text-muted); }
.body { width: 100%; max-width: 980px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; padding: 6px 22px 24px; }
.error { margin: 0; font-size: 12.5px; color: var(--c-danger); }

.dropmask {
  position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center;
  background: rgba(59, 130, 246, 0.08); border: 3px dashed var(--c-primary); border-radius: 12px;
  font-size: 16px; font-weight: 600; color: var(--c-primary); pointer-events: none;
}

.tabs { display: flex; gap: 6px; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 6px; }
.tab { flex: 1; border: none; background: transparent; padding: 9px 12px; font-size: 13.5px; border-radius: 8px; cursor: pointer; color: var(--c-text-muted); font-weight: 600; }
.tab--on { background: var(--c-primary); color: #fff; }
</style>
