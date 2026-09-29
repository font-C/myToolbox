/**
 * 口算题卡（A4 纵向）生成与打印支持。
 *
 * - 版面常量集中在 LAYOUT（单位 pt），HTML 预览按 PX = 4/3 换算成 px，保证
 *   预览与 PDF 两端同一套分页/网格几何。
 * - 题目与答案页均按列数分栏、行高定高，自动分页。
 * - 表头（标题「口算题卡」+ 姓名/日期/用时/得分填写栏）为中文，标准 14 字体
 *   不含 CJK，浏览器环境下用 canvas 按系统字体栅格化后以 PNG 嵌入（约 300dpi）；
 *   无 DOM 环境（如 node 测试）回退为英文矢量表头，仅用于验证几何。
 * - 矢量文本只用 WinAnsi 可编码字符：数字、+ - × ÷ = ( ) . 以及省略号 …。
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export const A4 = { w: 595.28, h: 841.89 }

/** pt → px（96dpi），供 HTML 预览换算 */
export const PX = 4 / 3

export const LAYOUT = {
  marginX: 42,
  marginTop: 40,
  marginBottom: 34,
  // 页 1 表头：标题图 34 + 间距 8 + 填写栏 18 = 60，再加与正文的间距
  headerTitleH: 34,
  headerGap: 8,
  headerInfoH: 18,
  headerBottomGap: 14,
  rowH: 30,
  fontSize: 13,
  numFontSize: 8.5,
  numW: 16,
  ansHeaderH: 24,
  ansHeaderGap: 10,
  ansRowH: 18,
  ansFontSize: 10.5,
  footerFontSize: 8.5,
}

LAYOUT.headerTotal =
  LAYOUT.headerTitleH + LAYOUT.headerGap + LAYOUT.headerInfoH + LAYOUT.headerBottomGap
LAYOUT.ansHeaderTotal = LAYOUT.ansHeaderH + LAYOUT.ansHeaderGap

export const contentW = A4.w - LAYOUT.marginX * 2

/**
 * 题目行高随列数变化：2 列时行数少、行高收紧到 26pt，
 * 使默认 50 题可排入一页（26 行 × 2 列 = 52）；其余列数 30pt。
 */
export function rowHeight(cols) {
  return cols === 2 ? 26 : LAYOUT.rowH
}

const TEXT_COLOR = rgb(0.13, 0.13, 0.13)
const MUTED_COLOR = rgb(0.55, 0.55, 0.55)

/** 第 pageIdx 页（0 起）题目的可用行数 */
export function rowsForPage(pageIdx, cols = 4) {
  const used =
    LAYOUT.marginTop + LAYOUT.marginBottom + (pageIdx === 0 ? LAYOUT.headerTotal : 0)
  return Math.floor((A4.h - used) / rowHeight(cols))
}

/** 第 pageIdx 页（0 起）答案的可用行数 */
export function ansRowsForPage(pageIdx) {
  const used =
    LAYOUT.marginTop +
    LAYOUT.marginBottom +
    (pageIdx === 0 ? LAYOUT.ansHeaderTotal : 0)
  return Math.floor((A4.h - used) / LAYOUT.ansRowH)
}

/** 按每页 rowsForPage(pageIdx) 行、每行 cols 题切分 */
export function paginateBy(items, cols, rowsFor) {
  const pages = []
  let i = 0
  while (i < items.length) {
    const cap = Math.max(1, rowsFor(pages.length)) * cols
    pages.push(items.slice(i, i + cap))
    i += cap
  }
  return pages
}

/** 题目分页 */
export const paginate = (items, cols) =>
  paginateBy(items, cols, (i) => rowsForPage(i, cols))

/** 答案分页 */
export const paginateAnswers = (items, cols) =>
  paginateBy(items, cols, ansRowsForPage)

/** 答案文案：有余数除法为「商……余数」 */
export function answerText(item) {
  const a = item.answer
  if (a && typeof a === 'object') return `${a.quotient}……${a.remainder}`
  return String(a)
}

/** dataURL → Uint8Array（用于嵌入 pdf-lib） */
function dataUrlToBytes(dataUrl) {
  const bin = atob(dataUrl.split(',')[1])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/**
 * 用 canvas 按系统中文字体渲染页 1 表头（标题 + 填写栏），约 300dpi。
 * @returns {{dataUrl:string, wPt:number, hPt:number}|null} 无 DOM 环境返回 null
 */
export function renderHeaderPng() {
  if (typeof document === 'undefined') return null
  const wPt = contentW
  const hPt = LAYOUT.headerTitleH + LAYOUT.headerGap + LAYOUT.headerInfoH
  const S = 4
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(wPt * S)
  canvas.height = Math.round(hPt * S)
  const ctx = canvas.getContext('2d')
  ctx.scale(S, S)
  ctx.fillStyle = '#1a1a1a'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `bold ${LAYOUT.headerTitleH - 10}px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`
  ctx.fillText('口算题卡', wPt / 2, LAYOUT.headerTitleH - 8)

  // 填写栏：姓名 / 日期 / 用时 / 得分 四等分
  ctx.textAlign = 'left'
  ctx.font = `10.5px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`
  ctx.strokeStyle = '#1a1a1a'
  ctx.lineWidth = 0.8
  const slotW = wPt / 4
  const baseY = hPt - 4
  ;['姓名', '日期', '用时', '得分'].forEach((label, i) => {
    const x0 = i * slotW + 4
    ctx.fillText(`${label}：`, x0, baseY)
    const w = ctx.measureText(`${label}：`).width
    ctx.beginPath()
    ctx.moveTo(x0 + w + 4, baseY + 1.5)
    ctx.lineTo(x0 + slotW - 14, baseY + 1.5)
    ctx.stroke()
  })
  return { dataUrl: canvas.toDataURL('image/png'), wPt, hPt }
}

/**
 * 答案页表头（「参考答案 · 共 N 题」）。
 * @returns {{dataUrl:string, wPt:number, hPt:number}|null}
 */
export function renderAnswerHeaderPng(total) {
  if (typeof document === 'undefined') return null
  const wPt = contentW
  const hPt = LAYOUT.ansHeaderH
  const S = 4
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(wPt * S)
  canvas.height = Math.round(hPt * S)
  const ctx = canvas.getContext('2d')
  ctx.scale(S, S)
  ctx.fillStyle = '#1a1a1a'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `bold 14px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`
  ctx.fillText(`参考答案 · 共 ${total} 题`, wPt / 2, hPt - 8)
  return { dataUrl: canvas.toDataURL('image/png'), wPt, hPt }
}

/** 无 DOM 环境的矢量英文表头回退（仅保证几何可验证） */
function drawFallbackHeader(page, fontBold) {
  const y0 = A4.h - LAYOUT.marginTop
  page.drawText('Mental Math Worksheet', {
    x: LAYOUT.marginX,
    y: y0 - LAYOUT.headerTitleH + 10,
    size: 20,
    font: fontBold,
    color: TEXT_COLOR,
  })
  page.drawText('Name ____________    Date ____________    Score ____________', {
    x: LAYOUT.marginX,
    y: y0 - LAYOUT.headerTitleH - LAYOUT.headerGap - 8,
    size: 10,
    font: fontBold,
    color: TEXT_COLOR,
  })
}

/**
 * 在一行内绘制一道题：灰色序号 + 题目 + 答题下划线。
 * 题目过宽时逐步缩小字号（最低 8.5pt）保证不溢出单元格。
 */
function drawProblem(page, font, item, idx, x, rowTop, cellW, rowH) {
  const baseline = rowTop - rowH / 2 + LAYOUT.fontSize * 0.35
  page.drawText(`${idx + 1}.`, {
    x,
    y: baseline,
    size: LAYOUT.numFontSize,
    font,
    color: MUTED_COLOR,
  })
  const qx = x + LAYOUT.numW
  let size = LAYOUT.fontSize
  let text = `${item.text} =`
  let w = font.widthOfTextAtSize(text, size)
  const maxTextW = cellW - LAYOUT.numW - 24
  while (w > maxTextW && size > 8.5) {
    size -= 0.5
    w = font.widthOfTextAtSize(text, size)
  }
  page.drawText(text, { x: qx, y: baseline, size, font, color: TEXT_COLOR })
  const blankW = Math.min(44, Math.max(20, cellW - LAYOUT.numW - w - 8))
  page.drawLine({
    start: { x: qx + w + 8, y: baseline - 3.5 },
    end: { x: qx + w + 8 + blankW, y: baseline - 3.5 },
    thickness: 0.8,
    color: TEXT_COLOR,
  })
}

/**
 * 生成口算题卡 PDF（A4 纵向）。
 * @param {Array<{text:string, answer:number|{quotient:number,remainder:number}, kind:string}>} items
 * @param {{cols?: number, withAnswers?: boolean}} options
 * @returns {Promise<Uint8Array>}
 */
export async function buildWorksheetPdf(items, { cols = 4, withAnswers = false } = {}) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const header = renderHeaderPng()
  const headerImg = header ? await pdf.embedPng(dataUrlToBytes(header.dataUrl)) : null
  const ansHeader = withAnswers ? renderAnswerHeaderPng(items.length) : null
  const ansHeaderImg = ansHeader
    ? await pdf.embedPng(dataUrlToBytes(ansHeader.dataUrl))
    : null

  const chunks = paginate(items, cols)
  const ansChunks = withAnswers ? paginateAnswers(items, cols) : []
  const totalPages = chunks.length + ansChunks.length

  const cellW = contentW / cols
  const rowH = rowHeight(cols)
  const drawFooter = (page, pageNo) => {
    const label = `${pageNo} / ${totalPages}`
    const w = font.widthOfTextAtSize(label, LAYOUT.footerFontSize)
    page.drawText(label, {
      x: (A4.w - w) / 2,
      y: 18,
      size: LAYOUT.footerFontSize,
      font,
      color: MUTED_COLOR,
    })
  }

  let pageNo = 0
  let no = 0
  let ansNo = 1 // 答案序号与题目序号一一对应，独立于题目计数
  chunks.forEach((chunk, pageIdx) => {
    const page = pdf.addPage([A4.w, A4.h])
    pageNo++
    let top = A4.h - LAYOUT.marginTop
    if (pageIdx === 0) {
      if (headerImg && header) {
        page.drawImage(headerImg, {
          x: LAYOUT.marginX,
          y: top - header.hPt,
          width: header.wPt,
          height: header.hPt,
        })
      } else {
        drawFallbackHeader(page, fontBold)
      }
      top -= LAYOUT.headerTotal
    }
    chunk.forEach((item, i) => {
      const r = Math.floor(i / cols)
      const c = i % cols
      drawProblem(page, font, item, no, LAYOUT.marginX + c * cellW,
        top - r * rowH, cellW, rowH)
      no++
    })
    drawFooter(page, pageNo)
  })

  ansChunks.forEach((chunk, pageIdx) => {
    const page = pdf.addPage([A4.w, A4.h])
    pageNo++
    let top = A4.h - LAYOUT.marginTop
    if (pageIdx === 0) {
      if (ansHeaderImg && ansHeader) {
        page.drawImage(ansHeaderImg, {
          x: LAYOUT.marginX,
          y: top - ansHeader.hPt,
          width: ansHeader.wPt,
          height: ansHeader.hPt,
        })
      } else {
        page.drawText('Answers', {
          x: LAYOUT.marginX,
          y: top - LAYOUT.ansHeaderH + 8,
          size: 14,
          font: fontBold,
          color: TEXT_COLOR,
        })
      }
      top -= LAYOUT.ansHeaderTotal
    }
    const cellW2 = contentW / cols
    chunk.forEach((item, i) => {
      const r = Math.floor(i / cols)
      const c = i % cols
      const baseline = top - r * LAYOUT.ansRowH - LAYOUT.ansRowH / 2 + LAYOUT.ansFontSize * 0.35
      const x = LAYOUT.marginX + c * cellW2
      page.drawText(`${ansNo}. ${answerText(item)}`, {
        x,
        y: baseline,
        size: LAYOUT.ansFontSize,
        font,
        color: TEXT_COLOR,
      })
      ansNo++
    })
    drawFooter(page, pageNo)
  })

  return pdf.save()
}
