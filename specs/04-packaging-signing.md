# 打包与签名规范 · .tbox / sha256 / Ed25519

> `.tbox` 是插件的分发格式：一个标准 zip 包。本文说明包结构、完整性校验与签名机制。

## 一、包结构

`.tbox` = zip，条目位于包根（不要包一层目录）：

```
manifest.json      必需（specs/01-manifest.md）
icon.png           必需（manifest.icon 指定，256×256 PNG）
index.html         必需（manifest.entry 指定）
assets/…           构建产物（js/css/字体/worker 等，随意组织）
```

标准打包流程：`vite build`（SDK 预设，相对路径）→ 把 `manifest.json`、`icon.png`
复制进 `dist/` → zip 整个 dist。这一切由 `npm run build:plugins`（scripts/build-plugin.mjs）
自动完成，产物写入 `src-tauri/builtin/<id>.tbox` 并生成 `manifests.json` 构建清单
（含每个包的 sha256）。

## 二、完整性（所有来源）

安装时宿主对**整个 .tbox 字节**计算 sha256：

- 商店安装：与索引下发的 `sha256` 比对，不一致即拒绝（「包可能被篡改或下载不完整」）
- 本地导入/内置安装：计算后记入 `installed.json`，便于审计与后续升级比对

## 三、签名（商店来源强制）

### 机制

- **签名对象**：包的 sha256 的 hex 字符串（UTF-8 字节）——`msg = utf8(sha256_hex(.tbox))`
- **算法**：Ed25519（RFC 8032）
- **私钥**：只存在于 GitHub 仓库 Secret `ED25519_SIGNING_SK`（64 字符 hex）；
  本地开发时放 `.secrets/store-signing-key.hex`（已 gitignore，绝不入库）
- **公钥**：32 字节 hex，编译进宿主 `src-tauri/src/plugin_installer.rs::STORE_PUBKEY_HEX`
- **验证时机**：安装 `source: "store"` 的包时强制验签（`verify_strict`）；失败即拒绝
- 本地导入的包没有索引，**允许未签名**，UI 明示「未签名本地包」

### 工具链

| 操作 | 命令 |
|---|---|
| 生成密钥对（仅一次） | `node scripts/gen-signing-key.mjs` |
| 构建插件包 | `npm run build:plugins` |
| 生成签名商店索引 | `TOOLBOX_SIGNING_SK=<hex> node scripts/build-store.mjs`（CI 自动） |
| 本地签名商店索引 | `TOOLBOX_SIGNING_SK=$(cat .secrets/store-signing-key.hex) node scripts/build-store.mjs` |

Node 侧用 `@noble/ed25519` 签名，Rust 侧用 `ed25519-dalek` 验签；
互操作由单测 `verify_signature_interop_with_node_noble` 固化（固定测试向量）。

### 密钥轮换

1. 重新生成密钥对（旧私钥立即废弃）
2. 更新宿主 `STORE_PUBKEY_HEX` 并发版
3. 旧宿主无法验证新签名——**索引可同时携带新旧两把钥匙的双签名**（future：
   `signature`/`signature2` 字段），过渡期内双签并发布
4. 全部用户升级后移除旧公钥

## 四、宿主安装规则速查

| 来源 | sha256 校验 | 签名校验 | 可卸载 |
|---|---|---|---|
| `builtin`（内置） | 记录 | — | 是（卸载后启动不自动装回，商店重装即恢复） |
| `store`（商店） | 强制 | 强制（Ed25519） | 是 |
| `local`（本地导入） | 记录 | 可选（有则不验） | 是 |
| `dev`（开发目录） | — | — | 否（移除注册） |
