# 商店发布规范 · 索引契约与双源托管

> 商店 = 静态文件目录。没有动态后端：一个 `index.json` + 插件包 + 图标，
> 托管在 GitHub Pages（主源）与 Gitee Pages（镜像源）。

## 一、目录结构（store/）

```
store/
  index.json                     商店索引
  packages/<id>-<version>.tbox   插件包（不可变：同版本内容永不变更）
  icons/<id>.png                 插件图标
```

由 `scripts/build-store.mjs` 生成（输入是 `npm run build:plugins` 的产物）。

> **托管布局**：Pages/镜像站点的根目录下保留一层 `store/` 子目录
> （即索引 URL 形如 `https://<host>/<path>/store/index.json`），
> 与宿主内置源 URL（`src/stores/app.js::BUILTIN_STORE_SOURCES`）保持一致。

## 二、index.json 契约（storeVersion 1）

```json
{
  "storeVersion": 1,
  "updatedAt": "2026-09-26T08:00:00.000Z",
  "plugins": [
    {
      "id": "pdf-crop",
      "name": "PDF 裁剪",
      "version": "0.3.0",
      "description": "框选裁剪 PDF 页面",
      "author": "Font_C",
      "apiVersion": 1,
      "minHostVersion": null,
      "permissions": ["dialog:save", "fs:write", "fs:read", "print"],
      "sha256": "d947fdb0fcfa…64 hex",
      "size": 783360,
      "package": "packages/pdf-crop-0.3.0.tbox",
      "icon": "icons/pdf-crop.png",
      "signature": "8fd8e310…128 hex"
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `storeVersion` | 索引契约版本，当前恒为 `1`；宿主拒绝未知版本 |
| `plugins[].package` / `icon` | 相对 index.json 所在目录的相对路径 |
| `sha256` | `.tbox` 字节的 sha256（hex）。宿主安装时强制比对 |
| `signature` | 对 `sha256` hex 字符串（UTF-8 字节）的 Ed25519 签名（hex）。商店安装强制 |
| `permissions` | 原样展示给用户，安装确认的依据 |

未设置签名私钥时 CI 会产出无 `signature` 的索引——宿主会拒绝其中的 store 安装，
因此**生产索引必须带签名**。

## 三、发布管线（CI：.github/workflows/store.yml）

触发：push tag `v*` 或手动 workflow_dispatch。

```
npm ci → npm run build:plugins
  → node scripts/build-store.mjs   （secret ED25519_SIGNING_SK 签名）
  → artifact: plugin-store
  ├→ deploy-pages: 发布到 GitHub Pages（主源）
  └→ mirror-gitee: 推送到 Gitee 仓库并触发 Pages 重建（镜像源，可选）
```

### 一次性配置

1. **GitHub Pages**：仓库 Settings → Pages → Build and deployment → Source 选
   **GitHub Actions**。发布地址即主源 URL（默认 `https://<owner>.github.io/<repo>/`）。
2. **签名私钥**：`node scripts/gen-signing-key.mjs` 生成 → 私钥 hex 存入仓库 Secret
   `ED25519_SIGNING_SK` → 公钥 hex 更新到 `plugin_installer.rs::STORE_PUBKEY_HEX`（与宿主一起发版）。
3. **Gitee 镜像（可选）**：创建公开仓库（如 `my-toolbox-store`），开启 Gitee Pages（手动初建），
   配置 Secrets：`GITEE_TOKEN`（有 pages 推送权限的令牌）与 `GITEE_REPO`（`owner/repo`）。
   Gitee Pages 的自动重建依赖该账号的 Pages API 可用性，不可用时需手动点「更新」。

### 应用内的源配置

主源与镜像 URL 内置于壳子（`src/stores/app.js::BUILTIN_STORE_SOURCES`），
用户可在商店页切换、在设置页追加自定义源（任何托管 index.json 的 HTTPS 目录）。

## 四、版本语义

- **包不可变**：`packages/<id>-<version>.tbox` 一旦发布不得覆盖（缓存友好 + 可追溯）；
  更新 = 新版本号 + 新文件
- 宿主更新检查：启动时拉当前源 index.json，对已安装插件做版本比较，`version` 大于本地即提示
- 内置插件同步上架（同一构建产物），商店可提供比用户宿主内置版本更新的插件

## 五、信任模型小结

- 索引可信 = HTTPS + GitHub Pages（写权限仅 CI）+ 签名私钥仅在 Secret
- 包可信 = sha256 与索引一致 + 索引签名与宿主内置公钥匹配
- 极端情形（GitHub 不可用）→ 应用内一键切换 Gitee 镜像或自定义源（自定义源仍须通过签名验证）
