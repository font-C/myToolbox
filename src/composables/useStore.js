import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../stores/app'

/**
 * 商店客户端逻辑（单例状态）：
 * - 拉取当前源的 index.json（失败回退到最近一次缓存）
 * - 安装/更新插件：下载 .tbox → Rust 验签（Ed25519）+ sha256 校验 → 原子安装
 * - 启动时静默检查更新，供导航栏红点提示
 *
 * 资源拉取走 Rust 端 HTTP（store_fetch / reqwest）：webview 里的 fetch 受 CORS
 * 约束（源是 tauri://localhost），Gitee raw 等不发 CORS 头的托管会被拦；
 * Rust 端不受限，任何 https 目录都能当商店源。
 */
const loading = ref(false)
const error = ref(null)
const index = ref(null) // { storeVersion, updatedAt, plugins: [] }
const fromCache = ref(false)
const updates = ref([]) // 可更新的商店插件条目

const CACHE_PREFIX = 'toolbox.storeCache.'

function semverCore(v) {
  return String(v).split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0)
}

function versionGt(a, b) {
  const va = semverCore(a)
  const vb = semverCore(b)
  for (let i = 0; i < 3; i++) {
    if ((va[i] || 0) > (vb[i] || 0)) return true
    if ((va[i] || 0) < (vb[i] || 0)) return false
  }
  return false
}

/** 拉取商店资源，返回 ArrayBuffer（Rust 端 reqwest，非 2xx 直接抛错）。 */
async function fetchWithTimeout(url, ms = 10000) {
  return await invoke('store_fetch', { url, timeoutSecs: Math.max(5, Math.ceil(ms / 1000)) })
}

function cacheKey(url) {
  return CACHE_PREFIX + url
}

function readCache(url) {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(url)) || 'null')
  } catch {
    return null
  }
}

function writeCache(url, data) {
  try {
    localStorage.setItem(cacheKey(url), JSON.stringify({ fetchedAt: Date.now(), data }))
  } catch {
    // 配额满/存储不可用时忽略：缓存只是离线回退，不应让成功拉取报错
  }
}

let fetchToken = 0

/** 拉取当前激活源的索引。force 为 false 时，后台刷新（先展示缓存）。 */
async function fetchIndex({ silent = false } = {}) {
  const app = useAppStore()
  const url = app.activeStoreUrl
  if (!url) {
    error.value = '未配置商店源'
    return
  }
  const token = ++fetchToken
  const cached = readCache(url)
  if (cached && !silent) {
    index.value = cached.data
    fromCache.value = true
  }
  loading.value = true
  error.value = null
  try {
    const buf = await fetchWithTimeout(new URL('index.json', url).href)
    const data = JSON.parse(new TextDecoder().decode(buf))
    if (data.storeVersion !== 1) throw new Error(`不支持的商店索引版本 ${data.storeVersion}`)
    if (token !== fetchToken) return // 已发起更新的请求，丢弃过期响应
    index.value = data
    fromCache.value = false
    writeCache(url, data)
    computeUpdates()
  } catch (e) {
    if (token !== fetchToken) return
    if (!cached) index.value = null
    error.value = `无法加载商店：${e}（可尝试切换源）`
  } finally {
    if (token === fetchToken) loading.value = false
  }
}

/** 启动时静默检查更新（仅刷新更新列表，不打扰用户） */
async function checkUpdatesSilently() {
  await fetchIndex({ silent: true })
}

function computeUpdates() {
  const app = useAppStore()
  if (!index.value) {
    updates.value = []
    return
  }
  const installed = new Map(app.plugins.map((p) => [p.id, p.manifest.version]))
  updates.value = (index.value.plugins ?? []).filter((entry) => {
    const current = installed.get(entry.id)
    return current ? versionGt(entry.version, current) : false
  })
}

function installStateOf(entry) {
  const app = useAppStore()
  const current = app.plugins.find((p) => p.id === entry.id)
  if (!current) return 'installable'
  if (versionGt(entry.version, current.manifest.version)) return 'updatable'
  return 'installed'
}

const installing = new Set() // 安装中的插件 id：防重复点击并发安装

function isInstalling(id) {
  return installing.has(id)
}

// ---------- 图标代理拉取 ----------
//
// Gitee raw 是「302 → 带签名的 CDN 地址」跳转链，webview 直接 <img> 加载不可靠
// （其防盗链对请求来源敏感，会再次弹跳导致图片加载失败）。索引能正常加载靠的是
// Rust 端拉取（reqwest，无 Referer），图标走同一条通道：拉字节 → data URL 渲染
// （CSP img-src 允许 data:）。

const iconCache = new Map() // 绝对 URL → data URL（进程内缓存，成功才缓存）

async function fetchIcon(url) {
  if (iconCache.has(url)) return iconCache.get(url)
  try {
    const buf = await fetchWithTimeout(url, 10000)
    const bytes = new Uint8Array(buf)
    if (!bytes.length) throw new Error('空图标')
    // 自行判型：CDN 返回的 Content-Type 不可信
    const mime =
      bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
      : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
      : bytes[0] === 0x3c ? 'image/svg+xml'
      : 'image/png'
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = () => reject(fr.error ?? new Error('读取图标数据失败'))
      fr.readAsDataURL(new Blob([bytes], { type: mime }))
    })
    iconCache.set(url, dataUrl)
    return dataUrl
  } catch {
    return null // 失败不缓存：下次索引刷新时可重试
  }
}

async function install(entry) {
  if (installing.has(entry.id)) return
  installing.add(entry.id)
  try {
    const app = useAppStore()
    const sourceUrl = app.activeStoreUrl
    const pkgUrl = new URL(entry.package, sourceUrl).href
    const buf = await fetchWithTimeout(pkgUrl, 60000)
    const bytes = new Uint8Array(buf)
    await invoke('plugin_install', {
      payload: { bytes, source: 'store', sha256: entry.sha256, signature: entry.signature },
    })
    await app.loadPlugins()
    computeUpdates()
  } finally {
    installing.delete(entry.id)
  }
}

export function useStore() {
  return {
    loading,
    error,
    index,
    fromCache,
    updates,
    fetchIndex,
    checkUpdatesSilently,
    computeUpdates,
    installStateOf,
    install,
    isInstalling,
    fetchIcon,
  }
}
