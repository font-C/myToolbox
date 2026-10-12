/**
 * Node process 模块 stub — 浏览器环境的最小 process 实现。
 * word-extractor 的 polyfill 链（util / readable-stream 等）会 require('process')
 * 或引用全局 process，此桩同时兜底两种情形（officeExtract.js 亦会挂全局）。
 */
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
module.exports = globalThis.process
