<script setup>
import { ref, watch, onMounted } from 'vue'
import { renderTemplate } from './collage.js'

const props = defineProps({ tpl: { type: Object, required: true } })
const cv = ref(null)

function draw() {
  const el = cv.value
  if (!el || !props.tpl) return
  const aspect = props.tpl.aspect || 1
  const H = 62
  const W = Math.round(Math.min(118, Math.max(44, H * aspect)))
  const dpr = window.devicePixelRatio || 1
  el.width = Math.round(W * dpr)
  el.height = Math.round(H * dpr)
  el.style.width = `${W}px`
  el.style.height = `${H}px`
  renderTemplate(el, props.tpl, null, {
    gap: 5 * dpr,
    margin: 7 * dpr,
    placeholder: true,
    transparent: true,
    absolute: true,
  })
}

onMounted(draw)
watch(() => props.tpl, draw, { deep: true })
</script>

<template>
  <canvas ref="cv" class="thumb" />
</template>

<style scoped>
.thumb { display: block; margin: 0 auto; }
</style>
