import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useComposeStore } from '../stores/compose.js'
import { COMPOSE_SUFFIX, COVER_FILL, COVER_TEXT_FILL, MOSAIC_BLOCK } from '../constants/pdf.js'
import { IS_TAURI } from '../utils/env.js'

/** 把 dataURL 还原为 Uint8Array（用于嵌入 pdf-lib） */
function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1]
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** 把 #rrggbb 十六进制颜色解析为 {r,g,b}（0~1），缺省黑色 */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = parseInt(m[1], 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

/** 加载 dataURL 图片为 HTMLImageElement */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('元素图片加载失败'))
    img.src = src
  })
}

/** 画布绘制时的渲染倍率（约 150 dpi，相对 72pt/inch） */
const RASTER_SCALE = 150 / 72

/**
 * 把某一输出页整体栅格化为位图（用于含马赛克的页），并对马赛克区域做块状像素化。
 * 绘制顺序：元素 → 遮盖（白底+黑字）→ 马赛克 → 输出 dataURL。
 */
async function rasterizePageWithMosaic(page, elements, annotations) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(page.width * RASTER_SCALE)
  canvas.height = Math.round(page.height * RASTER_SCALE)
  const ctx = canvas.getContext('2d')
  const cw = canvas.width
  const ch = canvas.height

  // 1) 元素
  for (const el of elements) {
    try {
      const img = await loadImage(el.src)
      const px = el.x * cw
      const py = el.y * ch
      ctx.drawImage(img, px, py, el.w * cw, el.h * ch)
    } catch (e) {
      console.error(e)
    }
  }

  // 2) 遮盖标注（白底 + 黑字）
  for (const a of annotations) {
    if (a.type !== 'cover') continue
    const px = a.x * cw
    const py = a.y * ch
    const pw = a.w * cw
    const ph = a.h * ch
    ctx.fillStyle = COVER_FILL
    ctx.fillRect(px, py, pw, ph)
    if (a.text) {
      ctx.fillStyle = a.color || COVER_TEXT_FILL
      const fontSize = Math.max(6, (a.fontSize || 12) * RASTER_SCALE)
      const fam = (a.fontFamily || 'sans-serif')
        .split(',')[0]
        .replace(/['"]/g, '')
        .trim()
      ctx.font = `${fontSize}px ${fam}`
      ctx.textBaseline = 'middle'
      const lines = String(a.text).split('\n')
      const lh = Math.ceil(fontSize * 1.35)
      const totalH = lines.length * lh
      let ty0 = py + ph / 2
      if (a.alignV === 'top') ty0 = py + lh / 2
      else if (a.alignV === 'bottom') ty0 = py + ph - totalH + lh / 2
      else ty0 = py + (ph - totalH) / 2 + lh / 2
      lines.forEach((line, i) => {
        ctx.textAlign = a.alignH || 'left'
        let tx = px
        if (a.alignH === 'center') tx = px + pw / 2
        else if (a.alignH === 'right') tx = px + pw
        ctx.fillText(line, tx, ty0 + i * lh, pw)
      })
    }
  }

  // 3) 马赛克区域按样式填充：纯色或浅灰白格（覆盖原内容）
  const mosaics = annotations.filter((a) => a.type === 'mosaic')
  for (const m of mosaics) {
    const px = Math.round(m.x * cw)
    const py = Math.round(m.y * ch)
    const pw = Math.max(1, Math.round(m.w * cw))
    const ph = Math.max(1, Math.round(m.h * ch))
    if (m.style === 'solid') {
      ctx.fillStyle = m.color || '#cfd4db'
      ctx.fillRect(px, py, pw, ph)
      continue
    }
    // 灰白格：特别浅的浅色棋盘格
    const cell = Math.max(8, Math.round(MOSAIC_BLOCK * RASTER_SCALE))
    const g0 = '#f6f7f9'
    const g1 = '#e3e8ef'
    ctx.beginPath()
    for (let y = py; y < py + ph; y += cell) {
      for (let x = px; x < px + pw; x += cell) {
        ctx.fillStyle = ((x - px) / cell + (y - py) / cell) % 2 === 0 ? g0 : g1
        ctx.fillRect(x, y, Math.min(cell, px + pw - x), Math.min(cell, py + ph - y))
      }
    }
  }

  return canvas.toDataURL('image/png')
}

/**
 * 把当前拼版工程构建为一份合并后的 PDF 字节。
 * - 不含马赛克的页：矢量输出（嵌入元素图片 + 绘制遮盖矩形与黑字）。
 * - 含马赛克的页：整页栅格化位图后整体嵌入（保证马赛克正确生效）。
 * 大页面在栅格化后内存占用较高，渲染后排空 canvas 以释放。
 */
export async function buildComposedPdfBytes() {
  const store = useComposeStore()
  if (store.isEmpty) return null
  const outPdf = await PDFDocument.create()
  // 预置常用字体，供批注按 a.fontFamily 选择
  const stdFonts = {
    'sans-serif': await outPdf.embedFont(StandardFonts.Helvetica),
    serif: await outPdf.embedFont(StandardFonts.TimesRoman),
    monospace: await outPdf.embedFont(StandardFonts.Courier),
    cursive: await outPdf.embedFont(StandardFonts.Helvetica),
  }
  const pickFont = (k) => stdFonts[k] || stdFonts['sans-serif']

  for (const page of store.pages) {
    const elements = store.elementsOf(page.id)
    const annotations = store.annotationsOf(page.id)
    // 空白页（无任何元素）不导出
    if (elements.length === 0) continue
    const pdfPage = outPdf.addPage([page.width, page.height])

    if (store.pageHasMosaic(page.id)) {
      // 整页位图输出
      const dataUrl = await rasterizePageWithMosaic(page, elements, annotations)
      const img = await outPdf.embedPng(dataUrlToBytes(dataUrl))
      pdfPage.drawImage(img, { x: 0, y: 0, width: page.width, height: page.height })
      continue
    }

    // 矢量输出：先放元素
    for (const el of elements) {
      try {
        const bytes = dataUrlToBytes(el.src)
        const isPng = el.src.includes('image/png')
        const img = isPng ? await outPdf.embedPng(bytes) : await outPdf.embedJpg(bytes)
        const px = el.x * page.width
        const top = el.y * page.height
        const pw = el.w * page.width
        const ph = el.h * page.height
        // pdf-lib 原点在左下，换算 y
        pdfPage.drawImage(img, { x: px, y: page.height - top - ph, width: pw, height: ph })
      } catch (e) {
        console.error('嵌入元素失败:', e)
      }
    }

    // 矢量输出：绘制遮盖标注
    for (const a of annotations) {
      if (a.type !== 'cover') continue
      const cpx = a.x * page.width
      const ctop = a.y * page.height
      const cw = a.w * page.width
      const ch = a.h * page.height
      pdfPage.drawRectangle({
        x: cpx,
        y: page.height - ctop - ch,
        width: cw,
        height: ch,
        color: rgb(COVER_FILL === '#ffffff' ? 1 : 0, COVER_FILL === '#ffffff' ? 1 : 0, COVER_FILL === '#ffffff' ? 1 : 0),
      })
      if (a.text) {
        const fontSize = Math.max(6, a.fontSize || 12)
        const f = pickFont(a.fontFamily)
        const c = hexToRgb(a.color)
        const lh = Math.ceil(fontSize * 1.35)
        const lines = String(a.text).split('\n')
        const widths = lines.map((l) => f.widthOfTextAtSize(l, fontSize))
        const totalH = lines.length * lh
        let firstBaseline
        if (a.alignV === 'top') firstBaseline = ctop + fontSize
        else if (a.alignV === 'bottom') firstBaseline = ctop + ch - (totalH - fontSize)
        else firstBaseline = ctop + (ch - totalH) / 2 + fontSize
        lines.forEach((line, i) => {
          let tx = cpx + 2
          const lw = widths[i]
          if (a.alignH === 'center') tx = cpx + (cw - lw) / 2
          else if (a.alignH === 'right') tx = cpx + cw - lw - 2
          const y = page.height - (firstBaseline + i * lh)
          pdfPage.drawText(line, {
            x: tx,
            y,
            size: fontSize,
            font: f,
            color: rgb(c.r, c.g, c.b),
          })
        })
      }
    }
  }

  return outPdf.save()
}

/** 浏览器环境下触发本地下载（作为 Tauri 保存对话框的兜底） */
function browserDownload(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 完整导出：构建合并 PDF 并保存到本地。返回是否成功。 */
export async function downloadComposedPdf(originalName = 'document') {
  const bytes = await buildComposedPdfBytes()
  if (!bytes) return false
  const baseName = (originalName || 'document').replace(/\.pdf$/i, '')
  const fileName = `${baseName}${COMPOSE_SUFFIX}`

  if (!IS_TAURI) {
    browserDownload(bytes, fileName)
    return true
  }
  const path = await save({ defaultPath: fileName, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (!path) return false
  try {
    await invoke('save_bytes', { path, bytes })
    return true
  } catch (e) {
    console.error('保存失败:', e)
    throw e
  }
}

/** 浏览器打印：注入打印层后 window.print（默认图像缩放适配单张纸） */
function printViaBrowser(images) {
  const old = document.getElementById('print-root')
  if (old) old.remove()
  if (!document.getElementById('print-root-style')) {
    const st = document.createElement('style')
    st.id = 'print-root-style'
    st.textContent = `
      body.print-active > :not(#print-root){display:none !important}
      #print-root{margin:0;padding:0;background:#fff}
      #print-root .pg{width:100%;height:100vh;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:6mm;page-break-after:always}
      #print-root .pg:last-child{page-break-after:auto}
      #print-root img{max-width:100%;max-height:100%}
      @media print{@page{margin:0}}
    `
    document.head.appendChild(st)
  }
  const root = document.createElement('div')
  root.id = 'print-root'
  root.innerHTML = images.map((src) => `<div class="pg"><img src="${src}" alt=""></div>`).join('')
  document.body.classList.add('print-active')
  document.body.appendChild(root)
  const finish = () => {
    window.removeEventListener('afterprint', finish)
    document.body.classList.remove('print-active')
    try {
      root.remove()
    } catch {
      /* noop */
    }
  }
  window.addEventListener('afterprint', finish)
  // 供调用方在打印结束后主动清理
  window.__composePrintCleanup = finish
}

/** 直接把拼版结果打到默认打印机（Tauri 走原生 print_pdf；浏览器走 window.print）。 */
export async function printComposedPdf() {
  const bytes = await buildComposedPdfBytes()
  if (!bytes) return
  if (IS_TAURI) {
    await invoke('print_pdf', { bytes }).catch((e) => console.error('Tauri 打印失败:', e))
    return
  }
  // 浏览器：整页栅格化为图片再打印（保证标注/马赛克与导出一致）
  const store = useComposeStore()
  const images = []
  // 满足原生打印的 buildComposedPdfBytes 已跳过空白页，这里保持一致：跳过无元素的页
  for (const page of store.pages) {
    const els = store.elementsOf(page.id)
    if (els.length === 0) continue
    const dataUrl = await rasterizePageWithMosaic(page, els, store.annotationsOf(page.id))
    images.push(dataUrl)
  }
  if (images.length === 0) return
  printViaBrowser(images)
  await new Promise((resolve) => setTimeout(resolve, 250))
  try {
    if (typeof window.print === 'function') window.print()
  } finally {
    window.__composePrintCleanup?.()
  }
}