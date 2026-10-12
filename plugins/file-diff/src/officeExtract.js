/**
 * Word 文档文本提取：.docx → mammoth，.doc → word-extractor。
 *
 * 两库均按需动态加载（Vite 自动分包），仅在首次对比 Word 文件时加载对应 chunk，
 * 不影响插件初始打开速度。提取产物为「段落 = 行」的纯文本，与 diffcore 的
 * 行级差异引擎天然契合。
 *
 * 运行环境为浏览器 WebView，word-extractor 内部代码引用全局 Buffer，
 * 模块加载时先挂 npm buffer polyfill 兜底（打包时 'buffer' 已 alias 到 polyfill）。
 */
import { Buffer } from 'buffer'

if (!globalThis.Buffer) globalThis.Buffer = Buffer

// word-extractor 的 polyfill 链（util / readable-stream 等）引用 Node 全局 process，
// 浏览器需先兜底最小桩（本模块先于依赖 chunk 初始化，保证动态加载前就绪）
if (!globalThis.process) {
  globalThis.process = {
    env: {},
    argv: [],
    pid: 0,
    platform: 'browser',
    version: '',
    versions: {},
    cwd: () => '/',
    chdir: () => {},
    nextTick: (fn, ...args) => Promise.resolve().then(() => fn(...args)),
    binding: () => {
      throw new Error('process.binding 在浏览器不可用')
    },
  }
}

/** 缓存动态 import 的模块，避免重复加载 */
let mammothMod = null
let wordExtractorMod = null

function loadMammoth() {
  mammothMod ??= import('mammoth')
  return mammothMod
}

function loadWordExtractor() {
  wordExtractorMod ??= import('word-extractor')
  return wordExtractorMod
}

/** 文件名是否为 Word 文档（.doc / .docx，忽略大小写） */
export function isWordFile(name) {
  return /\.docx?$/i.test(name || '')
}

/**
 * 提取 Word 文档纯文本。
 * 按扩展名分流：.docx 走 mammoth（浏览器可用），.doc 走 word-extractor
 * （其 .docx 分支依赖真实 fs，浏览器不可用，故不采用自动识别）。
 * @param {Uint8Array} bytes
 * @param {string} name 文件名（用于分流与错误提示）
 * @returns {Promise<{ text: string, encoding: string }>} encoding 用于卡片元信息展示
 */
export async function extractWordText(bytes, name) {
  // .docx 走 mammoth browser 版：其 openZip 只认 arrayBuffer 选项（lib 版才是 buffer）
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  try {
    let text
    let encoding
    if (/\.docx$/i.test(name || '')) {
      const mammoth = await loadMammoth()
      text = (await mammoth.default.extractRawText({ arrayBuffer })).value
      encoding = 'Word 文档'
    } else {
      const { default: WordExtractor } = await loadWordExtractor()
      text = await new WordExtractor().extract(Buffer.from(bytes)).then((doc) => doc.getBody())
      encoding = 'Word 97-2003'
    }
    // 统一换行符为 \n（splitLines 虽兼容 \r\n，此处归一保证行号口径一致）
    return { text: text.replace(/\r\n?/g, '\n'), encoding }
  } catch (e) {
    // 附带原始错误信息便于定位（损坏 / 加密 / 环境异常各有不同报错）
    throw new Error(`无法解析 Word 文档「${name}」，文件可能已损坏或设置了密码（${e?.message || e}）`)
  }
}
