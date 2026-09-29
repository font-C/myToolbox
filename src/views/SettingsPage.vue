<script setup>
import { computed } from 'vue'
import { useAppStore } from '../stores/app'
import { useAppUpdater } from '../composables/useAppUpdater'

const appStore = useAppStore()
const appUpdater = useAppUpdater()

function onModeChange(ev) {
  appStore.launchMode = ev.target.value
  if (appStore.launchMode === 'launchpad') appStore.launchPluginId = null
  appStore.saveLaunchConfig()
}

function onPluginChange(ev) {
  appStore.launchPluginId = ev.target.value || null
  appStore.saveLaunchConfig()
}

function checkUpdate() {
  appUpdater.checkAppUpdate()
}

const progressPct = computed(() => {
  const total = appUpdater.total.value
  if (!total) return null
  return Math.min(100, Math.round((appUpdater.received.value / total) * 100))
})

function fmtMB(n) {
  return (n / 1024 / 1024).toFixed(1)
}

const progressText = computed(() => {
  const { received, total } = appUpdater
  const done = `已下载 ${fmtMB(received.value)} MB`
  return total.value ? `${done} / ${fmtMB(total.value)} MB` : done
})
</script>

<template>
  <div class="settings">
    <h2 class="page-title">设置</h2>

    <div class="settings__scroll">

    <section class="card">
      <h3 class="card__title">启动行为</h3>
      <label class="row">
        <input
          type="radio"
          value="launchpad"
          name="launch-mode"
          :checked="appStore.launchMode === 'launchpad'"
          @change="onModeChange"
        />
        <span>启动时显示启动台</span>
      </label>
      <label class="row">
        <input
          type="radio"
          value="plugin"
          name="launch-mode"
          :checked="appStore.launchMode === 'plugin'"
          @change="onModeChange"
        />
        <span>启动时直接打开指定插件</span>
      </label>
      <div v-if="appStore.launchMode === 'plugin'" class="picker">
        <select class="input" :value="appStore.launchPluginId ?? ''" @change="onPluginChange">
          <option value="" disabled>选择插件…</option>
          <option v-for="p in appStore.enabledPlugins" :key="p.id" :value="p.id">
            {{ p.manifest.name }}（{{ p.id }}）
          </option>
        </select>
        <p v-if="!appStore.enabledPlugins.length" class="hint">
          暂无已启用的插件，请先在启动台或商店安装。
        </p>
      </div>
    </section>

    <section class="card">
      <h3 class="card__title">应用更新</h3>
      <p class="hint update__current">当前版本 v{{ appUpdater.currentVersion.value }}</p>

      <div v-if="appUpdater.status.value === 'idle'" class="update__actions">
        <button type="button" class="btn" @click="checkUpdate">检查更新</button>
      </div>

      <p v-else-if="appUpdater.status.value === 'checking'" class="hint">正在检查更新…</p>

      <p v-else-if="appUpdater.status.value === 'uptodate'" class="hint">已是最新版本 ✓</p>

      <div v-else-if="appUpdater.status.value === 'available'">
        <p class="update__version">
          发现新版本 v{{ appUpdater.remote.value.version }}（当前 v{{ appUpdater.currentVersion.value }}）
        </p>
        <pre v-if="appUpdater.remote.value.notes" class="update__notes">{{ appUpdater.remote.value.notes }}</pre>
        <div class="update__actions">
          <button type="button" class="btn btn--primary" @click="appUpdater.downloadAndInstall()">
            下载并安装
          </button>
        </div>
      </div>

      <div v-else-if="appUpdater.status.value === 'downloading'">
        <div class="update__bar">
          <div
            class="update__bar-fill"
            :style="{ width: (progressPct ?? 8) + '%' }"
            :class="{ 'update__bar-fill--indeterminate': progressPct === null }"
          ></div>
        </div>
        <p class="hint">{{ progressText }}，完成后将自动验签安装…</p>
      </div>

      <div v-else-if="appUpdater.status.value === 'ready'">
        <p class="hint">更新已就绪，重启应用后生效。</p>
        <div class="update__actions">
          <button type="button" class="btn btn--primary" @click="appUpdater.restartApp()">重启应用</button>
        </div>
      </div>

      <div v-else-if="appUpdater.status.value === 'error'">
        <p class="hint update__err">{{ appUpdater.error.value }}</p>
        <div class="update__actions">
          <button type="button" class="btn" @click="checkUpdate">重试</button>
        </div>
      </div>
    </section>
    </div>
  </div>
</template>

<style scoped>
.settings {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 18px 28px 0;
}
.settings__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 2px 24px;
}
.page-title {
  margin: 0 0 18px;
  flex: 0 0 auto;
  font-size: 20px;
}
.card {
  max-width: 640px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 22px 24px;
}
.card + .card {
  margin-top: 16px;
}
.card__title {
  margin: 0 0 14px;
  font-size: 15px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 14px;
  cursor: pointer;
}
.picker {
  margin: 10px 0 0 24px;
}
.input {
  border: 1px solid var(--c-border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 14px;
  font-family: inherit;
  background: var(--c-surface);
  color: var(--c-text);
  min-width: 260px;
}
.input:focus {
  outline: none;
  border-color: var(--c-primary);
}
.hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--c-text-muted);
}

/* —— 应用更新 —— */
.update__current {
  margin: -6px 0 12px;
}
.update__actions {
  margin-top: 12px;
}
.update__version {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text);
}
.update__notes {
  margin: 10px 0 0;
  padding: 10px 12px;
  max-height: 180px;
  overflow-y: auto;
  background: rgba(15, 23, 42, 0.04);
  border-radius: 8px;
  font-size: 12px;
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--c-text-muted);
}
.update__bar {
  margin-top: 12px;
  height: 6px;
  border-radius: 3px;
  background: rgba(15, 23, 42, 0.08);
  overflow: hidden;
}
.update__bar-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--c-primary);
  transition: width 0.2s;
}
.update__bar-fill--indeterminate {
  width: 30% !important;
  animation: update-slide 1.2s ease-in-out infinite;
}
@keyframes update-slide {
  0% { margin-left: -30%; }
  100% { margin-left: 100%; }
}
.update__err {
  color: var(--c-danger);
}
</style>
