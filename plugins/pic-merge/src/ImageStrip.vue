<script setup>
import { ref } from 'vue'
import { imgStore, addFiles, removeAt, move, clearAll } from './images.js'

defineProps({ showPlace: Boolean })
const emit = defineEmits(['place'])
const fileInput = ref(null)

function onAdd(e) {
  addFiles(e.target.files)
  e.target.value = ''
}
</script>

<template>
  <section class="frameswrap">
    <div class="striphead">
      <p class="sectitle">图片（{{ imgStore.items.length }} 张）· 箭头调顺序</p>
      <button type="button" class="mini" :disabled="!imgStore.items.length" @click="clearAll">清空</button>
    </div>
    <div class="framelist">
      <div v-for="(f, i) in imgStore.items" :key="f.url" class="frame" :class="{ 'frame--bad': f.error }">
        <img :src="f.url" class="frame__img" alt="" />
        <span class="frame__num">{{ i + 1 }}</span>
        <span v-if="f.error" class="frame__err">{{ f.error }}</span>
        <span v-else class="frame__dim">{{ f.w || '?' }} × {{ f.h || '?' }}</span>
        <div class="frame__ops">
          <button v-if="showPlace" type="button" class="op" title="加入自由画布" @click="emit('place', i)">⊕</button>
          <button type="button" class="op" title="上移" :disabled="i === 0" @click="move(i, -1)">↑</button>
          <button type="button" class="op" title="下移" :disabled="i === imgStore.items.length - 1" @click="move(i, 1)">↓</button>
          <button type="button" class="op op--danger" title="删除" @click="removeAt(i)">×</button>
        </div>
      </div>
      <button type="button" class="frame frame--add" @click="fileInput?.click()">
        <input ref="fileInput" type="file" accept=".jpg,.jpeg,.png,.webp" multiple class="hidden" @change="onAdd" />
        ＋<span>加图</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.frameswrap { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 12px; }
.striphead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.sectitle { margin: 0; font-size: 12px; font-weight: 700; color: var(--c-text-muted); }
.mini { border: 1px solid var(--c-border); background: var(--c-bg); color: var(--c-text-muted); border-radius: 6px; font-size: 11.5px; padding: 3px 10px; cursor: pointer; }
.mini:hover:not(:disabled) { color: var(--c-danger); border-color: var(--c-danger); }
.mini:disabled { opacity: 0.45; cursor: default; }
.framelist { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 2px; }
.frame { position: relative; flex: 0 0 auto; width: 92px; }
.frame--bad { opacity: 0.55; }
.frame__img { width: 92px; height: 70px; object-fit: cover; border: 1px solid var(--c-border); border-radius: 8px; display: block; background: #fff; }
.frame__num { position: absolute; top: 4px; left: 4px; min-width: 18px; height: 18px; padding: 0 4px; background: var(--c-primary); color: #fff; font-size: 11px; border-radius: 9px; display: flex; align-items: center; justify-content: center; }
.frame__dim { display: block; margin-top: 3px; font-size: 10.5px; color: var(--c-text-muted); text-align: center; }
.frame__err { display: block; margin-top: 3px; font-size: 10.5px; color: var(--c-danger); text-align: center; }
.frame__ops { display: flex; gap: 3px; justify-content: center; margin-top: 2px; }
.op { border: 1px solid var(--c-border); background: var(--c-bg); border-radius: 6px; width: 24px; height: 22px; cursor: pointer; font-size: 12px; color: var(--c-text); }
.op:disabled { opacity: 0.4; }
.op--danger { color: var(--c-danger); }
.frame--add {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 92px; border: 2px dashed var(--c-border); border-radius: 8px; cursor: pointer;
  font-size: 15px; color: var(--c-text-muted); background: var(--c-bg); width: 92px; gap: 2px;
}
.frame--add:hover { border-color: var(--c-primary); color: var(--c-primary); }
.frame--add span { font-size: 11px; }
.hidden { display: none; }
</style>
