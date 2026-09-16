import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { RENDER_SCALE, PREVIEW_WIDTH } from '../constants/pdf'

// 全局唯一配置 worker（webview 内）
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

let currentDoc = null

/** 打开并缓存当前 PDF 文档（pdf.js 会 transfer 传入的 buffer，故这里总传副本以保护原 buffer） */
export async function loadDoc(rawBuffer) {
  await closeDoc()
  currentDoc = await pdfjsLib
    .getDocument({ data: new Uint8Array(rawBuffer.slice(0)) })
    .promise.then((doc) => doc)
  return currentDoc
}

export function getCurrentDoc() {
  return currentDoc
}

export async function closeDoc() {
  if (currentDoc) {
    try {
      await currentDoc.destroy()
    } finally {
      currentDoc = null
    }
  }
}

/** 读取所有页的尺寸信息（pt） */
export async function getPageInfos(doc) {
  const infos = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    infos.push({ index: i, width: vp.width, height: vp.height })
  }
  return infos
}

/** 渲染单页到离屏 canvas */
export async function renderPageToCanvas(doc, pageIndex, scale = RENDER_SCALE) {
  const page = await doc.getPage(pageIndex)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas
}

/** 把页面渲染为可显示的 dataURL（供缩略图使用） */
export async function renderPageToDataUrl(doc, pageIndex, scale = RENDER_SCALE) {
  const canvas = await renderPageToCanvas(doc, pageIndex, scale)
  return canvas.toDataURL('image/png')
}

/**
 * 渲染某一页裁剪区域的效果图（预览用）。
 * 以裁剪区宽度约占 PREVIEW_WIDTH 为基准缩放渲染，返回 dataURL。
 */
export async function renderCropPreview(doc, pageIndex, crop) {
  const page = await doc.getPage(pageIndex)
  const base = page.getViewport({ scale: 1 })
  const cropW = base.width * crop.w
  const cropH = base.height * crop.h
  const scale = PREVIEW_WIDTH / cropW

  // 整页渲染到离屏 canvas，再截取裁剪区域
  const viewport = page.getViewport({ scale })
  const full = document.createElement('canvas')
  full.width = Math.floor(viewport.width)
  full.height = Math.floor(viewport.height)
  const fctx = full.getContext('2d')
  await page.render({ canvasContext: fctx, viewport }).promise

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(cropW * scale))
  canvas.height = Math.max(1, Math.floor(cropH * scale))
  const ctx = canvas.getContext('2d')
  ctx.drawImage(
    full,
    crop.x * base.width * scale,
    crop.y * base.height * scale,
    cropW * scale,
    cropH * scale,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return canvas.toDataURL('image/png')
}