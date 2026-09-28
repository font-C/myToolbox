/**
 * @toolbox/plugin-sdk preset — 插件 Vite 构建预设。
 *
 * - 构建产物使用相对路径（base: './'），保证在 plugin:// 自定义协议下可加载
 * - 开发模式按插件 id 作为 base 前缀（`/<id>/`），使 location.pathname 第一段
 *   始终是插件 id，与打包后行为一致
 * - 目标 es2021，产物输出 dist/（scripts/build-plugin.mjs 会将其打包为 .tbox）
 *
 * 用法（插件 vite.config.js）：
 *   import { pluginPreset } from '@toolbox/plugin-sdk/preset'
 *   export default pluginPreset({ id: 'mental-math' })
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export function pluginPreset({ id, vue: useVue = true } = {}) {
  if (!id) throw new Error('pluginPreset 需要传入插件 id：pluginPreset({ id: "..." })')
  return defineConfig(({ command }) => ({
    base: command === 'serve' ? `/${id}/` : './',
    plugins: useVue ? [vue()] : [],
    clearScreen: false,
    server: {
      port: 5180,
      strictPort: false,
    },
    build: {
      target: 'es2021',
      outDir: 'dist',
      assetsDir: 'assets',
      emptyOutDir: true,
    },
  }))
}
