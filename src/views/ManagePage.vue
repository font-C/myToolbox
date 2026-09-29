<script setup>
import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open, ask } from '@tauri-apps/plugin-dialog'
import { useAppStore } from '../stores/app'

const appStore = useAppStore()
const isDev = import.meta.env.DEV

const SOURCE_LABELS = {
  builtin: '内置',
  store: '商店',
  local: '本地',
  dev: '开发',
}

const busy = ref(false)
const notice = ref(null) // { kind: 'ok'|'err', text }

function notify(kind, text) {
  notice.value = { kind, text }
  setTimeout(() => {
    if (notice.value?.text === text) notice.value = null
  }, 4000)
}

const sortedPlugins = computed(() =>
  [...appStore.plugins].sort((a, b) => {
    const rank = { dev: 0, local: 1, store: 2, builtin: 3 }
    return (rank[a.source] ?? 9) - (rank[b.source] ?? 9) || a.id.localeCompare(b.id)
  })
)

async function toggleEnabled(plugin) {
  try {
    await invoke('plugin_set_enabled', { id: plugin.id, enabled: !plugin.enabled })
  } catch (e) {
    notify('err', String(e))
  }
}

async function uninstall(plugin) {
  const hint =
    plugin.source === 'builtin'
      ? '内置插件卸载后不会随应用启动自动恢复，需要时可从商店重新安装。'
      : '此操作会删除其文件。'
  const ok = await ask(`确定卸载插件「${plugin.manifest.name}」？${hint}`, {
    title: '卸载插件',
    kind: 'warning',
    okLabel: '卸载',
    cancelLabel: '取消',
  })
  if (!ok) return
  try {
    await invoke('plugin_uninstall', { id: plugin.id })
    notify('ok', `已卸载 ${plugin.manifest.name}`)
  } catch (e) {
    notify('err', String(e))
  }
}

async function importLocal() {
  const file = await open({
    title: '选择插件包（.tbox）',
    filters: [{ name: '工具箱插件', extensions: ['tbox'] }],
  })
  if (!file) return
  busy.value = true
  try {
    const manifest = await invoke('plugin_install', {
      payload: { path: file, source: 'local' },
    })
    notify('ok', `已安装 ${manifest.name} v${manifest.version}（未签名本地包）`)
  } catch (e) {
    notify('err', String(e))
  } finally {
    busy.value = false
  }
}

async function registerDev() {
  try {
    const id = await invoke('plugin_dev_register')
    notify('ok', `已注册开发插件 ${id}`)
  } catch (e) {
    notify('err', String(e))
  }
}

async function unregisterDev(plugin) {
  try {
    await invoke('plugin_dev_unregister', { id: plugin.id })
    notify('ok', `已移除开发插件 ${plugin.id}`)
  } catch (e) {
    notify('err', String(e))
  }
}
</script>

<template>
  <div class="manage">
    <div class="manage__head">
      <h2 class="page-title">插件管理</h2>
      <div class="manage__actions">
        <button v-if="isDev" type="button" class="btn" @click="registerDev">
          加载开发插件目录
        </button>
        <button type="button" class="btn btn--primary" :disabled="busy" @click="importLocal">
          导入 .tbox 插件包
        </button>
      </div>
    </div>

    <div class="manage__scroll">
      <p v-if="notice" class="notice" :class="`notice--${notice.kind}`">{{ notice.text }}</p>

      <div class="list">
        <div v-for="p in sortedPlugins" :key="p.id" class="item" :class="{ 'item--off': !p.enabled }">
          <img class="item__icon" :src="p.iconUrl" :alt="p.manifest.name" />
          <div class="item__main">
            <div class="item__title">
              <span class="item__name">{{ p.manifest.name }}</span>
              <span class="item__version">v{{ p.manifest.version }}</span>
              <span class="tag" :class="`tag--${p.source}`">{{ SOURCE_LABELS[p.source] ?? p.source }}</span>
              <span v-if="p.running" class="tag tag--run">运行中</span>
            </div>
            <div class="item__desc">{{ p.manifest.description }}</div>
            <div class="item__meta">
              <span>{{ p.id }}</span>
              <span v-if="p.manifest.permissions.length">· 权限：{{ p.manifest.permissions.join(' / ') }}</span>
              <span v-else>· 无特殊权限</span>
            </div>
          </div>
          <div class="item__actions">
            <label class="switch" :title="p.enabled ? '停用' : '启用'">
              <input type="checkbox" :checked="p.enabled" @change="toggleEnabled(p)" />
              <span class="switch__slider"></span>
            </label>
            <button
              v-if="p.source === 'dev'"
              type="button"
              class="btn item__danger"
              @click="unregisterDev(p)"
            >
              移除
            </button>
            <button v-else type="button" class="btn item__danger" @click="uninstall(p)">
              卸载
            </button>
          </div>
        </div>

        <p v-if="!sortedPlugins.length" class="empty">尚未安装任何插件。</p>
      </div>
    </div>
  </div>
</template>


<style scoped>
.manage {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 18px 28px 0;
}
.manage__head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.manage__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 2px 24px;
}
.page-title {
  margin: 0;
  font-size: 20px;
}
.manage__actions {
  display: flex;
  gap: 10px;
}
.notice {
  max-width: 720px;
  margin: 0 0 14px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
}
.notice--ok {
  background: rgba(22, 163, 74, 0.1);
  color: #15803d;
}
.notice--err {
  background: rgba(239, 68, 68, 0.1);
  color: var(--c-danger);
}

.list {
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.item {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 14px 16px;
}
.item--off {
  opacity: 0.55;
}
.item__icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  object-fit: cover;
  flex: 0 0 auto;
}
.item__main {
  flex: 1;
  min-width: 0;
}
.item__title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.item__name {
  font-size: 15px;
  font-weight: 600;
}
.item__version {
  font-size: 12px;
  color: var(--c-text-muted);
}
.tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--c-bg);
  color: var(--c-text-muted);
}
.tag--builtin {
  background: rgba(59, 130, 246, 0.12);
  color: var(--c-primary);
}
.tag--dev {
  background: rgba(234, 179, 8, 0.15);
  color: #a16207;
}
.tag--run {
  background: rgba(22, 163, 74, 0.12);
  color: #16a34a;
}
.item__desc {
  font-size: 13px;
  color: var(--c-text-muted);
  margin-top: 2px;
}
.item__meta {
  font-size: 12px;
  color: var(--c-text-muted);
  margin-top: 4px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.item__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}
.item__danger {
  color: var(--c-danger);
  border-color: var(--c-border);
}
.item__danger:hover:not(:disabled) {
  border-color: var(--c-danger);
  color: var(--c-danger);
}

/* 开关 */
.switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  cursor: pointer;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.switch__slider {
  position: absolute;
  inset: 0;
  background: var(--c-border);
  border-radius: 999px;
  transition: background 0.15s;
}
.switch__slider::before {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  left: 2px;
  top: 2px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.2);
  transition: transform 0.15s;
}
.switch input:checked + .switch__slider {
  background: var(--c-primary);
}
.switch input:checked + .switch__slider::before {
  transform: translateX(18px);
}

.empty {
  color: var(--c-text-muted);
  text-align: center;
  padding: 40px 0;
}
</style>
