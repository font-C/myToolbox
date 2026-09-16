import { MIN_CROP } from '../constants/pdf.js'

/**
 * 裁剪框统一使用「归一化坐标」（0~1，左上角为原点）存储，避免窗口尺寸变化导致失真。
 * crop: { x, y, w, h } —— x/y 为左上角，w/h 为宽高，均为 0~1 比例。
 */

/** 将边界无关的指针坐标（相对显示区左上角、0~1）收敛为合法裁剪框 */
export function normalizeCrop(raw) {
  let { x, y, w, h } = raw
  if (w < 0) {
    x += w
    w = -w
  }
  if (h < 0) {
    y += h
    h = -h
  }
  // 边界夹取
  const nx = Math.min(Math.max(x, 0), 1)
  const ny = Math.min(Math.max(y, 0), 1)
  const nw = Math.min(Math.max(w, 0), 1 - nx)
  const nh = Math.min(Math.max(h, 0), 1 - ny)
  if (nw < MIN_CROP || nh < MIN_CROP) return null
  // 四舍五入到 1/1000 精度，避免浮点噪声
  const round = (v) => Math.round(v * 1000) / 1000
  return { x: round(nx), y: round(ny), w: round(nw), h: round(nh) }
}

/**
 * 归一化裁剪框 -> PDF CropBox 目标坐标（原点左下、单位 pt）。
 * 返回 { x, y, width, height }；无裁剪框时返回 null。
 */
export function normalizedToPdfPoints(crop, pageWidthPts, pageHeightPts) {
  if (!crop) return null
  const left = crop.x * pageWidthPts
  const top = crop.y * pageHeightPts
  const width = crop.w * pageWidthPts
  const height = crop.h * pageHeightPts
  return {
    x: left,
    y: pageHeightPts - top - height,
    width,
    height,
  }
}

/**
 * 拖动某个控点，调整裁剪框大小。
 * @param crop 原裁剪框 {x,y,w,h}
 * @param handle 方向：nw|n|ne|e|se|s|sw|w
 * @param dx dy 指针的归一化位移
 */
export function resizeCrop(crop, handle, dx, dy) {
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max)
  let { x, y, w, h } = crop

  // 水平方向
  if (handle.includes('w')) {
    const nx = clamp(x + dx, 0, x + w - MIN_CROP)
    w = w + x - nx
    x = nx
  } else if (handle.includes('e')) {
    w = clamp(w + dx, MIN_CROP, 1 - x)
  }

  // 垂直方向
  if (handle.includes('n')) {
    const ny = clamp(y + dy, 0, y + h - MIN_CROP)
    h = h + y - ny
    y = ny
  } else if (handle.includes('s')) {
    h = clamp(h + dy, MIN_CROP, 1 - y)
  }

  const r = (v) => Math.round(v * 1000) / 1000
  return { x: r(x), y: r(y), w: r(w), h: r(h) }
}