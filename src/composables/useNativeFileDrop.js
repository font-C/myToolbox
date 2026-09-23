import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { IS_TAURI } from '../utils/env'

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

function extOf(name) {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

/** native 事件只给路径，需经 read_path 读字节并还原为 File 对象。 */
async function pathToFile(filePath) {
  const name = filePath.split(/[\\/]/).pop() || 'file'
  const bytes = await invoke('read_path', { path: filePath })
  const type = MIME_BY_EXT[extOf(name)] || 'application/octet-stream'
  const blob = new Blob([new Uint8Array(bytes)], { type })
  return new File([blob], name, { type })
}

/**
 * 在 Tauri 桌面容器内监听原生拖拽放下的文件路径，读取并还原成 File 数组交给 onFiles。
 * 纯浏览器（非 Tauri）不起作用，由各组件保留的 HTML5 onDrop 兜底。
 * 返回解绑函数，供 onUnmounted 调用。
 */
export function useNativeFileDrop({ onFiles, onDragState } = {}) {
  if (!IS_TAURI) return () => {}

  let unlisten = () => {}
  const webview = getCurrentWebview()

  webview
    .onDragDropEvent(async (event) => {
      // Tauri v2 EventCallback 把事件包一层 payload：event.payload.type / paths
      const ev = event?.payload || event
      switch (ev.type) {
        case 'enter':
        case 'over':
          onDragState?.(true)
          break
        case 'leave':
          onDragState?.(false)
          break
        case 'drop':
          onDragState?.(false)
          if (!ev.paths?.length) return
          const files = []
          for (const p of ev.paths) {
            try {
              files.push(await pathToFile(p))
            } catch (e) {
              console.error('读取拖拽文件失败:', p, e)
            }
          }
          if (files.length) onFiles?.(files)
          break
      }
    })
    .then((fn) => {
      unlisten = fn
    })
    .catch(() => {})

  return () => unlisten()
}