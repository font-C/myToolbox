import { MIN_CROP } from './cropConstants.js'

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

/** 页面 /Rotate 归一化到 0|90|180|270（含负角，非法值按 0 处理） */
export function normalizeRotation(deg) {
  const r = (((Number(deg) || 0) % 360) + 360) % 360
  return r === 90 || r === 180 || r === 270 ? r : 0
}

/**
 * 归一化裁剪框 -> PDF CropBox 目标坐标（未旋转用户空间，原点左下、单位 pt）。
 * 框选坐标基于「应用 /Rotate 后的可见视图」，这里按旋转角逆映射回未旋转用户空间；
 * 输出页保留原 /Rotate，查看器旋转后即可还原出与所见一致的裁剪区域。
 * page: { rawWidth, rawHeight, rotation } —— 未旋转尺寸 + 旋转角。
 * 返回 { x, y, width, height }；无裁剪框时返回 null。
 */
export function normalizedToPdfPoints(crop, page) {
  if (!crop || !page) return null
  const wu = page.rawWidth
  const hu = page.rawHeight
  const rotation = normalizeRotation(page.rotation)
  let box
  if (rotation === 90) {
    // 顺时针转 90°：可见左上 ↔ 用户空间 (x=top, y=left)
    box = { x: crop.y * wu, y: crop.x * hu, width: crop.h * wu, height: crop.w * hu }
  } else if (rotation === 180) {
    // 转 180°：两轴同时翻转
    box = {
      x: (1 - crop.x - crop.w) * wu,
      y: (1 - crop.y - crop.h) * hu,
      width: crop.w * wu,
      height: crop.h * hu,
    }
  } else if (rotation === 270) {
    // 逆时针转 90°（顺时针 270°）：与 90° 双轴翻转
    box = {
      x: (1 - crop.y - crop.h) * wu,
      y: (1 - crop.x - crop.w) * hu,
      width: crop.h * wu,
      height: crop.w * hu,
    }
  } else {
    box = { x: crop.x * wu, y: (1 - crop.y - crop.h) * hu, width: crop.w * wu, height: crop.h * hu }
  }
  const round = (v) => Math.round(v * 1000) / 1000
  return { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) }
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