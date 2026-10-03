import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 浏览器测试构建：把 @toolbox/plugin-sdk 精确替换为 mock-sdk.js（theme.css 仍用真实样式）
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
    ],
  },
  build: { outDir: 'dist' },
})
