<script setup>
import { useAppStore } from '../stores/app'
import { tools } from '../tools/registry'

const appStore = useAppStore()
</script>

<template>
  <div class="home">
    <div class="home__backdrop"></div>
    <main class="home__content">
      <header class="home__header">
        <h1 class="home__title">工具箱</h1>
        <p class="home__subtitle">选择要使用的工具</p>
      </header>

      <div class="home__grid">
        <button
          v-for="tool in tools"
          :key="tool.id"
          type="button"
          class="home-tool"
          @click="appStore.openTool(tool.id)"
        >
          <span class="home-tool__icon">{{ tool.icon }}</span>
          <span class="home-tool__name">{{ tool.name }}</span>
          <span class="home-tool__desc">{{ tool.desc }}</span>
        </button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.home {
  position: relative;
  height: 100%;
  overflow: auto;
}

/* 半透明 + 模糊的启动台背景 */
.home__backdrop {
  position: absolute;
  inset: 0;
  background: linear-gradient(160deg, #dbeafe 0%, var(--c-bg) 45%, #e0e7ff 100%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  z-index: 0;
}

.home__content {
  position: relative;
  z-index: 1;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 32px;
}

.home__header {
  text-align: center;
  margin-bottom: 40px;
}
.home__title {
  margin: 0;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 1px;
}
.home__subtitle {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--c-text-muted);
}
.home__icon-mark {
  font-size: 40px;
}

.home__grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 28px;
  max-width: 860px;
}

.home-tool {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 132px;
  padding: 18px 10px;
  background: transparent;
  border: none;
  border-radius: 16px;
  cursor: pointer;
  font-family: inherit;
  transition: transform 0.15s ease, background 0.15s ease;
}
.home-tool:hover {
  transform: translateY(-4px) scale(1.04);
  background: rgba(255, 255, 255, 0.5);
}
.home-tool:active {
  transform: translateY(0) scale(0.98);
}

.home-tool__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 84px;
  height: 84px;
  font-size: 42px;
  background: var(--c-surface);
  border-radius: 22px;
  box-shadow: var(--shadow), 0 8px 22px rgba(59, 130, 246, 0.18);
  transition: box-shadow 0.15s ease;
}
.home-tool:hover .home-tool__icon {
  box-shadow: var(--shadow), 0 12px 28px rgba(59, 130, 246, 0.28);
}

.home-tool__name {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
}
.home-tool__desc {
  font-size: 12px;
  color: var(--c-text-muted);
  text-align: center;
}
</style>