import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Vite config optimized for Tauri (no need to map frontend to a fixed URL in dev)
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  // Tauri expects a fixed port and uses a specific output for the built assets
  build: {
    target: 'es2021',
    outDir: 'dist',
    assetsDir: 'assets',
  },
})