/** objectURL → 已解码 Image 的会话级缓存,预览与导出共用 */
const cache = new Map()

export function getLoaded(url) {
  let entry = cache.get(url)
  if (!entry) {
    entry = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('DECODE_FAIL'))
      img.src = url
    })
    cache.set(url, entry)
  }
  return entry
}

export async function loadAll(urls) {
  return Promise.all(urls.map((u) => getLoaded(u)))
}
