/**
 * Node zlib 模块 stub — 仅满足 yauzl（word-extractor 的 .docx 分支依赖）在
 * 浏览器打包时的模块解析。.doc 一律走 OLE 解析（不经 zlib）；.docx 走 mammoth
 * （自带 jszip 解压），因此任何 zlib 方法都不应被调用。
 */
module.exports = new Proxy(
  {},
  {
    get(target, prop) {
      if (prop === '__esModule') return false
      return function () {
        throw new Error('zlib stub 被调用：' + String(prop) + '（.docx 解压由 mammoth/jszip 处理）')
      }
    },
  }
)
