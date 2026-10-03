export const MAX_DIM = 8192

/**
 * 计算长图布局(逻辑像素)。
 * imgs: 已加载的 Image,[{ url, width, height }]
 * opts: { direction:'v'|'h', mode:'widest'|'custom', base, align:'fit'|'center', gap, margin }
 *   align 'fit'    全部等比缩放到目标宽/高
 *   align 'center' 宽图等比缩小、窄图按原尺寸居中
 */
export function layoutStrip(opts, imgs) {
  const v = opts.direction !== 'h'
  const natural = imgs.map((im) => (v ? im.width : im.height))
  const B = opts.mode === 'custom' ? Math.max(64, Number(opts.base) || 800) : Math.max(1, ...natural)
  const gap = Math.max(0, Number(opts.gap) || 0)
  const m = Math.max(0, Number(opts.margin) || 0)
  const cells = []
  let main = m

  imgs.forEach((im, i) => {
    const iw = im.width
    const ih = im.height
    let cw
    let chh
    const over = v ? iw > B : ih > B
    if (opts.align !== 'center' || over) {
      if (v) {
        cw = B
        chh = (ih * B) / iw
      } else {
        chh = B
        cw = (iw * B) / ih
      }
    } else {
      cw = iw
      chh = ih
    }
    if (v) {
      cells.push({ img: im, x: m + (B - cw) / 2, y: main, w: cw, h: chh })
    } else {
      cells.push({ img: im, x: main, y: m + (B - chh) / 2, w: cw, h: chh })
    }
    main += (v ? chh : cw) + (i < imgs.length - 1 ? gap : 0)
  })

  return v
    ? { W: Math.round(B + m * 2), H: Math.round(main + m), cells, gap, margin: m }
    : { W: Math.round(main + m), H: Math.round(B + m * 2), cells, gap, margin: m }
}

/** 超过 8192 上限时整体等比缩小 */
export function capLayout(lay) {
  const s = Math.min(1, MAX_DIM / Math.max(lay.W, lay.H))
  if (s === 1) return lay
  return {
    W: Math.round(lay.W * s),
    H: Math.round(lay.H * s),
    gap: lay.gap * s,
    margin: lay.margin * s,
    cells: lay.cells.map((c) => ({ img: c.img, x: c.x * s, y: c.y * s, w: c.w * s, h: c.h * s })),
  }
}

/** 渲染到画布;画布宽高须与 lay.W/H 同比例 */
export function renderStrip(canvas, lay, opts = {}) {
  const ctx = canvas.getContext('2d')
  if (!opts.transparent) {
    ctx.fillStyle = opts.bg || '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  const k = canvas.width / lay.W
  ctx.setTransform(k, 0, 0, k, 0, 0)
  for (const c of lay.cells) {
    ctx.drawImage(c.img, c.x, c.y, c.w, c.h)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}
