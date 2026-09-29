import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { check } from '@tauri-apps/plugin-updater'

/**
 * 主程序自动更新（单例状态，specs/07）：
 * - 启动时静默检查（App.vue），设置页可手动检查 / 下载安装 / 重启
 * - 端点与故障转移配置在 tauri.conf.json（plugins.updater.endpoints）：
 *   GitHub Pages 主源 + Gitee 镜像，与插件商店同一静态目录
 * - 下载与安装由 tauri-plugin-updater 完成，安装包经 minisign 验签后落地
 * - Windows 安装阶段安装器会自行退出应用；macOS 完成后需手动重启（app_restart）
 */
const status = ref('idle') // idle | checking | available | downloading | ready | uptodate | error
const currentVersion = ref('')
const remote = ref(null) // { version, notes, date }
const received = ref(0) // 已下载字节
const total = ref(0) // 总字节（未知为 0）
const error = ref(null)

/** Rust 侧 Update 资源；重查前需 close 释放 */
let pending = null

async function checkAppUpdate({ silent = false } = {}) {
  if (status.value === 'downloading') return
  error.value = null
  if (!silent) status.value = 'checking'
  try {
    if (!currentVersion.value) currentVersion.value = await getVersion()
    const found = await check()
    pending?.close()
    pending = found
    if (found) {
      remote.value = { version: found.version, notes: found.body ?? '', date: found.date ?? '' }
      status.value = 'available'
    } else {
      remote.value = null
      status.value = silent ? 'idle' : 'uptodate'
    }
  } catch (e) {
    pending?.close()
    pending = null
    remote.value = null
    if (silent) {
      status.value = 'idle' // 静默检查失败不打扰，设置页可手动重试
    } else {
      error.value = `检查更新失败：${e}`
      status.value = 'error'
    }
  }
}

async function downloadAndInstall() {
  if (!pending || status.value === 'downloading') return
  status.value = 'downloading'
  error.value = null
  received.value = 0
  total.value = 0
  try {
    await pending.downloadAndInstall((event) => {
      if (event.event === 'Started') total.value = event.data.contentLength ?? 0
      else if (event.event === 'Progress') received.value += event.data.chunkLength
    })
    status.value = 'ready'
  } catch (e) {
    error.value = `下载或安装失败：${e}`
    status.value = 'error'
  }
}

async function restartApp() {
  await invoke('app_restart')
}

export function useAppUpdater() {
  return {
    status,
    currentVersion,
    remote,
    received,
    total,
    error,
    checkAppUpdate,
    downloadAndInstall,
    restartApp,
  }
}
