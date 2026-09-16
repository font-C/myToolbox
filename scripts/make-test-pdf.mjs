// 生成一个 3 页的测试 PDF，各页内容位置不同，便于验证裁剪效果。
import { PDFDocument, rgb } from 'pdf-lib'

const W = 400
const H = 300

async function main() {
  const doc = await PDFDocument.create()
  const pages = [doc.addPage([W, H]), doc.addPage([W, H]), doc.addPage([W, H])]

  pages.forEach((page, i) => {
    const cx = 80 + i * 90 // 每页色块位置不同
    page.drawRectangle({ x: cx, y: 60, width: 140, height: 100, color: rgb(0.2, 0.5, 0.9) })
    page.drawText(`Page ${i + 1}`, { x: cx, y: 200, size: 24, color: rgb(0, 0, 0) })
    page.drawRectangle({ x: 20, y: 20, width: 60, height: 40, color: rgb(0.9, 0.3, 0.2) })
  })

  const bytes = await doc.save()
  const fs = await import('node:fs/promises')
  await fs.writeFile('./.test-data/sample.pdf', Buffer.from(bytes))
  console.log('已生成 .test-data/sample.pdf，页尺寸', W, 'x', H)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})