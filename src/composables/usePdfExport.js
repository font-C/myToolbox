import { PDFDocument } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { normalizedToPdfPoints } from '../utils/cropMath'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { EXPORT_SUFFIX } from '../constants/pdf'
import { IS_TAURI } from '../utils/env'

// 统一配置 pdf.js worker（与 usePdfRenderer 共用同一模块单例）
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * 基于所有页的裁剪框，构建裁剪后的 PDF Uint8Array。
 * 只输出「有裁剪框」的页面；未选中的页会被整页剔除，不会出现在结果中。
 * `cropBoxes`：{ pageIndex (1-based): crop | null }
 * @returns Promise<Uint8Array> 裁剪后的字节数组。
 */
export async function buildCroppedPdfBytes(rawBuffer, cropBoxes, pageInfos) {
  const srcPdf = await PDFDocument.load(new Uint8Array(rawBuffer))
  const pages = srcPdf.getPages()

  // 只取有裁剪框的页（1-based -> 0-based 索引）
  const selectedIndices = Object.keys(cropBoxes)
    .map((k) => Number(k) - 1)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < pages.length)
    .sort((a, b) => a - b)

  // 没有选中页时返回空结果，调用方可据此提示
  if (selectedIndices.length === 0) return null

  const outPdf = await PDFDocument.create()
  const copied = await outPdf.copyPages(srcPdf, selectedIndices)
  for (let n = 0; n < selectedIndices.length; n++) {
    const srcIdx = selectedIndices[n]
    const page = copied[n]
    const crop = cropBoxes[srcIdx + 1]
    const info = pageInfos[srcIdx]
    if (crop && info) {
      const box = normalizedToPdfPoints(crop, info.width, info.height)
      if (box) {
        page.setMediaBox(box.x, box.y, box.width, box.height)
        page.setCropBox(box.x, box.y, box.width, box.height)
        page.setBleedBox(box.x, box.y, box.width, box.height)
        page.setTrimBox(box.x, box.y, box.width, box.height)
        page.setArtBox(box.x, box.y, box.width, box.height)
      }
    }
    outPdf.addPage(page)
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
  // 延迟释放，确保下载已开始
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 导出保存裁剪 PDF。Tauri 走系统保存对话框；浏览器走下载。返回是否成功。*/
export async function downloadCroppedPdf(rawBuffer, cropBoxes, pageInfos, originalName) {
  const bytes = await buildCroppedPdfBytes(rawBuffer, cropBoxes, pageInfos)
  if (!bytes) return false // 没有任何选中页

  const baseName = (originalName || 'document').replace(/\.pdf$/i, '')
  const fileName = `${baseName}${EXPORT_SUFFIX}`

  if (!IS_TAURI) {
    browserDownload(bytes, fileName)
    return true
  }

  const path = await save({ defaultPath: fileName, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (!path) return false // 用户取消

  try {
    // 直接传 Uint8Array，走二进制 IPC，避免超大数组转 JSON 的序列化开销/失败
    await invoke('save_bytes', { path, bytes })
    return true
  } catch (e) {
    console.error('保存失败:', e)
    throw e
  }
}

/** 打印渲染分辨率倍数（越高越清晰，内存开销也越大） */
const PRINT_SCALE = 3

/**
 * 用一个独立的 pdf.js 文档，把每页裁剪区域渲染成图片。
 * 不污染主界面当前打开、正在渲染预览的文档（各自独立加载、用完即销毁）。
 */
async function renderCropImagesForPrint(rawBuffer, cropBoxes) {
  const array = new Uint8Array(rawBuffer.slice(0))
  const doc = await pdfjsLib.getDocument({ data: array }).promise
  const images = []
  try {
    for (const [idx, crop] of Object.entries(cropBoxes)) {
      const page = await doc.getPage(Number(idx))
      const base = page.getViewport({ scale: 1 })
      const cropW = base.width * crop.w
      const cropH = base.height * crop.h

      // 整页渲染到离屏 canvas
      const vp = page.getViewport({ scale: PRINT_SCALE })
      const full = document.createElement('canvas')
      full.width = Math.floor(vp.width)
      full.height = Math.floor(vp.height)
      const fctx = full.getContext('2d')
      await page.render({ canvasContext: fctx, viewport: vp }).promise

      // 截取裁剪区域
      const cw = Math.max(1, Math.floor(cropW * PRINT_SCALE))
      const ch = Math.max(1, Math.floor(cropH * PRINT_SCALE))
      const c = document.createElement('canvas')
      c.width = cw
      c.height = ch
      const ctx = c.getContext('2d')
      ctx.drawImage(
        full,
        crop.x * base.width * PRINT_SCALE,
        crop.y * base.height * PRINT_SCALE,
        cropW * PRINT_SCALE,
        cropH * PRINT_SCALE,
        0,
        0,
        cw,
        ch,
      )
      images.push(c.toDataURL('image/png'))
    }
  } finally {
    await doc.destroy()
  }
  return images
}

/**
 * 注入打印层：把裁剪图片作为唯一的可见文档内容。
 * 关键点：不使用 @media print 隐藏（WKWebView 原生打印按屏幕渲染、不应用 @media print），
 * 而是直接隐藏除打印层外的所有其它界面元素，让打印层成为文档中唯一内容——
 * 这样浏览器 window.print 与 Tauri 原生 print 都会只输出选中内容。
 */
function showPrintLayer(images) {
  const old = document.getElementById('print-root')
  if (old) {
    old.remove()
    document.body.classList.remove('print-active')
  }

  if (!document.getElementById('print-root-style')) {
    const st = document.createElement('style')
    st.id = 'print-root-style'
    st.textContent = `
      body.print-active > :not(#print-root){display:none !important}
      #print-root{margin:0;padding:0;background:#fff}
      #print-root .pg{width:100%;height:100vh;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:8mm;page-break-after:always}
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
  return root
}

/**
 * 直接打印裁剪后的 PDF（不下载本地）。
 * - Tauri：用 pdf-lib 生成裁剪后的 PDF 字节，交给原生 AppKit 打印（矢量、同步、无窗口）；
 * - 浏览器：用 pdf.js 把每页裁剪区渲染成图片，在主窗口注入打印层后用 window.print()。
 */
export async function printCroppedPdf(rawBuffer, cropBoxes, pageInfos) {
  if (IS_TAURI) {
    const bytes = await buildCroppedPdfBytes(rawBuffer, cropBoxes, pageInfos)
    if (!bytes) return // 没有任何选中页
    await invoke('print_pdf', { bytes }).catch((e) => {
      console.error('Tauri 打印失败:', e)
    })
    return
  }

  const images = await renderCropImagesForPrint(rawBuffer, cropBoxes)
  if (images.length === 0) return

  const root = showPrintLayer(images)
  const finish = () => {
    window.removeEventListener('afterprint', finish)
    document.body.classList.remove('print-active')
    try {
      root.remove()
    } catch {
      // 已被清理则忽略
    }
  }
  window.addEventListener('afterprint', finish)

  // 等待打印层完成布局/绘制，避免打印到空白帧
  await new Promise((resolve) => setTimeout(resolve, 250))
  try {
    if (typeof window.print === 'function') {
      window.print()
    }
  } finally {
    finish()
  }
}