import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const LAUNCH_KEY = 'toolbox.launchConfig'
const STORE_SOURCES_KEY = 'toolbox.storeSources'
const STORE_ACTIVE_KEY = 'toolbox.storeActive'

/**
 * 内置商店源。GitHub Pages 为主源，Gitee 为镜像；
 * 用户可在设置页追加自定义源（静态托管的 index.json + 插件包目录）。
 */
export const BUILTIN_STORE_SOURCES = [
  { name: 'GitHub', url: 'https://font-c.github.io/myToolbox/store/', builtin: true },
  // Gitee raw 直连（内容与主源一致，由 CI/手动同步）；拉取走 Rust 端，不受 CORS/反爬 UA 限制
  { name: 'Gitee', url: 'https://gitee.com/font-c/my-toolbox-store/raw/master/store/', builtin: true },
]

/**
 * 壳子全局状态：
 * - view：当前主窗口视图（启动台/商店/插件管理/设置）
 * - plugins：已安装插件（含停用），来自 Rust 注册表
 * - launchMode/launchPluginId：启动行为（启动台或指定插件）
 */
export const useAppStore = defineStore('app', () => {
  const view = ref('home')
  const plugins = ref([])
  const loaded = ref(false)

  const launchMode = ref('launchpad') // 'launchpad' | 'plugin'
  const launchPluginId = ref(null)

  // —— 启动台可见插件 ——
  const enabledPlugins = computed(() => plugins.value.filter((p) => p.enabled))

  function loadLaunchConfig() {
    try {
      const raw = JSON.parse(localStorage.getItem(LAUNCH_KEY) || '{}')
      launchMode.value = raw.mode === 'plugin' ? 'plugin' : 'launchpad'
      launchPluginId.value = typeof raw.pluginId === 'string' ? raw.pluginId : null
    } catch {
      /* 忽略坏配置，回到默认 */
    }
  }

  function saveLaunchConfig() {
    localStorage.setItem(
      LAUNCH_KEY,
      JSON.stringify({ mode: launchMode.value, pluginId: launchPluginId.value })
    )
  }

  /** 应用启动行为：若配置为“打开指定插件”且插件可用则打开，返回是否已打开 */
  async function applyLaunchBehavior() {
    if (launchMode.value === 'plugin' && launchPluginId.value) {
      const target = plugins.value.find((p) => p.id === launchPluginId.value && p.enabled)
      if (target) {
        await openTool(target.id)
        return true
      }
    }
    return false
  }

  async function loadPlugins() {
    plugins.value = await invoke('plugin_list')
    loaded.value = true
  }

  async function init() {
    loadLaunchConfig()
    await loadPlugins()
    await applyLaunchBehavior()
  }

  async function openTool(id) {
    await invoke('plugin_open', { id })
  }

  function setView(v) {
    view.value = v
  }

  // —— 商店源 ——
  const storeSources = ref([])
  const activeStoreUrl = ref('')

  function loadStoreConfig() {
    let custom = []
    try {
      custom = JSON.parse(localStorage.getItem(STORE_SOURCES_KEY) || '[]')
    } catch {
      custom = []
    }
    storeSources.value = [...BUILTIN_STORE_SOURCES, ...custom.filter((s) => s && s.url)]
    const saved = localStorage.getItem(STORE_ACTIVE_KEY)
    activeStoreUrl.value =
      saved && storeSources.value.some((s) => s.url === saved)
        ? saved
        : (storeSources.value[0]?.url ?? '')
  }

  function setActiveStore(url) {
    activeStoreUrl.value = url
    localStorage.setItem(STORE_ACTIVE_KEY, url)
  }

  function addStoreSource(name, url) {
    if (!url) return false
    const list = storeSources.value.filter((s) => !s.builtin)
    if ([...storeSources.value].some((s) => s.url === url)) return false
    list.push({ name: name || url, url, builtin: false })
    storeSources.value = [...BUILTIN_STORE_SOURCES, ...list]
    localStorage.setItem(STORE_SOURCES_KEY, JSON.stringify(list))
    return true
  }

  function removeStoreSource(url) {
    const custom = storeSources.value.filter((s) => !s.builtin && s.url !== url)
    storeSources.value = [...BUILTIN_STORE_SOURCES, ...custom]
    localStorage.setItem(STORE_SOURCES_KEY, JSON.stringify(custom))
    if (activeStoreUrl.value === url) setActiveStore(BUILTIN_STORE_SOURCES[0].url)
  }

  return {
    view,
    plugins,
    loaded,
    enabledPlugins,
    launchMode,
    launchPluginId,
    storeSources,
    activeStoreUrl,
    init,
    loadPlugins,
    openTool,
    setView,
    saveLaunchConfig,
    loadStoreConfig,
    setActiveStore,
    addStoreSource,
    removeStoreSource,
  }
})
