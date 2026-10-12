/**
 * Node 内置模块 → 浏览器 polyfill/stub 的 alias 映射（构建与 devtest 共用）。
 * word-extractor 面向 Node 生态编写；提取流程始终以 Buffer 传参，
 * fs/zlib 仅需打包可解析、不会被真正调用（见 fs-stub.cjs / zlib-stub.cjs）。
 */
import { fileURLToPath } from 'node:url'

const shim = (p) => fileURLToPath(new URL(p, import.meta.url))

export const nodeShims = {
  fs: shim('./fs-stub.cjs'),
  zlib: shim('./zlib-stub.cjs'),
  process: shim('./process-shim.cjs'),
  buffer: 'buffer',
  stream: 'readable-stream',
  events: 'events',
  util: 'util',
  path: 'path-browserify',
}
