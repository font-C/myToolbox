/**
 * 原生文件拖拽（SDK 内置）：
 * - 宿主在 Rust 侧把拖入窗口的文件路径记入本插件授权表，drop 事件到达后经
 *   toolbox.readGranted 读取字节并还原为 File 对象
 * - 纯浏览器（非 Tauri 容器）下不起作用，由组件保留的 HTML5 onDrop 兜底
 * - 用法：const stop = useNativeFileDrop({ onFiles(files), onDragState(bool) })，
 *   组件卸载时调用 stop()
 */
import { toolbox } from './index.js'

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

function extOf(name) {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

export function isTauri() {
  return '__TAURI_INTERNALS__' in window
}

async function pathToFile(filePath) {
  const name = filePath.split(/[\\/]/).pop() || 'file'
  const bytes = await toolbox.readGranted(filePath)
  const type = MIME_BY_EXT[extOf(name)] || 'application/octet-stream'
  const blob = new Blob([bytes], { type })
  return new File([blob], name, { type })
}

export function useNativeFileDrop({ onFiles, onDragState } = {}) {
  if (!isTauri()) return () => {}

  return toolbox.onDragDrop({
    onEnter: () => onDragState?.(true),
    onOver: () => onDragState?.(true),
    onLeave: () => onDragState?.(false),
    onDrop: async (files) => {
      onDragState?.(false)
      if (!files?.length) return
      const result = []
      for (const f of files) {
        try {
          result.push(await pathToFile(f.path))
        } catch (e) {
          console.error('读取拖拽文件失败:', f.path, e)
        }
      }
      if (result.length) onFiles?.(result)
    },
  })
}
