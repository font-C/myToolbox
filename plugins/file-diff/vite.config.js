import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vite'
import { pluginPreset } from '@toolbox/plugin-sdk/preset'
import { nodeShims } from './src/shims/aliases.js'

// pluginPreset 返回回调形式配置（内部依赖 command），先调用展开再合并
export default defineConfig(({ command }) => {
  const preset = pluginPreset({ id: 'file-diff' })
  const base = typeof preset === 'function' ? preset({ command }) : preset
  return mergeConfig(base, {
    resolve: { alias: nodeShims },
    // dev 预打包（esbuild）同样需要 alias，否则扫描依赖时报 Node 内置模块无法解析
    optimizeDeps: { esbuildOptions: { alias: nodeShims } },
  })
})
