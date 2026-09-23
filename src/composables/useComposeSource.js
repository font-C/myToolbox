import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ELEMENT_MAX_PIXEL } from '../constants/pdf.js'

/** 全局唯一配置 pdf.js worker（webview 内，与 usePdfRenderer 语义一致） */
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * 把图片文件解码为受限尺寸的 dataURL，并返回其宽高比（width/height）。
 * 超大的图会被等比缩到 ELEMENT_MAX_PIXEL 以内，避免超大 dataURL 拖垮内存。
 * @returns Promise<{ src: string, aspect: number }>
 */
export function readImageAsElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const srcW = img.naturalWidth
      const srcH = img.naturalHeight
      const scale = Math.min(1, ELEMENT_MAX_PIXEL / Math.max(srcW, srcH))
      if (scale >= 1) {
        // 原图已够小，直接读 dataURL
        const reader = new FileReader()
        reader.onload = () => {
          URL.revokeObjectURL(url)
          resolve({ src: reader.result, aspect: srcW / srcH })
        }
        reader.onerror = () => {
          URL.revokeObjectURL(url)
          reject(reader.error)
        }
        reader.readAsDataURL(file)
        return
      }
      // 缩放到受限尺寸
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(srcW * scale)
      canvas.height = Math.round(srcH * scale)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve({ src: canvas.toDataURL('image/png'), aspect: srcW / srcH })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解码失败'))
    }
    img.src = url
  })
}

/**
 * 把多页 PDF 逐页栅格化为 dataURL（每页一张图片），返回元素草稿列表。
 * @returns Promise<Array<{ src: string, aspect: number }>>
 */
export async function readPdfAsElementDrafts(rawBuffer) {
  const doc = await pdfjsLib
    .getDocument({ data: new Uint8Array(rawBuffer.slice(0)) })
    .promise
  const drafts = []
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      // 以宽度为基准换算渲染倍率，保证最长边受限在 ELEMENT_MAX_PIXEL
      const longSide = Math.max(base.width, base.height)
      const scale = Math.min(4, ELEMENT_MAX_PIXEL / longSide)
      const vp = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport: vp }).promise
      drafts.push({ src: canvas.toDataURL('image/png'), aspect: base.width / base.height })
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    await doc.destroy()
  }
  return drafts
}

/** 判断文件是否为图片（按扩展名） */
export function isImageFile(file) {
  return /\.(png|jpe?g)$/i.test(file.name)
}

/** 判断文件是否为 PDF（按扩展名） */
export function isPdfFile(file) {
  return /\.pdf$/i.test(file.name)
}