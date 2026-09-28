import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../stores/app'

/**
 * 商店客户端逻辑（单例状态）：
 * - 拉取当前源的 index.json（失败回退到最近一次缓存）
 * - 安装/更新插件：下载 .tbox → Rust 验签（Ed25519）+ sha256 校验 → 原子安装
 * - 启动时静默检查更新，供导航栏红点提示
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

async function fetchWithTimeout(url, ms = 10000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { cache: 'no-store', signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
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
  localStorage.setItem(cacheKey(url), JSON.stringify({ fetchedAt: Date.now(), data }))
}

/** 拉取当前激活源的索引。force 为 false 时，后台刷新（先展示缓存）。 */
async function fetchIndex({ silent = false } = {}) {
  const app = useAppStore()
  const url = app.activeStoreUrl
  if (!url) {
    error.value = '未配置商店源'
    return
  }
  const cached = readCache(url)
  if (cached && !silent) {
    index.value = cached.data
    fromCache.value = true
  }
  loading.value = true
  error.value = null
  try {
    const res = await fetchWithTimeout(new URL('index.json', url).href)
    if (!res.ok) throw new Error(`商店返回 ${res.status}`)
    const data = await res.json()
    if (data.storeVersion !== 1) throw new Error(`不支持的商店索引版本 ${data.storeVersion}`)
    index.value = data
    fromCache.value = false
    writeCache(url, data)
    computeUpdates()
  } catch (e) {
    if (!cached) index.value = null
    error.value = `无法加载商店：${e}（可尝试切换源）`
  } finally {
    loading.value = false
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
  const installed = new Map(appStore.plugins.map((p) => [p.id, p.manifest.version]))
  updates.value = (index.value.plugins ?? []).filter((entry) => {
    const current = installed.get(entry.id)
    return current ? versionGt(entry.version, current) : false
  })
}

function installStateOf(entry) {
  const app = useAppStore()
  const current = appStore.plugins.find((p) => p.id === entry.id)
  if (!current) return 'installable'
  if (versionGt(entry.version, current.manifest.version)) return 'updatable'
  return 'installed'
}

async function install(entry) {
  const app = useAppStore()
  const sourceUrl = app.activeStoreUrl
  const pkgUrl = new URL(entry.package, sourceUrl).href
  const res = await fetchWithTimeout(pkgUrl, 60000)
  if (!res.ok) throw new Error(`下载插件包失败：HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  await invoke('plugin_install', {
    payload: { bytes, source: 'store', sha256: entry.sha256, signature: entry.signature },
  })
  await app.loadPlugins()
  computeUpdates()
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
  }
}
