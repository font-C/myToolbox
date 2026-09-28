<script setup>
import { useAppStore } from '../stores/app'

const appStore = useAppStore()

function onModeChange(ev) {
  appStore.launchMode = ev.target.value
  if (appStore.launchMode === 'launchpad') appStore.launchPluginId = null
  appStore.saveLaunchConfig()
}

function onPluginChange(ev) {
  appStore.launchPluginId = ev.target.value || null
  appStore.saveLaunchConfig()
}
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
</style>
