// 验证 cropMath 归一化坐标换算为 pdf-lib CropBox、并对页生效导出后读取出正确尺寸。
// 供 CI/本地逻辑验证，不依赖 Tauri / 浏览器。
import { PDFDocument } from 'pdf-lib'
import { readFile } from 'node:fs/promises'
import { normalizedToPdfPoints } from '../src/utils/cropMath.js'

const assert = (cond, msg) => {
  if (!cond) throw new Error('断言失败: ' + msg)
}

async function main() {
  const raw = await readFile('./.test-data/sample.pdf')
  const src = await PDFDocument.load(raw)
  const pageInfos = src
    .getPages()
    .map((p, i) => ({ index: i + 1, width: p.getWidth(), height: p.getHeight() }))
  console.log('页尺寸:', pageInfos)

  const crop = { x: 0.25, y: 0.2, w: 0.5, h: 0.5 } // 首页左上角25%,20%起，占宽一半高一半
  const info = pageInfos[0]
  const box = normalizedToPdfPoints(crop, info.width, info.height)
  assert(box, 'box 不应为空')
  // 左上角原点 -> 左下原点校准
  assert(box.x === 100, `x 应为 100, got ${box.x}`)
  assert(box.y === 90, `y 应为 90, got ${box.y}`)
  assert(box.width === 200, `width 应为 200, got ${box.width}`)
  assert(box.height === 150, `height 应为 150, got ${box.height}`)
  console.log('换算 CropBox:', box)

  // 应用裁剪到第 1、3 页，第 2 页保持整页
  src.getPages().forEach((p, i) => {
    if (i + 1 !== 1 && i + 1 !== 3) return
    const b = normalizedToPdfPoints(crop, info.width, info.height)
    p.setMediaBox(b.x, b.y, b.width, b.height)
    p.setCropBox(b.x, b.y, b.width, b.height)
  })

  const out = await src.save()
  const dst = await PDFDocument.load(out)
  const b0 = dst.getPages()[0]
  const b2 = dst.getPages()[2]
  const uncropped = dst.getPages()[1]

  assert(Number(b0.getWidth().toFixed(2)) === 200, '裁剪后第1页宽应为200')
  assert(Number(b0.getHeight().toFixed(2)) === 150, '裁剪后第1页高应为150')
  assert(Number(b2.getWidth().toFixed(2)) === 200, '裁剪后第3页宽应为200')
  assert(Number(uncropped.getWidth().toFixed(2)) === 400, '第2页应保持整页400')
  assert(Number(uncropped.getHeight().toFixed(2)) === 300, '第2页应保持整页300')
  console.log('裁剪后第1/3页', b0.getWidth(), 'x', b0.getHeight(), '；第2页保持', uncropped.getWidth(), 'x', uncropped.getHeight())
  console.log('✓ 裁剪逻辑验证通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})