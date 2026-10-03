/**
 * 拼图模板定义。cells 归一化到 [0,1]×[0,1],渲染时映射到画布内容区(边距内)。
 * cat: grid=等分宫格 / mix=大小混排 / shape=异形蒙版
 * shape ∈ rect | round | circle | diamond | star | hex | heart | drop
 */

function gridCells(cols, rows, shape = 'rect') {
  const cells = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      cells.push({ x: c / cols, y: r / rows, w: 1 / cols, h: 1 / rows, shape })
  return cells
}

function T(id, name, cat, aspect, cells) {
  return { id, name, cat, aspect, cells }
}

// 13 格像素爱心(5 列 × 4 行)
function heartCells() {
  const rows = [[0, 1, 3, 4], [0, 1, 2, 3, 4], [1, 2, 3], [2]]
  const cells = []
  rows.forEach((cols, r) =>
    cols.forEach((c) => cells.push({ x: c * 0.2, y: 0.1 + r * 0.2, w: 0.2, h: 0.2, shape: 'rect' })),
  )
  return cells
}

// 7 格六边形蜂窝(尖顶,中心 1 + 环绕 6)
function honeyCells() {
  const S3 = Math.sqrt(3)
  const TW = 3 * S3
  const TH = 5
  const AX = [[0, 0], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]
  return AX.map(([q, r]) => {
    const cx = S3 * (q + r / 2)
    const cy = 1.5 * r
    return { x: (cx - S3 / 2 + TW / 2) / TW, y: (cy - 1 + TH / 2) / TH, w: S3 / TW, h: 2 / TH, shape: 'hex' }
  })
}

export const TEMPLATES = [
  // —— 2 格
  T('g2v', '左右两张', 'grid', 1, gridCells(2, 1)),
  T('g2h', '上下两张', 'grid', 1, gridCells(1, 2)),
  T('m2a', '左大右小', 'mix', 1, [{ x: 0, y: 0, w: 0.62, h: 1 }, { x: 0.62, y: 0, w: 0.38, h: 1 }]),
  T('m2b', '上大下小', 'mix', 1, [{ x: 0, y: 0, w: 1, h: 0.62 }, { x: 0, y: 0.62, w: 1, h: 0.38 }]),

  // —— 3 格
  T('g3v', '横排三张', 'grid', 3, gridCells(3, 1)),
  T('g3h', '竖排三张', 'grid', 1 / 3, gridCells(1, 3)),
  T('m3a', '左大右二', 'mix', 1, [{ x: 0, y: 0, w: 0.6, h: 1 }, { x: 0.6, y: 0, w: 0.4, h: 0.5 }, { x: 0.6, y: 0.5, w: 0.4, h: 0.5 }]),
  T('m3b', '右大左二', 'mix', 1, [{ x: 0.4, y: 0, w: 0.6, h: 1 }, { x: 0, y: 0, w: 0.4, h: 0.5 }, { x: 0, y: 0.5, w: 0.4, h: 0.5 }]),
  T('m3c', '上大下二', 'mix', 1, [{ x: 0, y: 0, w: 1, h: 0.6 }, { x: 0, y: 0.6, w: 0.5, h: 0.4 }, { x: 0.5, y: 0.6, w: 0.5, h: 0.4 }]),
  T('m3d', '下大上二', 'mix', 1, [{ x: 0, y: 0, w: 0.5, h: 0.4 }, { x: 0.5, y: 0, w: 0.5, h: 0.4 }, { x: 0, y: 0.4, w: 1, h: 0.6 }]),

  // —— 4 格
  T('g4', '四宫格', 'grid', 1, gridCells(2, 2)),
  T('g4v', '横排四张', 'grid', 4, gridCells(4, 1)),
  T('g4h', '竖排四张', 'grid', 0.25, gridCells(1, 4)),
  T('m4a', '左大右三', 'mix', 1, [{ x: 0, y: 0, w: 0.62, h: 1 }, { x: 0.62, y: 0, w: 0.38, h: 1 / 3 }, { x: 0.62, y: 1 / 3, w: 0.38, h: 1 / 3 }, { x: 0.62, y: 2 / 3, w: 0.38, h: 1 / 3 }]),
  T('m4b', '上大下三', 'mix', 1, [{ x: 0, y: 0, w: 1, h: 0.62 }, { x: 0, y: 0.62, w: 1 / 3, h: 0.38 }, { x: 1 / 3, y: 0.62, w: 1 / 3, h: 0.38 }, { x: 2 / 3, y: 0.62, w: 1 / 3, h: 0.38 }]),

  // —— 5 格
  T('m5a', '左大右四', 'mix', 1, [...gridCells(2, 2).map((c) => ({ ...c, x: 0.6 + c.x * 0.4, y: c.y, w: c.w * 0.4, h: c.h })), { x: 0, y: 0, w: 0.6, h: 1 }]),
  T('m5b', '上大下四', 'mix', 1, [...gridCells(2, 2).map((c) => ({ ...c, x: c.x, y: 0.6 + c.y * 0.4, w: c.w, h: c.h * 0.4 })), { x: 0, y: 0, w: 1, h: 0.6 }]),
  T('m5c', '上二下三', 'mix', 1, [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 1 / 3, h: 0.5 }, { x: 1 / 3, y: 0.5, w: 1 / 3, h: 0.5 }, { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 }]),
  T('g5v', '横排五张', 'grid', 5, gridCells(5, 1)),

  // —— 6 格
  T('g6a', '六宫格·竖', 'grid', 2 / 3, gridCells(2, 3)),
  T('g6b', '六宫格·横', 'grid', 1.5, gridCells(3, 2)),
  T('m6a', '上二下四', 'mix', 1, [{ x: 0, y: 0, w: 0.5, h: 0.6 }, { x: 0.5, y: 0, w: 0.5, h: 0.6 }, ...gridCells(4, 1).map((c) => ({ ...c, y: 0.6, w: c.w, h: 0.4 }))]),
  T('g6v', '横排六张', 'grid', 6, gridCells(6, 1)),

  // —— 更多
  T('g9', '九宫格', 'grid', 1, gridCells(3, 3)),
  T('g8a', '四行两列', 'grid', 2, gridCells(2, 4)),
  T('g12', '十二宫格', 'grid', 4 / 3, gridCells(4, 3)),
  T('g16', '十六宫格', 'grid', 1, gridCells(4, 4)),

  // —— 异形蒙版
  T('s1c', '单图圆形', 'shape', 1, [{ x: 0, y: 0, w: 1, h: 1, shape: 'circle' }]),
  T('s2c', '双圆', 'shape', 2, gridCells(2, 1, 'circle')),
  T('s3c', '品字三圆', 'shape', 1, [
    { x: 0.25, y: 0, w: 0.5, h: 0.5, shape: 'circle' },
    { x: 0, y: 0.52, w: 0.48, h: 0.48, shape: 'circle' },
    { x: 0.52, y: 0.52, w: 0.48, h: 0.48, shape: 'circle' },
  ]),
  T('s4c', '四圆', 'shape', 1, gridCells(2, 2, 'circle')),
  T('s6c', '六圆', 'shape', 1.5, gridCells(3, 2, 'circle')),
  T('s9c', '九圆', 'shape', 1, gridCells(3, 3, 'circle')),
  T('s4m', '圆方混排', 'shape', 1, [
    { x: 0, y: 0, w: 0.5, h: 0.5, shape: 'circle' },
    { x: 0.5, y: 0, w: 0.5, h: 0.5, shape: 'rect' },
    { x: 0, y: 0.5, w: 0.5, h: 0.5, shape: 'rect' },
    { x: 0.5, y: 0.5, w: 0.5, h: 0.5, shape: 'circle' },
  ]),
  T('s3m', '异形三格', 'shape', 1, [
    { x: 0, y: 0, w: 0.5, h: 0.5, shape: 'circle' },
    { x: 0.5, y: 0, w: 0.5, h: 0.5, shape: 'hex' },
    { x: 0, y: 0.5, w: 1, h: 0.5, shape: 'round' },
  ]),
  T('s1h', '单图心形', 'shape', 1, [{ x: 0, y: 0, w: 1, h: 1, shape: 'heart' }]),
  T('s2h', '双心', 'shape', 1, [
    { x: 0, y: 0.04, w: 0.56, h: 0.92, shape: 'heart' },
    { x: 0.44, y: 0.04, w: 0.56, h: 0.92, shape: 'heart' },
  ]),
  T('s13h', '爱心拼图', 'shape', 1, heartCells()),
  T('s1s', '单图五角星', 'shape', 1, [{ x: 0, y: 0, w: 1, h: 1, shape: 'star' }]),
  T('s1x', '单图六边形', 'shape', 1, [{ x: 0, y: 0, w: 1, h: 1, shape: 'hex' }]),
  T('s1d', '单图水滴', 'shape', 1, [{ x: 0, y: 0, w: 1, h: 1, shape: 'drop' }]),
  T('s1dia', '单图菱形', 'shape', 1, [{ x: 0, y: 0, w: 1, h: 1, shape: 'diamond' }]),
  T('s7x', '蜂窝七格', 'shape', (3 * Math.sqrt(3)) / 5, honeyCells()),
]

/** 自定义行列宫格 */
export function customGridTemplate(rows, cols) {
  return T('custom', `${rows} × ${cols} 宫格`, 'grid', cols / rows, gridCells(cols, rows))
}

/** 按筛选条件取模板列表:filter ∈ '2'|'3'|'4'|'5'|'6'|'more'|'shape'|'' */
export function filterTemplates(filter) {
  if (!filter || filter === 'custom') return TEMPLATES
  if (filter === 'shape') return TEMPLATES.filter((t) => t.cat === 'shape')
  if (filter === 'more') return TEMPLATES.filter((t) => t.cat !== 'shape' && t.cells.length >= 7)
  return TEMPLATES.filter((t) => t.cat !== 'shape' && t.cells.length === Number(filter))
}
