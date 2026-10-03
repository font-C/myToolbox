<script setup>
import { computed, reactive, watch, onMounted } from 'vue'
import { useAppStore } from '../stores/app'
import { useStore } from '../composables/useStore'

const appStore = useAppStore()
const store = useStore()

const entries = computed(() => store.index.value?.plugins ?? [])
const updatedAt = computed(() => {
  const t = store.index.value?.updatedAt
  return t ? new Date(t).toLocaleString() : null
})

const stateLabels = { installable: '安装', updatable: '更新', installed: '已安装' }

// ---------- 图标：经 Rust 代理拉取后转 data URL ----------
//
// Gitee raw 的防盗链跳转让 webview 直接 <img> 加载不可靠（GitHub 直连可用，
// 但统一走代理可两源行为一致），失败时显示名称首字母占位。
const iconUrls = reactive({}) // 绝对 URL → data URL（未设置 = 加载中或失败）

function iconRemoteUrl(entry) {
  try {
    return new URL(entry.icon ?? 'icon.png', appStore.activeStoreUrl).href
  } catch {
    return ''
  }
}

function iconOf(entry) {
  const url = iconRemoteUrl(entry)
  return url ? iconUrls[url] || '' : ''
}

async function resolveIcons() {
  const urls = [...new Set(entries.value.map(iconRemoteUrl).filter(Boolean))]
  await Promise.all(
    urls.map(async (url) => {
      if (iconUrls[url]) return
      const data = await store.fetchIcon(url)
      if (data) iconUrls[url] = data
    })
  )
}
watch(entries, resolveIcons, { immediate: true })

function sizeText(bytes) {
  if (!bytes) return ''
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}

async function onInstall(entry) {
  if (store.isInstalling(entry.id)) return
  try {
    await store.install(entry)
  } catch (e) {
    store.error.value = `安装失败：${e}`
  }
}

function switchSource(url) {
  appStore.setActiveStore(url)
  store.fetchIndex()
}

onMounted(() => store.fetchIndex())
</script>

<template>
  <div class="store">
    <div class="store__head">
      <h2 class="page-title">商店</h2>
      <div class="store__sources">
        <button
          v-for="s in appStore.storeSources"
          :key="s.url"
          type="button"
          class="src-chip"
          :class="{ 'src-chip--on': s.url === appStore.activeStoreUrl }"
          @click="switchSource(s.url)"
        >
          {{ s.name }}
        </button>
        <button type="button" class="btn store__refresh" :disabled="store.loading.value" @click="store.fetchIndex()">
          {{ store.loading.value ? '加载中…' : '刷新' }}
        </button>
      </div>
    </div>

    <div class="store__scroll">
    <p v-if="store.fromCache.value" class="warn">当前显示的是缓存数据（最近一次成功加载）。</p>
    <p v-if="store.error.value" class="err">{{ store.error.value }}</p>
    <p v-else-if="updatedAt" class="meta">索引更新时间：{{ updatedAt }}</p>

    <div class="grid">
      <div v-for="entry in entries" :key="entry.id" class="card">
        <img v-if="iconOf(entry)" class="card__icon" :src="iconOf(entry)" :alt="entry.name" />
        <span v-else class="card__icon card__icon--ph">{{ (entry.name || '?').slice(0, 1) }}</span>
        <div class="card__main">
          <div class="card__title">
            <span class="card__name">{{ entry.name }}</span>
            <span class="card__version">v{{ entry.version }}</span>
            <span v-if="store.installStateOf(entry) === 'updatable'" class="card__badge">有更新</span>
          </div>
          <div class="card__desc">{{ entry.description }}</div>
          <div class="card__meta">
            <span>{{ entry.author }}</span>
            <span v-if="sizeText(entry.size)">· {{ sizeText(entry.size) }}</span>
            <span>· 权限：{{ entry.permissions?.length ? entry.permissions.join(' / ') : '无特殊权限' }}</span>
          </div>
        </div>
        <button
          type="button"
          class="btn card__action"
          :class="{ 'btn--primary': store.installStateOf(entry) !== 'installed' }"
          :disabled="store.installStateOf(entry) === 'installed' || store.isInstalling(entry.id)"
          @click="onInstall(entry)"
        >
          {{ store.isInstalling(entry.id) ? '安装中…' : stateLabels[store.installStateOf(entry)] }}
        </button>
      </div>

      <p v-if="!store.loading.value && !entries.length && !store.error.value" class="empty">
        这个源还没有上架插件。
      </p>
    </div>
    </div>
  </div>
</template>

<style scoped>
.store {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 18px 28px 0;
}
.store__head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  padding-bottom: 10px;
  margin-bottom: 14px;
}
.page-title {
  margin: 0;
  font-size: 20px;
}
.store__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 2px 24px;
}
.store__sources {
  display: flex;
  align-items: center;
  gap: 8px;
}
.src-chip {
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-text-muted);
  border-radius: 999px;
  padding: 5px 14px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}
.src-chip--on {
  border-color: var(--c-primary);
  color: var(--c-primary);
  background: rgba(59, 130, 246, 0.1);
}
.store__refresh {
  font-size: 13px;
  padding: 5px 14px;
}

.warn,
.err,
.meta {
  max-width: 760px;
  margin: 0 0 14px;
  font-size: 13px;
}
.warn {
  color: #a16207;
  background: rgba(234, 179, 8, 0.12);
  padding: 8px 12px;
  border-radius: 8px;
}
.err {
  color: var(--c-danger);
  background: rgba(239, 68, 68, 0.08);
  padding: 8px 12px;
  border-radius: 8px;
}
.meta {
  color: var(--c-text-muted);
}

.grid {
  max-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 14px 16px;
}
.card__icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  object-fit: cover;
  flex: 0 0 auto;
}
.card__icon--ph {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  background: linear-gradient(135deg, #60a5fa, #3b82f6);
  user-select: none;
}
.card__main {
  flex: 1;
  min-width: 0;
}
.card__title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.card__name {
  font-size: 15px;
  font-weight: 600;
}
.card__version {
  font-size: 12px;
  color: var(--c-text-muted);
}
.card__badge {
  font-size: 11px;
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
  padding: 2px 8px;
  border-radius: 999px;
}
.card__desc {
  font-size: 13px;
  color: var(--c-text-muted);
  margin-top: 2px;
}
.card__meta {
  font-size: 12px;
  color: var(--c-text-muted);
  margin-top: 4px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.card__action {
  flex: 0 0 auto;
}
.card__action:disabled {
  opacity: 0.5;
}
.empty {
  color: var(--c-text-muted);
  text-align: center;
  padding: 40px 0;
}
</style>
