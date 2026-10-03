/**
 * 形状裁剪路径。在矩形 (x, y, w, h) 内构造 Path2D。
 * circle / diamond 随矩形拉伸;star / hex / heart / drop 按短边等比取中。
 * radiusPx 仅对 rect 生效(用户圆角滑杆)。
 */

function rectPath(x, y, w, h) {
  const p = new Path2D()
  p.rect(x, y, w, h)
  return p
}

function rrPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  const p = new Path2D()
  p.moveTo(x + r, y)
  p.arcTo(x + w, y, x + w, y + h, r)
  p.arcTo(x + w, y + h, x, y + h, r)
  p.arcTo(x, y + h, x, y, r)
  p.arcTo(x, y, x + w, y, r)
  p.closePath()
  return p
}

// pts 为 [0,1]² 单位坐标;stretch=true 铺满矩形,false 按短边等比取中
function mapPts(pts, x, y, w, h, stretch) {
  const s = stretch ? null : Math.min(w, h)
  const ox = stretch ? x : x + (w - s) / 2
  const oy = stretch ? y : y + (h - s) / 2
  return pts.map(([px, py]) => [ox + px * (stretch ? w : s), oy + py * (stretch ? h : s)])
}

function polyPath(pts, x, y, w, h, stretch) {
  const m = mapPts(pts, x, y, w, h, stretch)
  const p = new Path2D()
  p.moveTo(m[0][0], m[0][1])
  for (let i = 1; i < m.length; i++) p.lineTo(m[i][0], m[i][1])
  p.closePath()
  return p
}

// 五角星(内半径比 0.382)
const STAR_PTS = (() => {
  const pts = []
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5
    const r = k % 2 === 0 ? 0.5 : 0.191
    pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)])
  }
  return pts
})()

// 六边形(尖顶)
const HEX_PTS = (() => {
  const pts = []
  for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 3
    pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)])
  }
  return pts
})()

// 心形参数曲线:x=16sin³t,y=13cost−5cos2t−2cos3t−cos4t(canvas y 向下,取反)
const HEART_PTS = (() => {
  const pts = []
  const N = 128
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2
    pts.push([0.5 + (16 * Math.pow(Math.sin(t), 3)) / 32, 0.5 - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 34])
  }
  return pts
})()

// 水滴:上尖 + 下圆,单位方形内构造
function dropPath(x, y, w, h) {
  const s = Math.min(w, h)
  const ox = x + (w - s) / 2
  const oy = y + (h - s) / 2
  const p = new Path2D()
  p.moveTo(ox + 0.5 * s, oy + 0.03 * s)
  p.bezierCurveTo(ox + 0.65 * s, oy + 0.28 * s, ox + 0.86 * s, oy + 0.4 * s, ox + 0.86 * s, oy + 0.6 * s)
  p.arc(ox + 0.5 * s, oy + 0.6 * s, 0.36 * s, 0, Math.PI, false)
  p.bezierCurveTo(ox + 0.14 * s, oy + 0.4 * s, ox + 0.35 * s, oy + 0.28 * s, ox + 0.5 * s, oy + 0.03 * s)
  p.closePath()
  return p
}

export function shapePath(shape, x, y, w, h, radiusPx = 0) {
  switch (shape) {
    case 'round':
      return rrPath(x, y, w, h, Math.min(w, h) * 0.22)
    case 'circle': {
      const p = new Path2D()
      p.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      return p
    }
    case 'diamond':
      return polyPath([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]], x, y, w, h, true)
    case 'star':
      return polyPath(STAR_PTS, x, y, w, h, false)
    case 'hex':
      return polyPath(HEX_PTS, x, y, w, h, false)
    case 'heart':
      return polyPath(HEART_PTS, x, y, w, h, false)
    case 'drop':
      return dropPath(x, y, w, h)
    case 'rect':
    default:
      return radiusPx > 0 ? rrPath(x, y, w, h, radiusPx) : rectPath(x, y, w, h)
  }
}

export const SHAPES = ['rect', 'round', 'circle', 'diamond', 'star', 'hex', 'heart', 'drop']
