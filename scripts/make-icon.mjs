// 生成一个 1024x1024 RGBA PNG（纯 JS，生成简单图标源图），供 `tauri icon` 使用。
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

const SIZE = 1024
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)

for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    const off = y * (SIZE * 4 + 1) + 1 + x * 4
    // 圆角矩形内的蓝白渐变作为图标主体
    const cx = x - SIZE / 2
    const cy = y - SIZE / 2
    const r = SIZE / 2 - 48
    const inside = cx * cx + cy * cy <= r * r
    if (inside) {
      const t = (cx + SIZE / 2) / SIZE
      raw[off] = Math.round(30 + 140 * t) // R
      raw[off + 1] = Math.round(90 + 120 * t) // G
      raw[off + 2] = 220 // B
      raw[off + 3] = 255
    } else {
      raw[off] = 0
      raw[off + 1] = 0
      raw[off + 2] = 0
      raw[off + 3] = 0
    }
  }
}

const crcTable = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
const idat = zlib.deflateSync(raw)

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
])

const outDir = path.resolve(import.meta.dirname, '..')
fs.writeFileSync(path.join(outDir, 'app-icon.png'), png)
console.log('已生成 app-icon.png')