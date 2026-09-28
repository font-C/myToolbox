<script setup>
import { useAppStore } from '../stores/app'

const appStore = useAppStore()
</script>

<template>
  <div class="home">
    <main class="home__content">
      <header class="home__header">
        <h1 class="home__title">工具箱</h1>
        <p class="home__subtitle">选择要使用的工具</p>
      </header>

      <div class="home__scroll">
      <div v-if="appStore.enabledPlugins.length" class="home__grid">
        <button
          v-for="plugin in appStore.enabledPlugins"
          :key="plugin.id"
          type="button"
          class="home-tool"
          :title="plugin.manifest.description"
          @click="appStore.openTool(plugin.id)"
        >
          <span class="home-tool__icon">
            <img :src="plugin.iconUrl" :alt="plugin.manifest.name" draggable="false" />
          </span>
          <span class="home-tool__name">{{ plugin.manifest.name }}</span>
          <span class="home-tool__desc">{{ plugin.manifest.description }}</span>
          <span v-if="plugin.running" class="home-tool__running">运行中</span>
        </button>
      </div>

      <div v-else class="home__empty">
        <p>还没有可用的插件。</p>
        <button type="button" class="btn btn--primary" @click="appStore.setView('store')">
          去商店逛逛
        </button>
      </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* 启动台背景：固定在视口（不随内容滚动，永不露白） */
.home__backdrop {
  position: fixed;
  inset: 0;
  background: linear-gradient(160deg, #dbeafe 0%, var(--c-bg) 45%, #e0e7ff 100%);
  z-index: 0;
  pointer-events: none;
}

.home {
  position: relative;
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
.home__content {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 40px 32px 48px;
}
.home__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 4px 2px 8px;
}
.home__scroll .home__grid,
.home__scroll .home__empty {
  margin: auto 0;
}

.home__header {
  flex: 0 0 auto;
  text-align: center;
  margin-bottom: 36px;
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

.home__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 26px 18px;
  width: 100%;
  max-width: 1240px;
  margin: 0 auto auto;
}

.home-tool {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: auto;
  min-width: 0;
  padding: 18px 8px;
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
  background: var(--c-surface);
  border-radius: 22px;
  box-shadow: var(--shadow), 0 8px 22px rgba(59, 130, 246, 0.18);
  transition: box-shadow 0.15s ease;
  overflow: hidden;
}
.home-tool__icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.home-tool__running {
  position: absolute;
  top: 14px;
  right: 12px;
  font-size: 10px;
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
  padding: 2px 6px;
  border-radius: 999px;
}

.home__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: var(--c-text-muted);
}
</style>
