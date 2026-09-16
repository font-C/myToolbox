<script setup>
import { computed } from 'vue'
import HomePage from './views/HomePage.vue'
import { useAppStore } from './stores/app'

const appStore = useAppStore()

// activeTool 为 undefined 时显示启动台首页
const activeTool = computed(() => appStore.activeTool)
const isHome = computed(() => !activeTool.value)
</script>

<template>
  <div class="app">
    <!-- 工具内顶部返回栏 -->
    <header v-if="!isHome" class="app__bar">
      <button type="button" class="app__back" @click="appStore.goHome()">
        <span class="app__back-icon">‹</span>
        <span>返回</span>
      </button>
      <span class="app__bar-title">{{ activeTool.icon }} {{ activeTool.name }} · 工具箱</span>
    </header>

    <!-- 首页 or 当前工具 -->
    <component :is="isHome ? HomePage : activeTool.component" class="app__body" />
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
  gap: 12px;
  padding: 8px 16px;
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
  flex: 0 0 auto;
}

.app__back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--c-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
  font-family: inherit;
  transition: background 0.15s;
}
.app__back:hover {
  background: rgba(59, 130, 246, 0.1);
}
.app__back-icon {
  font-size: 20px;
  line-height: 1;
}

.app__bar-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-muted);
}

.app__body {
  flex: 1;
  overflow: hidden;
}
</style>