import { createApp } from 'vue'
import App from '../src/App.vue'
import '../../../packages/plugin-sdk/src/theme.css'

createApp(App).mount('#app')

// 测试辅助:生成 n 张不同宽高比的纯色测试图,注入共享图片库
import { addFiles } from '../src/images.js'

const PALETTE = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#eab308', '#06b6d4', '#a855f7', '#22c55e', '#f43f5e', '#0ea5e9']
const SIZES = [
  [800, 800],
  [600, 900],
  [900, 600],
  [500, 500],
  [1200, 600],
  [600, 1200],
  [700, 700],
  [640, 480],
  [480, 640],
  [900, 900],
  [500, 800],
  [800, 500],
  [660, 660],
  [720, 540],
  [540, 720],
]

window.devtest = {
  addSampleImages(n = 9) {
    const files = []
    for (let i = 0; i < n; i++) {
      const [w, h] = SIZES[i % SIZES.length]
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = PALETTE[i % PALETTE.length]
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = `bold ${Math.round(Math.min(w, h) * 0.42)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(i + 1), w / 2, h / 2)
      const dataUrl = canvas.toDataURL('image/png')
      const bin = atob(dataUrl.split(',')[1])
      const bytes = new Uint8Array(bin.length)
      for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j)
      files.push(new File([bytes], `样例${i + 1}.png`, { type: 'image/png' }))
    }
    addFiles(files)
  },
}
