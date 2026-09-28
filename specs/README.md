# MyToolbox 插件开发规范 · 总览

> 版本 1.0（对应宿主 0.3.0）· 本目录所有文档随代码入库，是插件开发的唯一权威契约。

## 一、阅读顺序

| 文档 | 内容 | 什么时候读 |
|---|---|---|
| [00-overview.md](./00-overview.md) | 架构与安全模型 | 想了解插件如何运行 |
| [01-manifest.md](./01-manifest.md) | manifest.json 字段规范 | 必读，建包第一步 |
| [manifest.schema.json](./manifest.schema.json) | manifest 的 JSON Schema | 校验器/编辑器提示 |
| [02-permissions.md](./02-permissions.md) | 权限目录与授权模型 | 需要文件/打印能力时 |
| [03-sdk-api.md](./03-sdk-api.md) | @toolbox/plugin-sdk API 参考 | 必读，写代码时 |
| [04-packaging-signing.md](./04-packaging-signing.md) | .tbox 打包、哈希与签名 | 打包发布前 |
| [05-dev-guide.md](./05-dev-guide.md) | 开发、调试、上架全流程 | 新手从这开始 |
| [06-store-publish.md](./06-store-publish.md) | 商店索引契约与双源发布 | 维护商店时 |

## 二、一分钟了解

- 插件 = 一个 zip 包（`.tbox`）：`manifest.json` + `icon.png` + 一个自包含的前端应用（Vite 构建）
- 每个插件运行在**独立的原生窗口**里（Tauri WebviewWindow），JS 上下文互不干扰
- 插件不能直接访问文件系统/打印机；一切敏感能力经宿主的 **Rust 权限代理（broker）**，
  且必须先在 manifest 里声明权限、由用户动作（对话框/拖拽）授权
- v1 插件**没有网络权限**（页面 CSP 禁止远程请求），必须离线自足
- 商店是纯静态托管（GitHub Pages 主源 + Gitee 镜像），插件包经 **Ed25519 签名**，宿主内置公钥验签

## 三、兼容性承诺

- `formatVersion: 1` 与 `apiVersion: 1` 是当前契约；宿主升级保证向后兼容
  （apiVersion ≤ 宿主支持值 的插件永远可运行）
- manifest 已知字段不会改变含义；新增字段只增不改
- SDK API 的破坏性变更会 bump `apiVersion`，宿主拒绝加载超出自身支持版本的插件

## 四、变更流程

1. 修改规范（specs/）与 `packages/plugin-sdk` 同一 PR
2. `apiVersion` 变更必须同步更新 `src-tauri/src/plugin_manifest.rs::HOST_API_VERSION`
3. 三个内置插件（plugins/pdf-crop、pdf-compose、mental-math）是最权威的参考实现，
   规范与实现冲突时以能跑通的实现为准，并当天修订规范
