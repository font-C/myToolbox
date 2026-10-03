/**
 * pic-merge devtest mock SDK — 浏览器测试环境用。
 * 替换 @toolbox/plugin-sdk,保存走 console + mock 路径,无 Tauri。
 */

export const toolbox = {
  async pickSaveFile(options) {
    console.log('[mock] save →', options?.defaultName, `${options?.bytes?.length ?? 0} bytes`)
    ;(window.__saves = window.__saves || []).push({
      defaultName: options?.defaultName,
      len: options?.bytes?.length ?? 0,
      bytes: options?.bytes,
    })
    return '/mock/' + (options?.defaultName || 'out')
  },
  async close() {},
}

export function useNativeFileDrop() {
  return () => {}
}

export async function isTauri() {
  return false
}

export default toolbox
