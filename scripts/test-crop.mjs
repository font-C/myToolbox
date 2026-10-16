// 验证 pdf-crop 的 cropMath：归一化坐标换算为未旋转用户空间的 CropBox（含页面旋转逆映射），
// 并对页生效导出后读取出正确尺寸。供 CI/本地逻辑验证，不依赖 Tauri / 浏览器。
import { PDFDocument, degrees } from 'pdf-lib'
import { readFile } from 'node:fs/promises'
import { normalizedToPdfPoints, normalizeRotation } from '../plugins/pdf-crop/src/cropMath.js'

const assert = (cond, msg) => {
  if (!cond) throw new Error('断言失败: ' + msg)
}
const eq = (a, b, msg) => assert(Math.abs(a - b) < 1e-6, `${msg}: 期望 ${b}, got ${a}`)

async function main() {
  // ---- 旋转角归一化（含负角）----
  assert(normalizeRotation(0) === 0, '0° 应为 0')
  assert(normalizeRotation(90) === 90, '90° 应为 90')
  assert(normalizeRotation(-90) === 270, '-90° 应归一化为 270')
  assert(normalizeRotation(450) === 90, '450° 应归一化为 90')
  assert(normalizeRotation(45) === 0, '非法角度按 0 处理')

  // ---- 各旋转角的坐标逆映射（未旋转用户空间 400x300，非对称裁剪框）----
  const crop = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }
  const mk = (rotation) => ({ rawWidth: 400, rawHeight: 300, rotation })

  const b0 = normalizedToPdfPoints(crop, mk(0))
  eq(b0.x, 40, '0° x'); eq(b0.y, 120, '0° y'); eq(b0.width, 120, '0° w'); eq(b0.height, 120, '0° h')

  const b90 = normalizedToPdfPoints(crop, mk(90))
  eq(b90.x, 80, '90° x'); eq(b90.y, 30, '90° y'); eq(b90.width, 160, '90° w'); eq(b90.height, 90, '90° h')

  const b180 = normalizedToPdfPoints(crop, mk(180))
  eq(b180.x, 240, '180° x'); eq(b180.y, 120, '180° y'); eq(b180.width, 120, '180° w'); eq(b180.height, 120, '180° h')

  const b270 = normalizedToPdfPoints(crop, mk(270))
  eq(b270.x, 160, '270° x'); eq(b270.y, 180, '270° y'); eq(b270.width, 160, '270° w'); eq(b270.height, 90, '270° h')

  const bNeg = normalizedToPdfPoints(crop, mk(-90))
  assert(JSON.stringify(bNeg) === JSON.stringify(b270), '-90° 映射应与 270° 一致')

  // ---- roundtrip：旋转 90° 的页应用裁剪后，尺寸与旋转角保持一致 ----
  const raw = await readFile('./.test-data/sample.pdf')
  const src = await PDFDocument.load(raw)
  const page0 = src.getPages()[0]
  const wu = page0.getWidth()
  const hu = page0.getHeight()
  page0.setRotation(degrees(90))
  const box = normalizedToPdfPoints(crop, { rawWidth: wu, rawHeight: hu, rotation: 90 })
  page0.setMediaBox(box.x, box.y, box.width, box.height)
  page0.setCropBox(box.x, box.y, box.width, box.height)

  const out = await src.save()
  const dst = await PDFDocument.load(out)
  const p0 = dst.getPages()[0]
  eq(p0.getWidth(), box.width, '旋转页裁剪后宽')
  eq(p0.getHeight(), box.height, '旋转页裁剪后高')
  eq(p0.getRotation().angle, 90, '输出页保留 /Rotate')

  // ---- 未旋转页裁剪 roundtrip（沿用 sample.pdf 多页）----
  const page2 = dst.getPages()[2]
  eq(Number(page2.getWidth().toFixed(2)), 400, '未裁剪页保持整页宽 400')
  eq(Number(page2.getHeight().toFixed(2)), 300, '未裁剪页保持整页高 300')

  console.log('✓ 裁剪逻辑（含旋转逆映射）验证通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
