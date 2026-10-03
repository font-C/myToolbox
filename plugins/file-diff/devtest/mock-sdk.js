/**
 * devtest mock SDK — 浏览器测试环境用。
 * 替换 @toolbox/plugin-sdk，用 canned 数据模拟目录选择 / 文件读取，
 * 使 App.vue 可以在纯浏览器中渲染与交互（无 Tauri）。
 */

const DIR_L = '/test/原目录'
const DIR_R = '/test/新目录'

const DIRS = {
  [DIR_L]: {
    entries: [
      { path: 'README.md', size: 100 },
      { path: 'assets/logo.png', size: 2048 },
      { path: 'docs/guide.md', size: 300 },
      { path: 'notes.txt', size: 50 },
      { path: 'src/App.vue', size: 900 },
      { path: 'src/util.js', size: 400 },
    ],
    truncated: false,
  },
  [DIR_R]: {
    entries: [
      { path: 'README.md', size: 100 },
      { path: 'assets/logo.png', size: 4096 },
      { path: 'docs/new.md', size: 220 },
      { path: 'src/App.vue', size: 980 },
      { path: 'src/util.js', size: 400 },
    ],
    truncated: false,
  },
}

const enc = new TextEncoder()
const FILES = {
  [DIR_L + '/README.md']: enc.encode('# 项目\n\n说明文本，两侧一致。\n'),
  [DIR_R + '/README.md']: enc.encode('# 项目\n\n说明文本，两侧一致。\n'),
  [DIR_L + '/src/App.vue']: enc.encode('<template>\n  <div class="app">\n    <h1>标题</h1>\n    <p>旧的内容</p>\n  </div>\n</template>\n'),
  [DIR_R + '/src/App.vue']: enc.encode(
    '<template>\n  <div class="app">\n    <h1>新标题</h1>\n    <p>新的内容，这里有更多文字</p>\n  </div>\n</template>\n<script>\nexport default { name: "App" }\n</script>\n'
  ),
  [DIR_L + '/src/util.js']: enc.encode('export function add(a, b) {\n  return a + b\n}\n'),
  [DIR_R + '/src/util.js']: enc.encode('export function add(a, b) {\n  return a + b\n}\n'),
  [DIR_L + '/docs/guide.md']: enc.encode('# 指南\n\n仅原目录有此文件。\n'),
  [DIR_R + '/docs/new.md']: enc.encode('# 新文档\n\n仅新目录有此文件。\n'),
  [DIR_L + '/notes.txt']: enc.encode('仅原目录的便签\n'),
  // 含 NUL 字节 → 走二进制分支；两侧内容不同
  [DIR_L + '/assets/logo.png']: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
  [DIR_R + '/assets/logo.png']: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9, 9]),
  // 文件对比页：A/B 内容不同（首个差异在第 3 字节），A 与 A 相同
  '/test/文件A.bin': new Uint8Array([1, 2, 3]),
  '/test/文件B.bin': new Uint8Array([1, 2, 4]),
}

// pickOpenFile 调用顺序：A, B, A, A, A, B, …（测试「不一致」与「一致」两种判定）
const PICK_SEQ = ['/test/文件A.bin', '/test/文件B.bin', '/test/文件A.bin', '/test/文件A.bin']
let fileSeq = 0
let pickSeq = 0

export const toolbox = {
  async pickDirectory() {
    const path = pickSeq++ % 2 === 0 ? DIR_L : DIR_R
    return { path, name: path.split('/').pop() }
  },
  async pickOpenFile() {
    const path = PICK_SEQ[fileSeq++ % PICK_SEQ.length]
    const bytes = FILES[path]
    return [{ path, name: path.split('/').pop(), bytes: bytes.slice() }]
  },
  async listDir(path) {
    const d = DIRS[path]
    if (!d) throw new Error('mock: 未授权目录 ' + path)
    return { entries: d.entries.map((e) => ({ ...e })), truncated: d.truncated }
  },
  async dirInfo(path) {
    return DIRS[path] ? { entries: DIRS[path].entries.map((e) => ({ ...e })), truncated: false } : null
  },
  async readGranted(path) {
    const b = FILES[path]
    if (!b) throw new Error('mock: 无文件 ' + path)
    return b.slice()
  },
  async pickSaveFile(options) {
    console.log('[mock] save →', options?.defaultName, `${options?.bytes?.length ?? 0} bytes`)
    return '/mock/' + (options?.defaultName || 'out')
  },
  onDragDrop() {
    return () => {}
  },
  async close() {},
}

export async function isTauri() {
  return false
}

export function useNativeFileDrop() {
  return () => {}
}

export default toolbox
