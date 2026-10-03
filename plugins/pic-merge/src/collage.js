import { shapePath } from './shapes.js'

const PLACE_COLORS = ['#94a3b8', '#7e8ca3']

/**
 * 把模板渲染到画布。imgs 与 tpl.cells 按序对应,缺项留空(或占位色)。
 * opts:
 *   gap / margin / radius —— 逻辑 px,以 refEdge(默认 1000)为基准缩放
 *   fit        'cover' 裁剪填满 | 'contain' 完整显示
 *   bg / transparent  背景色;transparent 时不铺底(PNG 透明)
 *   placeholder  无图格子填占位色(模板缩略图用)
 *   previewEmpty 无图格子铺淡色(实时预览用)
 *   absolute     gap/margin/radius 直接按画布像素使用(缩略图用)
 */
export function renderTemplate(canvas, tpl, imgs, opts = {}) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  if (!W || !H || !tpl) return
  const k = opts.absolute ? 1 : Math.max(W, H) / (opts.refEdge ?? 1000)
  const gap = Math.max(0, opts.gap ?? 12) * k
  const margin = Math.max(0, opts.margin ?? 16) * k
  const outer = Math.max(0, margin - gap / 2)
  const radius = Math.max(0, opts.radius ?? 0) * k

  if (!opts.transparent) {
    ctx.fillStyle = opts.bg || '#ffffff'
    ctx.fillRect(0, 0, W, H)
  }

  const cw = W - outer * 2
  const ch = H - outer * 2
  if (cw <= 0 || ch <= 0) return

  tpl.cells.forEach((cell, i) => {
    const rx = outer + cell.x * cw + gap / 2
    const ry = outer + cell.y * ch + gap / 2
    const rw = cell.w * cw - gap
    const rh = cell.h * ch - gap
    if (rw < 1 || rh < 1) return

    const path = shapePath(cell.shape, rx, ry, rw, rh, radius)
    const img = imgs ? imgs[i] : null
    ctx.save()
    ctx.clip(path)
    if (img && img.width) {
      const cover = opts.fit !== 'contain'
      const s = cover ? Math.max(rw / img.width, rh / img.height) : Math.min(rw / img.width, rh / img.height)
      const dw = img.width * s
      const dh = img.height * s
      ctx.drawImage(img, rx + (rw - dw) / 2, ry + (rh - dh) / 2, dw, dh)
    } else if (opts.placeholder) {
      ctx.fillStyle = PLACE_COLORS[i % PLACE_COLORS.length]
      ctx.fill(path)
    } else if (opts.previewEmpty) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.16)'
      ctx.fill(path)
    }
    ctx.restore()
  })
}
