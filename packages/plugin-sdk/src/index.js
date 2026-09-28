/**
 * @toolbox/plugin-sdk — MyToolbox 插件宿主 API。
 *
 * 插件运行在独立原生窗口（label 形如 `plugin-<id>`），通过 Rust 权限代理（broker）
 * 访问系统能力：文件对话框、已授权路径读写、打印。插件自身不持有任意文件访问权，
 * 所有文件路径必须经用户（对话框 / 拖拽）授予。
 *
 * 约定：插件由 vite 构建，`location.pathname` 第一段即插件 id（宿主以此路由）。
 */
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** 从当前 URL 提取插件 id（pathname 第一段） */
function pluginIdFromLocation() {
  const seg = location.pathname.split('/').filter(Boolean)
  return seg.length > 0 ? seg[0] : null
}

/** 确保参数是 Uint8Array（invoke 返回的 ArrayBuffer 统一包装） */
function asBytes(data) {
  if (data instanceof Uint8Array) return data
  return new Uint8Array(data ?? [])
}

/** 文件名提取（兼容 / 与 \ 分隔符） */
function baseName(p) {
  return p.split(/[\\/]/).pop() ?? p
}

function toFiles(paths) {
  return (paths ?? []).map((p) => ({ path: p, name: baseName(p) }))
}

let envCache = null

export const toolbox = {
  /** 当前插件 id（来自 URL，与窗口 label 对应） */
  get pluginId() {
    return pluginIdFromLocation()
  },

  /**
   * 宿主环境信息。{ pluginId, platform, hostVersion, apiVersion }
   * apiVersion 为宿主支持的 SDK 契约版本。
   */
  async getEnv() {
    if (!envCache) {
      envCache = await invoke('broker_env')
    }
    return envCache
  },

  /**
   * 打开系统文件选择对话框（需 manifest 声明 dialog:open）。
   * @param {{ filters?: {name: string, extensions: string[]}[], multiple?: boolean }} options
   * @returns {Promise<{path: string, name: string, bytes: Uint8Array}[]>} 用户取消返回 []
   * 选中路径自动记入本插件的会话授权表，后续可用 readGranted 重新读取。
   */
  async pickOpenFile(options = {}) {
    const files = await invoke('broker_open_file', {
      filters: options.filters ?? null,
      multiple: options.multiple ?? false,
    })
    return files.map((f) => ({ ...f, bytes: asBytes(f.bytes) }))
  },

  /**
   * 打开系统保存对话框并写入字节（需 manifest 声明 dialog:save 与 fs:write）。
   * @param {{ defaultName?: string, filters?: {name: string, extensions: string[]}[], bytes?: Uint8Array|ArrayBuffer|null }} options
   * @returns {Promise<string|null>} 用户取消返回 null；提供了 bytes 则写盘成功后返回路径
   * 目标路径记入授权表，后续可用 readGranted 读取。
   */
  async pickSaveFile(options = {}) {
    return invoke('broker_save_file', {
      defaultName: options.defaultName ?? null,
      filters: options.filters ?? null,
      bytes: options.bytes ? asBytes(options.bytes) : null,
    })
  },

  /**
   * 读取本插件已授权的路径（需 manifest 声明 fs:read）。
   * 授权来源：pickOpenFile 选中的文件、拖拽进窗口的文件、pickSaveFile 的目标。
   * @returns {Promise<Uint8Array>}
   */
  async readGranted(path) {
    return asBytes(await invoke('broker_read_granted', { path }))
  },

  /** 调起系统打印（需 manifest 声明 print）。当前支持 PDF 字节。 */
  async printPdf(bytes) {
    return invoke('broker_print', { bytes: asBytes(bytes) })
  },

  /**
   * 读取系统剪贴板文本（需 manifest 声明 clipboard:read）。
   * 剪贴板为空或当前内容不是文本时返回 null。
   * @returns {Promise<string|null>}
   */
  async readClipboardText() {
    return invoke('broker_clipboard_read_text')
  },

  /**
   * 写入系统剪贴板文本（需 manifest 声明 clipboard:write）。
   * @param {string} text
   * @returns {Promise<void>}
   */
  async writeClipboardText(text) {
    return invoke('broker_clipboard_write_text', { text })
  },

  /**
   * 压缩 PDF（需 manifest 声明 pdf:optimize）。重编码内嵌图像（有损），
   * 文字保持矢量可选中；若文档几乎没有图像则收益有限。
   * @param {Uint8Array|ArrayBuffer} bytes
   * @param {'light'|'recommended'|'extreme'} [preset] 轻 / 推荐 / 极限，默认 recommended
   * @returns {Promise<Uint8Array>}
   */
  async compressPdf(bytes, preset = 'recommended') {
    return asBytes(await invoke('broker_compress_pdf', { bytes: asBytes(bytes), preset }))
  },

  /**
   * 为 PDF 设置打开密码（需 manifest 声明 pdf:crypt）。AES-256（PDF 2.0 标准），
   * 与主流阅读器互通；所有者密码缺省与打开密码相同。
   * @param {Uint8Array|ArrayBuffer} bytes
   * @param {{ userPassword: string, ownerPassword?: string }} options
   * @returns {Promise<Uint8Array>}
   */
  async encryptPdf(bytes, { userPassword, ownerPassword } = {}) {
    if (!userPassword) throw new Error('请提供 userPassword（打开密码）')
    return asBytes(await invoke('broker_encrypt_pdf', {
      bytes: asBytes(bytes),
      userPassword,
      ownerPassword: ownerPassword ?? null,
    }))
  },

  /**
   * 去除 PDF 打开密码（需 manifest 声明 pdf:crypt）。支持 RC4 / AES-128 / AES-256；
   * 密码错误时 rejected。
   * @param {Uint8Array|ArrayBuffer} bytes
   * @param {string} password
   * @returns {Promise<Uint8Array>}
   */
  async unlockPdf(bytes, password) {
    return asBytes(await invoke('broker_unlock_pdf', { bytes: asBytes(bytes), password }))
  },

  /**
   * 监听原生文件拖拽（进入/悬停/离开/放下）。drop 的文件路径已由宿主自动记入授权表。
   * @param {{ onEnter?: (files) => void, onOver?: () => void, onLeave?: () => void,
   *          onDrop?: (files: {path: string, name: string}[]) => void }} handlers
   * @returns {() => void} 取消监听函数
   */
  onDragDrop(handlers) {
    const dispose = { fn: null, disposed: false }
    getCurrentWebview()
      .onDragDropEvent((ev) => {
        const t = ev.payload?.type
        if (t === 'enter') handlers.onEnter?.(toFiles(ev.payload.paths))
        else if (t === 'over') handlers.onOver?.()
        else if (t === 'leave') handlers.onLeave?.()
        else if (t === 'drop') handlers.onDrop?.(toFiles(ev.payload.paths))
      })
      .then((fn) => {
        if (dispose.disposed) fn()
        else dispose.fn = fn
      })
    return () => {
      dispose.disposed = true
      dispose.fn?.()
    }
  },

  /** 关闭本插件窗口 */
  async close() {
    return getCurrentWindow().close()
  },
}

export default toolbox

export { useNativeFileDrop, isTauri } from './drop.js'
