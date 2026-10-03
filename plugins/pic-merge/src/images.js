import { reactive } from 'vue'

/** 共享图片库:三个 Tab 共用同一组图片与顺序 */
export const imgStore = reactive({
  items: [], // { file, name, w, h, url, error? }
  error: '',
})

const RE = /\.(jpe?g|png|webp)$/i

export function addFiles(list) {
  const imgs = Array.from(list || []).filter((f) => RE.test(f.name))
  if (!imgs.length) {
    imgStore.error = '请选择图片文件（JPG / PNG / WebP）'
    return
  }
  imgStore.error = ''
  for (const f of imgs) {
    // item 本身须为 reactive:probe 异步回写 w/h 时才能触发依赖
    const item = reactive({ file: f, name: f.name, w: 0, h: 0, url: URL.createObjectURL(f) })
    imgStore.items.push(item)
    const probe = new Image()
    probe.onload = () => {
      item.w = probe.naturalWidth
      item.h = probe.naturalHeight
    }
    probe.onerror = () => {
      item.error = '无法解码'
    }
    probe.src = item.url
  }
}

export function removeAt(i) {
  const f = imgStore.items[i]
  if (f?.url) URL.revokeObjectURL(f.url)
  imgStore.items.splice(i, 1)
}

export function move(i, dir) {
  const j = i + dir
  if (j < 0 || j >= imgStore.items.length) return
  const arr = imgStore.items
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

export function shuffleItems() {
  const arr = imgStore.items
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

export function clearAll() {
  imgStore.items.forEach((f) => f.url && URL.revokeObjectURL(f.url))
  imgStore.items = []
  imgStore.error = ''
}
