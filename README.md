# MyToolbox · 插件化本地工具箱

Tauri 2 + Vue 3 的桌面工具箱。**壳子极小**：启动台、插件商店、插件管理与设置；
所有工具（含内置的三个）都是符合规范的 **.tbox 插件**，运行在独立的原生窗口里。

## 架构

```
宿主壳子（主窗口）
  ├─ 启动台：已装插件网格 → plugin:// 协议打开独立插件窗口
  ├─ 商店：静态索引（GitHub Pages 主源 + Gitee 镜像）→ 下载 → 验签 → 安装
  ├─ 插件管理：启停 / 卸载 / 本地导入 .tbox / 开发插件目录直载
  └─ 设置：启动行为（启动台 / 指定插件）

Rust 插件内核（src-tauri）
  ├─ plugin:// 自定义协议：MIME / 路径穿越防护 / 插件页严格 CSP
  ├─ 权限代理 broker：文件对话框、会话授权路径读写、打印
  ├─ 安装器：.tbox 解包、sha256 校验、Ed25519 验签、原子落盘
  └─ 内置插件：三个工具编译期嵌入，启动时确保安装/升级
```

内置工具：**PDF 裁剪**（plugins/pdf-crop）、**PDF 拼接**（plugins/pdf-compose）、
**口算练习**（plugins/mental-math）——它们同时是插件规范的参考实现。

## 开发

```bash
npm install                 # 安装（npm workspaces：壳子 + SDK + 插件）
npm run tauri dev           # 开发调试（会先构建插件包）
npm run build:plugins       # 打包全部插件 → src-tauri/builtin/*.tbox
npm run build:all           # 壳子 + 插件（发布前）
cargo test                  # src-tauri 内（含签名互操作测试）

npm run new-plugin          # 新插件脚手架 → plugins/<id>/
```

插件开发规范（manifest / 权限 / SDK API / 打包签名 / 商店发布）：**[specs/](./specs/README.md)**。

## 商店

发布管线 `.github/workflows/store.yml`：tag `v*` 或手动触发 → 构建全部插件 →
私钥签名（Secret `ED25519_SIGNING_SK`）→ 发布 GitHub Pages + 推送 Gitee 镜像。
一次性配置见 [specs/06-store-publish.md](./specs/06-store-publish.md)。

## 安全模型

三层：独立窗口隔离（每插件独立 webview）→ Rust 权限代理（manifest 声明权限 +
用户动作授权，插件拿不到任意文件访问）→ 包签名（商店包强制 Ed25519 验签 + sha256）。
v1 插件无网络权限。

## License

见 [LICENSE](./LICENSE)。
