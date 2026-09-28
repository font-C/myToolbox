#!/usr/bin/env node
/**
 * 「PDF 加密 / 解锁」公众号封面生成
 * 输出：
 *   docs/screenshots/cover-pdfcrypt-1x1.png  1200×1200（主体满幅）
 *   docs/screenshots/cover-pdfcrypt-2x1.png  2400×1200（同一主体居中，左右延展背景）
 */
import { Resvg } from '@resvg/resvg-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'docs', 'screenshots')
fs.mkdirSync(outDir, { recursive: true })

/** 1:1 背景矩形 */
const bgRect = `<rect width="1200" height="1200" fill="url(#bg)"/>`

/** 主体内容（坐标系 1200×1200，返回 <g> 内容，方便 2:1 平移复用） */
function artwork() {
  return `
  <circle cx="180" cy="160" r="260" fill="url(#glow)" fill-opacity="0.55"/>
  <circle cx="1030" cy="1010" r="300" fill="url(#glow2)" fill-opacity="0.5"/>

  <!-- 文档 + 折角 -->
  <g transform="translate(430,150)">
    <path d="M0 0 h250 l110 110 v330 a16 16 0 0 1 -16 16 H16 a16 16 0 0 1 -16 -16 z" fill="#f8fafc"/>
    <path d="M250 0 v110 h110 z" fill="#cbd5e1"/>
    <!-- 文档内容线条 -->
    <g fill="#cbd5e1">
      <rect x="46" y="70" width="180" height="14" rx="7"/>
      <rect x="46" y="110" width="180" height="14" rx="7"/>
      <rect x="46" y="150" width="120" height="14" rx="7"/>
    </g>
    <!-- 大挂锁：压住文档右下 -->
    <g transform="translate(120,150)">
      <rect x="0" y="86" width="200" height="150" rx="22" fill="#f59e0b"/>
      <path d="M42 86 V52 a58 58 0 0 1 116 0 v34" fill="none" stroke="#fbbf24" stroke-width="26" stroke-linecap="round"/>
      <circle cx="100" cy="146" r="19" fill="#0f172a"/>
      <rect x="90" y="156" width="20" height="44" rx="10" fill="#0f172a"/>
    </g>
  </g>

  <!-- 标题 -->
  <text x="600" y="700" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="104" font-weight="800" fill="#ffffff">PDF 加密 / 解锁</text>
  <text x="600" y="790" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="48" font-weight="600" fill="#fbbf24">3 分钟，给文件上一把「安全锁」</text>

  <!-- 标签 -->
  <g font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="34" font-weight="500">
    <rect x="205" y="880" width="240" height="66" rx="33" fill="#1e293b" stroke="#334155" stroke-width="2"/>
    <text x="325" y="925" text-anchor="middle" fill="#e2e8f0">纯本地处理</text>
    <rect x="480" y="880" width="240" height="66" rx="33" fill="#1e293b" stroke="#334155" stroke-width="2"/>
    <text x="600" y="925" text-anchor="middle" fill="#e2e8f0">AES-256 加密</text>
    <rect x="755" y="880" width="240" height="66" rx="33" fill="#1e293b" stroke="#334155" stroke-width="2"/>
    <text x="875" y="925" text-anchor="middle" fill="#e2e8f0">不联网 · 无上传</text>
  </g>

  <!-- 底部小字 -->
  <text x="600" y="1090" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="30" fill="#64748b">忘记密码无法找回 · 请像保管银行卡密码一样保管它</text>`
}

function defs() {
  return `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f172a"/>
      <stop offset="0.55" stop-color="#1e293b"/>
      <stop offset="1" stop-color="#334155"/>
    </linearGradient>
    <linearGradient id="bg2" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1220"/>
      <stop offset="0.25" stop-color="#0f172a"/>
      <stop offset="0.5" stop-color="#1e293b"/>
      <stop offset="0.75" stop-color="#0f172a"/>
      <stop offset="1" stop-color="#0b1220"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#3b82f6" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#3b82f6" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#f59e0b" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#f59e0b" stop-opacity="0"/>
    </radialGradient>
  </defs>`
}

// ---------- 1:1 主体 ----------
const svg1 = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  ${defs()}
  ${bgRect}
  ${artwork()}
</svg>`

// ---------- 2:1：主体居中，左右延展背景 + 弱装饰 ----------
const svg2 = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1200" viewBox="0 0 2400 1200">
  ${defs()}
  <rect width="2400" height="1200" fill="url(#bg2)"/>
  <!-- 左右延展的弱装饰：大号虚线轮廓锁 / 指纹点阵 -->
  <g fill="none" stroke="#f59e0b" stroke-opacity="0.14" stroke-width="14" transform="translate(150,300)">
    <rect x="0" y="86" width="260" height="200" rx="28"/>
    <path d="M54 86 V40 a76 76 0 0 1 152 0 v46" stroke-width="30" stroke-linecap="round"/>
  </g>
  <g fill="#e2e8f0" fill-opacity="0.10" transform="translate(1960,320)">
    ${Array.from({ length: 4 }, (_, r) =>
      Array.from({ length: 4 }, (_, c) => `<rect x="${c * 80}" y="${r * 80}" width="42" height="42" rx="9"/>`).join(''),
    ).join('')}
  </g>
  <text x="300" y="1080" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="36" fill="#475569" font-weight="600">MyToolbox · 本地工具箱</text>
  <text x="2100" y="1080" text-anchor="end" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="36" fill="#475569" font-weight="600">离线 · 无水印 · 免费使用</text>

  <!-- 主体（1:1 构图）整体居中 -->
  <g transform="translate(600,0)">
    ${artwork()}
  </g>
</svg>`

function render(svg, file, w, h) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: w },
    font: { loadSystemFonts: true, defaultFontFamily: 'PingFang SC' },
  })
  const image = resvg.render()
  if (image.width !== w || image.height !== h) {
    throw new Error(`${file}: 尺寸不符 ${image.width}x${image.height}`)
  }
  fs.writeFileSync(path.join(outDir, file), image.asPng())
  console.log(`✓ ${file}（${w}×${h}）`)
}

render(svg1, 'cover-pdfcrypt-1x1.png', 1200, 1200)
render(svg2, 'cover-pdfcrypt-2x1.png', 2400, 1200)
