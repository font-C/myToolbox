import { ref, watch } from 'vue'
import { imgStore } from './images.js'
import { getLoaded } from './imgcache.js'

/** 把共享图片库中可解码的项加载为 Image 数组(与 items 顺序一致) */
export function useLoadedImages() {
  const imgs = ref([])
  watch(
    () => imgStore.items.map((i) => `${i.url}:${i.w}:${i.h}:${i.error || ''}`).join('|'),
    async () => {
      const list = imgStore.items.filter((i) => i.w && !i.error)
      const res = await Promise.all(list.map((i) => getLoaded(i.url).catch(() => null)))
      imgs.value = res.filter(Boolean)
    },
    { immediate: true },
  )
  return imgs
}

export function debounce(fn, ms) {
  let t = 0
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

export async function canvasToBytes(canvas, format, quality) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('ENCODE_FAIL'))),
      format,
      format === 'image/jpeg' ? quality / 100 : undefined,
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
}
