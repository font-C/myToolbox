import { PDFDocument } from 'pdf-lib'
import { zipSync } from 'fflate'

/**
 * 把源 PDF 的指定页（0-based 数组，顺序即输出顺序）导出为新 PDF 字节。
 * 每次都重新 load 源文档？——大文件下按组 load 开销可观；这里由调用方传入
 * 已加载并复用的 PDFDocument 实例（pdf-lib 的 copyPages 需要源文档对象）。
 */
export async function exportPages(srcDoc, pageIndices) {
  const out = await PDFDocument.create()
  const copied = await out.copyPages(srcDoc, pageIndices)
  copied.forEach((p) => out.addPage(p))
  return out.save()
}

/** 打开源文档（pdf-lib）。加密/损坏文件会 rejected，交由 UI 提示。 */
export async function loadSource(bytes) {
  return PDFDocument.load(bytes, { ignoreEncryption: false })
}

/** 多个输出打包为 zip 字节 */
export function makeZip(files) {
  const map = {}
  for (const f of files) {
    let name = f.name
    let i = 2
    while (map[name]) name = f.name.replace(/\.pdf$/i, `_${i}.pdf`)
    map[name] = f.bytes
  }
  return zipSync(map, { level: 6 })
}
