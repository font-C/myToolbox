/**
 * Node fs 模块 stub — 仅满足 word-extractor / yauzl 在浏览器打包时的模块解析。
 * 提取流程始终以 Buffer 传参（BufferReader 路径），任何 fs 方法都不应被调用。
 * 采用 CJS + Proxy：属性访问返回抛错函数，便于定位误用。
 */
module.exports = new Proxy(
  {},
  {
    get(target, prop) {
      if (prop === '__esModule') return false
      return function () {
        throw new Error('fs stub 被调用：' + String(prop) + '（浏览器环境不应访问文件系统）')
      }
    },
  }
)
