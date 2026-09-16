// 判断当前运行环境是否在 Tauri 桌面容器内
// - 打包后的 Tauri 应用 / `npm run tauri dev`：window.__TAURI_INTERNALS__ 存在
// - 纯浏览器（npm run dev 预览）：不存在
export const IS_TAURI =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window