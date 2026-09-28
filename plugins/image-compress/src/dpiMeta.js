/**
 * 图片 DPI（物理尺寸）元数据读写——纯字节操作，不重新编码。
 *
 * canvas toBlob 不支持写入分辨率，因此「仅改 DPI（像素不变）」和
 * 「重采样后携带物理尺寸」都需要在编码结果上直接改二进制：
 * - JPEG：JFIF APP0 段的 units/Xdensity/Ydensity
 * - PNG：pHYs chunk（每米像素数）
 */

/** 标准 CRC32（PNG chunk 校验用） */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * 修改 JPEG 的 JFIF 分辨率。要求文件带 JFIF APP0（浏览器编码器输出的 JPEG 都带）。
 * @returns {Uint8Array|null} 修改后的字节；找不到 JFIF 头返回 null
 */
export function jpegSetDpi(bytes, dpi) {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]
    if (marker === 0xda) return null // 进入扫描数据仍未见到 JFIF
    if (marker === 0xe0) {
      const jfif =
        bytes[i + 4] === 0x4a && bytes[i + 5] === 0x46 && bytes[i + 6] === 0x49 && bytes[i + 7] === 0x46 && bytes[i + 8] === 0x00
      if (!jfif) {
        const len = (bytes[i + 2] << 8) | bytes[i + 3]
        i += 2 + len
        continue
      }
      const out = bytes.slice()
      out[i + 11] = 1 // units: 1 = 像素/英寸
      out[i + 12] = (dpi >> 8) & 0xff
      out[i + 13] = dpi & 0xff
      out[i + 14] = (dpi >> 8) & 0xff
      out[i + 15] = dpi & 0xff
      return out
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    if (len < 2) return null
    i += 2 + len
  }
  return null
}

function be32(b, i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
}
function setBe32(b, i, v) {
  b[i] = (v >>> 24) & 0xff
  b[i + 1] = (v >>> 16) & 0xff
  b[i + 2] = (v >>> 8) & 0xff
  b[i + 3] = v & 0xff
}
function chunkType(b, i) {
  return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3])
}

/**
 * 修改 PNG 的 pHYs（物理分辨率）。pHYs 单位固定为"每米像素"。
 * @returns {Uint8Array|null} 修改/插入后的字节；非 PNG 返回 null
 */
export function pngSetDpi(bytes, dpi) {
  if (bytes.length < 57 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null
  const ppm = Math.round(dpi / 0.0254)
  const IHDR_END = 8 + 25 // 签名8 + IHDR chunk(4len+4type+13data+4crc)

  // 先找已有 pHYs（必须在 IDAT 之前），就地更新
  let i = 8
  while (i + 8 <= bytes.length) {
    const len = be32(bytes, i)
    const type = chunkType(bytes, i + 4)
    if (type === 'pHYs') {
      const out = bytes.slice()
      setBe32(out, i + 8, ppm)
      setBe32(out, i + 12, ppm)
      out[i + 16] = 1 // unit = 米
      const body = out.slice(i + 4, i + 8 + 9) // type + data
      setBe32(out, i + 17, crc32(body))
      return out
    }
    if (type === 'IDAT') break
    if (type === 'IEND') break
    i += 12 + len
  }

  // 无 pHYs：在 IHDR 之后插入
  const chunk = new Uint8Array(21)
  setBe32(chunk, 0, 9)
  chunk.set([0x70, 0x48, 0x59, 0x73], 4) // 'pHYs'
  setBe32(chunk, 8, ppm)
  setBe32(chunk, 12, ppm)
  chunk[16] = 1
  setBe32(chunk, 17, crc32(chunk.subarray(4, 17)))
  const out = new Uint8Array(bytes.length + 21)
  out.set(bytes.subarray(0, IHDR_END), 0)
  out.set(chunk, IHDR_END)
  out.set(bytes.subarray(IHDR_END), IHDR_END + 21)
  return out
}
