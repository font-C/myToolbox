#!/usr/bin/env node
/**
 * 插件图标生成 v2：按各工具功能绘制专属图形（渐变底 + 白色功能图形），
 * 经 @resvg/resvg 渲染为 512×512 PNG，覆盖 plugins/<id>/icon.png。
 *
 * 用法：node scripts/gen-plugin-icons.mjs [--only=<id>]
 */
import { Resvg } from '@resvg/resvg-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---- 白色功能图形库（240×240 画布） ----
const G = {
  // 二维码：三个定位眼 + 数据点阵
  qr: `
    <g fill="#fff">
      <rect x="40" y="40" width="62" height="62" rx="10"/>
      <rect x="138" y="40" width="62" height="62" rx="10"/>
      <rect x="40" y="138" width="62" height="62" rx="10"/>
    </g>
    <g fill="#1e293b">
      <rect x="58" y="58" width="26" height="26" rx="4"/>
      <rect x="156" y="58" width="26" height="26" rx="4"/>
      <rect x="58" y="156" width="26" height="26" rx="4"/>
    </g>
    <g fill="#fff">
      <rect x="140" y="140" width="16" height="16" rx="3"/>
      <rect x="164" y="140" width="16" height="16" rx="3"/>
      <rect x="188" y="140" width="16" height="16" rx="3"/>
      <rect x="140" y="164" width="16" height="16" rx="3"/>
      <rect x="188" y="164" width="16" height="16" rx="3"/>
      <rect x="140" y="188" width="16" height="16" rx="3"/>
      <rect x="164" y="188" width="16" height="16" rx="3"/>
    </g>`,
  // 图片压缩：照片（山+太阳）+ 向下压缩箭头
  imageCompress: `
    <rect x="36" y="44" width="168" height="124" rx="12" fill="#fff"/>
    <circle cx="78" cy="82" r="15" fill="#38bdf8"/>
    <path d="M48 152 L96 102 L134 144 L158 122 L192 152 L192 158 L48 158 Z" fill="#34d399"/>
    <path d="M128 184 h24 v16 h14 l-26 24 -26 -24 h14 z" fill="#fff"/>`,
  // 生活计算：计算器（屏幕 + 按键，一枚橙色等号键）
  calc: `
    <rect x="58" y="34" width="124" height="172" rx="16" fill="#fff"/>
    <rect x="74" y="50" width="92" height="34" rx="6" fill="#0f172a"/>
    <g fill="#0f172a">
      <rect x="74" y="98" width="40" height="22" rx="5"/>
      <rect x="126" y="98" width="40" height="22" rx="5"/>
      <rect x="74" y="130" width="40" height="22" rx="5"/>
      <rect x="126" y="130" width="40" height="22" rx="5"/>
      <rect x="74" y="162" width="40" height="22" rx="5"/>
    </g>
    <rect x="126" y="162" width="40" height="22" rx="5" fill="#f59e0b"/>`,
  // 剪贴板历史：剪贴板 + 时钟
  clipboard: `
    <rect x="52" y="44" width="136" height="164" rx="14" fill="#fff"/>
    <rect x="92" y="30" width="56" height="28" rx="9" fill="#fff" stroke="#0f172a" stroke-width="6"/>
    <g fill="#0f172a" fill-opacity="0.85">
      <rect x="72" y="86" width="96" height="10" rx="5"/>
      <rect x="72" y="112" width="96" height="10" rx="5"/>
      <rect x="72" y="138" width="56" height="10" rx="5"/>
    </g>
    <circle cx="162" cy="162" r="34" fill="#0f172a"/>
    <path d="M162 144 v20 h16" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  // 文本工具：文档 + Aa
  text: `
    <rect x="48" y="34" width="144" height="180" rx="14" fill="#fff"/>
    <text x="66" y="108" font-family="Helvetica, Arial, sans-serif" font-size="54" font-weight="800" fill="#0f172a">Aa</text>
    <g fill="#0f172a" fill-opacity="0.85">
      <rect x="68" y="128" width="104" height="9" rx="4.5"/>
      <rect x="68" y="150" width="104" height="9" rx="4.5"/>
      <rect x="68" y="172" width="66" height="9" rx="4.5"/>
    </g>`,
  // 密码生成：三个密码点 + 钥匙
  password: `
    <g fill="#fff">
      <circle cx="74" cy="80" r="16"/>
      <circle cx="120" cy="80" r="16"/>
      <circle cx="166" cy="80" r="16"/>
    </g>
    <circle cx="92" cy="152" r="33" fill="none" stroke="#fff" stroke-width="14"/>
    <path d="M114 152 h60 v18 h-15 v16 h-14 v-16 h-31 z" fill="#fff"/>`,
  // 课堂工具：铃铛
  class: `
    <path d="M120 40 c34 0 52 26 54 58 l4 44 c1 10 6 16 12 20 v10 H50 v-10 c6 -4 11 -10 12 -20 l4 -44 c2 -32 20 -58 54 -58 z" fill="#fff"/>
    <path d="M100 176 a20 20 0 0 0 40 0 z" fill="#fff"/>
    <circle cx="120" cy="36" r="9" fill="#fff"/>`,
  // PDF 系公共：文件折角
  doc: `
    <path d="M64 32 h76 l40 40 v134 a10 10 0 0 1 -10 10 H74 a10 10 0 0 1 -10 -10 V42 a10 10 0 0 1 10 -10 z" fill="#fff"/>
    <path d="M140 32 v40 h40 z" fill="#cbd5e1"/>`,
  // 裁剪：双裁切线
  crop: `
    <path d="M88 62 v94 h94" fill="none" stroke="#0f172a" stroke-width="14" stroke-linecap="round"/>
    <path d="M152 178 V86 H58" fill="none" stroke="#0f172a" stroke-width="14" stroke-linecap="round"/>`,
  // 拼接：两块叠合拼版
  compose: `
    <rect x="52" y="52" width="84" height="84" rx="10" fill="#0f172a" fill-opacity="0.8"/>
    <rect x="104" y="104" width="84" height="84" rx="10" fill="#0f172a"/>
    <rect x="114" y="114" width="64" height="64" rx="7" fill="#fff"/>`,
  // 压缩：向下大箭头压到横杆
  compress: `
    <path d="M120 60 h44 v54 h30 l-52 58 -52 -58 h30 z" fill="#0f172a"/>
    <rect x="56" y="176" width="128" height="18" rx="9" fill="#0f172a"/>`,
  // 加密：挂锁
  crypt: `
    <rect x="60" y="112" width="120" height="92" rx="14" fill="#0f172a"/>
    <path d="M88 112 V88 a32 32 0 0 1 64 0 v24" fill="none" stroke="#0f172a" stroke-width="16" stroke-linecap="round"/>
    <circle cx="120" cy="150" r="12" fill="#fff"/>
    <rect x="114" y="158" width="12" height="22" rx="6" fill="#fff"/>`,
  // 拆分：一份分两份（双向箭头 + 两个文件块）
  split: `
    <rect x="44" y="88" width="64" height="76" rx="10" fill="#0f172a"/>
    <rect x="132" y="88" width="64" height="76" rx="10" fill="#0f172a"/>
    <path d="M104 126 l18 -14 v10 h6 v8 h-6 v10 z" fill="#fff"/>
    <path d="M136 126 l-18 -14 v10 h-6 v8 h6 v10 z" fill="#fff"/>`,
  // GIF 表情包：胶片帧序列（三格连排 + 播放三角）
  gifMaker: `
    <rect x="34" y="74" width="58" height="92" rx="8" fill="#fff" fill-opacity="0.55"/>
    <rect x="91" y="66" width="58" height="108" rx="8" fill="#fff"/>
    <rect x="148" y="74" width="58" height="92" rx="8" fill="#fff" fill-opacity="0.55"/>
    <g fill="#0f172a" fill-opacity="0.55">
      <rect x="42" y="82" width="42" height="7" rx="3.5"/>
      <rect x="42" y="96" width="42" height="7" rx="3.5"/>
      <rect x="157" y="82" width="42" height="7" rx="3.5"/>
      <rect x="157" y="96" width="42" height="7" rx="3.5"/>
    </g>
    <path d="M108 100 l30 20 -30 20 z" fill="#0f172a"/>
    <rect x="99" y="88" width="42" height="9" rx="4.5" fill="#0f172a" fill-opacity="0.35"/>`,
  // 拼长图：两图纵向拼接 + 分隔线
  picMerge: `
    <rect x="60" y="34" width="120" height="78" rx="10" fill="#fff"/>
    <circle cx="92" cy="60" r="11" fill="#38bdf8"/>
    <path d="M70 102 L100 70 L122 94 L138 80 L170 104 L170 106 L70 106 Z" fill="#34d399"/>
    <rect x="60" y="122" width="120" height="84" rx="10" fill="#fff"/>
    <g fill="#0f172a" fill-opacity="0.85">
      <rect x="78" y="140" width="84" height="9" rx="4.5"/>
      <rect x="78" y="160" width="84" height="9" rx="4.5"/>
      <rect x="78" y="180" width="52" height="9" rx="4.5"/>
    </g>`,
  // 智能排课：课程表网格（一枚格子打勾）+ 顶部装订环
  scheduler: `
    <rect x="44" y="52" width="152" height="144" rx="16" fill="#fff"/>
    <g fill="#0f172a">
      <rect x="70" y="38" width="12" height="26" rx="6"/>
      <rect x="158" y="38" width="12" height="26" rx="6"/>
    </g>
    <g fill="#0f172a" fill-opacity="0.7">
      <rect x="60" y="90" width="36" height="24" rx="6"/>
      <rect x="102" y="90" width="36" height="24" rx="6"/>
      <rect x="144" y="90" width="36" height="24" rx="6"/>
      <rect x="60" y="124" width="36" height="24" rx="6"/>
      <rect x="144" y="124" width="36" height="24" rx="6"/>
      <rect x="60" y="158" width="36" height="24" rx="6"/>
      <rect x="102" y="158" width="36" height="24" rx="6"/>
    </g>
    <rect x="99" y="121" width="42" height="30" rx="7" fill="#0f172a"/>
    <path d="M109 136 l6 6 12 -13" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  // 口算：＋ × ÷ 符号
  math: `
    <g fill="#fff">
      <rect x="46" y="106" width="54" height="16" rx="8"/>
      <rect x="65" y="87" width="16" height="54" rx="8"/>
      <rect x="150" y="88" width="14" height="52" rx="7" transform="rotate(45 157 114)"/>
      <rect x="150" y="88" width="14" height="52" rx="7" transform="rotate(-45 157 114)"/>
      <rect x="140" y="150" width="56" height="16" rx="8"/>
      <circle cx="152" cy="158" r="10" fill="#0f172a"/>
      <circle cx="184" cy="158" r="10" fill="#0f172a"/>
    </g>`,
}

// 每个插件：渐变配色 + 图形组合
const ICONS = {
  'qr-tools': { from: '#1d4ed8', to: '#0ea5e9', body: G.qr },
  'image-compress': { from: '#0891b2', to: '#22d3ee', body: G.imageCompress },
  'daily-calc': { from: '#7c3aed', to: '#a78bfa', body: G.calc },
  'clipboard-history': { from: '#b45309', to: '#f59e0b', body: G.clipboard },
  'text-tools': { from: '#4338ca', to: '#818cf8', body: G.text },
  'password-gen': { from: '#9f1239', to: '#f43f5e', body: G.password },
  'class-tools': { from: '#be123c', to: '#fb7185', body: G.class },
  'pdf-crop': { from: '#047857', to: '#34d399', body: G.doc + G.crop },
  'pdf-compose': { from: '#0f766e', to: '#2dd4bf', body: G.doc + G.compose },
  'pdf-compress': { from: '#c2410c', to: '#fb923c', body: G.doc + G.compress },
  'pdf-crypt': { from: '#334155', to: '#94a3b8', body: G.doc + G.crypt },
  'pdf-split': { from: '#065f46', to: '#10b981', body: G.doc + G.split },
  'mental-math': { from: '#2563eb', to: '#60a5fa', body: G.math },
  'gif-maker': { from: '#7e22ce', to: '#c084fc', body: G.gifMaker },
  'pic-merge': { from: '#0369a1', to: '#38bdf8', body: G.picMerge },
  'course-scheduler': { from: '#1e3a8a', to: '#3b82f6', body: G.scheduler },
}

function svgFor(id) {
  const spec = ICONS[id]
  if (!spec) return null
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${spec.from}"/>
      <stop offset="1" stop-color="${spec.to}"/>
    </linearGradient>
  </defs>
  <rect width="240" height="240" rx="52" fill="url(#bg)"/>
  <rect x="14" y="14" width="212" height="212" rx="42" fill="#ffffff" fill-opacity="0.08"/>
  ${spec.body}
</svg>`
}

const pluginsDir = path.join(root, 'plugins')
const argOnly = process.argv.find((a) => a.startsWith('--only='))
const only = argOnly ? argOnly.split('=')[1] : null

let made = 0
for (const id of Object.keys(ICONS)) {
  if (only && id !== only) continue
  const dir = path.join(pluginsDir, id)
  if (!fs.existsSync(dir)) continue
  const svg = svgFor(id)
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } })
  fs.writeFileSync(path.join(dir, 'icon.png'), resvg.render().asPng())
  console.log(`✓ ${id}/icon.png`)
  made++
}
console.log(`共生成 ${made} 个功能图标`)
