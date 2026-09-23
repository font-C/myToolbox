import { MIN_COMPOSE } from '../constants/pdf.js'

/**
 * 拼版工具统一使用「归一化坐标」（0~1，左上角为原点）存储矩形。
 * 矩形形状：{ x, y, w, h } —— x/y 为左上角，w/h 为宽高，均为 0~1 比例。
 * 元素、标注、跨页放置区均复用同一套矩形运算。
 */

/** 把指针位移后的矩形收敛为合法形状（夹取边界 + 最小尺寸校验） */
export function normalizeRect(raw) {
  let { x, y, w, h } = raw
  if (w < 0) {
    x += w
    w = -w
  }
  if (h < 0) {
    y += h
    h = -h
  }
  const nx = Math.min(Math.max(x, 0), 1)
  const ny = Math.min(Math.max(y, 0), 1)
  const nw = Math.min(Math.max(w, 0), 1 - nx)
  const nh = Math.min(Math.max(h, 0), 1 - ny)
  if (nw < MIN_COMPOSE || nh < MIN_COMPOSE) return null
  const round = (v) => Math.round(v * 1000) / 1000
  return { x: round(nx), y: round(ny), w: round(nw), h: round(nh) }
}

/**
 * 拖动某个控点调整矩形大小（元素或标注共用）。
 * @param rect 原矩形 {x,y,w,h}
 * @param handle 方向：nw|n|ne|e|se|s|sw|w
 * @param dx dy 指针的归一化位移
 */
export function resizeRect(rect, handle, dx, dy) {
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max)
  let { x, y, w, h } = rect

  if (handle.includes('w')) {
    const nx = clamp(x + dx, 0, x + w - MIN_COMPOSE)
    w = w + x - nx
    x = nx
  } else if (handle.includes('e')) {
    w = clamp(w + dx, MIN_COMPOSE, 1 - x)
  }

  if (handle.includes('n')) {
    const ny = clamp(y + dy, 0, y + h - MIN_COMPOSE)
    h = h + y - ny
    y = ny
  } else if (handle.includes('s')) {
    h = clamp(h + dy, MIN_COMPOSE, 1 - y)
  }

  const r = (v) => Math.round(v * 1000) / 1000
  return { x: r(x), y: r(y), w: r(w), h: r(h) }
}

/**
 * 平移矩形（移动位置），跨页拖拽时允许矩形中心被夹到页面内。
 * 若 keepInPage 为 true 则整个矩形保持在页内，否则仅尽量收敛。
 */
export function translateRect(rect, dx, dy, keepInPage = false) {
  let { x, y } = rect
  if (keepInPage) {
    x = Math.min(Math.max(x + dx, 0), 1 - rect.w)
    y = Math.min(Math.max(y + dy, 0), 1 - rect.h)
  } else {
    x = x + dx
    y = y + dy
  }
  const r = (v) => Math.round(v * 1000) / 1000
  return { x: r(x), y: r(y), w: rect.w, h: rect.h }
}

/** 矩形中心点（用于跨页命中判定） */
export function rectCenter(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

/** 点是否落在矩形内 */
export function pointInRect(px, py, rect) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h
}

/** 两个矩形是否有重叠（跨页拖拽悬停命中判定可选） */
export function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  )
}