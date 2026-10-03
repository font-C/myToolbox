<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { listen } from '@tauri-apps/api/event'
import HomePage from './views/HomePage.vue'
import StorePage from './views/StorePage.vue'
import ManagePage from './views/ManagePage.vue'
import SettingsPage from './views/SettingsPage.vue'
import { useAppStore } from './stores/app'
import { useStore } from './composables/useStore'
import { useAppUpdater } from './composables/useAppUpdater'

const appStore = useAppStore()
const store = useStore()
const appUpdater = useAppUpdater()

const tabs = [
  { key: 'home', label: '启动台' },
  { key: 'store', label: '商店' },
  { key: 'manage', label: '插件管理' },
  { key: 'settings', label: '设置' },
]

const views = { home: HomePage, store: StorePage, manage: ManagePage, settings: SettingsPage }
const currentView = computed(() => views[appStore.view] ?? HomePage)

let unlisten = null
let disposed = false
onMounted(() => {
  // 事件监听最先注册：后续任一初始化步骤失败都不能影响插件变化感知
  listen('toolbox://plugins-changed', () => {
    appStore.loadPlugins()
      .then(() => store.computeUpdates())
      .catch((e) => console.error('[toolbox] 刷新插件列表失败:', e))
  }).then((fn) => {
    if (disposed) fn()
    else unlisten = fn
  })
  // 各步骤独立容错：任一步失败不阻断其余步骤
  appStore.loadStoreConfig()
  appStore.init().catch((e) => console.error('[toolbox] 初始化失败:', e))
  // 静默检查插件更新（供商店页与红点使用，失败不打扰）
  store.checkUpdatesSilently().catch(() => {})
  // 静默检查主程序更新（供设置页与红点使用，失败不打扰）
  appUpdater.checkAppUpdate({ silent: true })
})
onBeforeUnmount(() => {
  disposed = true
  unlisten?.()
})
</script>

<template>
  <div class="app">
    <header class="app__bar">
      <span class="app__brand">🧰 工具箱</span>
      <nav class="app__nav">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="app__tab"
          :class="{ 'app__tab--on': appStore.view === t.key }"
          @click="appStore.setView(t.key)"
        >
          {{ t.label }}
          <span v-if="t.key === 'store' && store.updates.value.length" class="app__dot"></span>
          <span
            v-if="t.key === 'settings' && (appUpdater.status.value === 'available' || appUpdater.status.value === 'ready')"
            class="app__dot"
          ></span>
        </button>
      </nav>
    </header>

    <component :is="currentView" class="app__body" />
  </div>
</template>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.app__bar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 10px 20px;
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
  flex: 0 0 auto;
}

.app__brand {
  font-size: 15px;
  font-weight: 700;
  color: var(--c-text);
}

.app__nav {
  display: flex;
  gap: 4px;
}

.app__tab {
  border: none;
  background: transparent;
  color: var(--c-text-muted);
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.app__tab:hover {
  background: rgba(59, 130, 246, 0.08);
  color: var(--c-primary);
}

.app__tab--on {
  background: rgba(59, 130, 246, 0.12);
  color: var(--c-primary);
}

.app__dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 4px;
  border-radius: 50%;
  background: #ef4444;
  vertical-align: super;
}

.app__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
