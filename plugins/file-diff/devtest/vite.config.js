import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { nodeShims } from '../src/shims/aliases.js'

// 浏览器测试构建：把 @toolbox/plugin-sdk 精确替换为 mock-sdk.js（theme.css 仍用真实样式）
// 另需注入 Node 内置模块 alias：mock 流程会触发 word-extractor / mammoth 的依赖预打包
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [vue()],
  resolve: {
    alias: [
      {
        find: /^@toolbox\/plugin-sdk$/,
        replacement: fileURLToPath(new URL('./mock-sdk.js', import.meta.url)),
      },
      ...Object.entries(nodeShims).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
  optimizeDeps: { esbuildOptions: { alias: nodeShims } },
  build: { outDir: 'dist' },
})
