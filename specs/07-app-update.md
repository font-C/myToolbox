# 主程序自动更新 · 更新目录与发布管线

> 主程序 = Tauri 外壳（MyToolbox）。更新机制与插件商店同构：
> **静态托管的更新目录 JSON**（GitHub Pages 主源 + Gitee 镜像）+ **签名校验**，
> 检查/下载/安装由官方 `tauri-plugin-updater` 完成。

## 一、总体流程

```
发版（release.yml, tag v*）
  → 打包并签名更新产物（dmg/exe + .app.tar.gz + .sig）
  → 生成 app-update.json 并作为 Release 资产上传
  → 触发 store.yml
store.yml
  → 从最新稳定版 Release 取 app-update.json 放入 store/
  → 发布到 GitHub Pages（主源）与 Gitee（镜像，URL 改指 Gitee 附件）
应用内
  → 启动静默检查 + 设置页手动检查/下载/安装/重启
```

## 二、更新目录契约（app-update.json）

Tauri updater 端点格式，位于商店同目录：`store/app-update.json`。

```json
{
  "version": "0.5.0",
  "notes": "更新内容（Release 说明原文）",
  "pub_date": "2026-09-29T00:00:00.000Z",
  "platforms": {
    "darwin-aarch64": { "signature": "<.sig 文件字节的 base64>", "url": "https://github.com/…/MyToolbox_0.5.0_aarch64.app.tar.gz" },
    "windows-x86_64": { "signature": "…", "url": "…/MyToolbox_0.5.0_x64-setup.exe" }
  }
}
```

| 字段 | 说明 |
|---|---|
| `version` | 目标版本（semver），updater 与当前版本比较后决定是否提示 |
| `platforms` | 键为 `OS-ARCH`（`darwin-aarch64` / `darwin-x86_64` / `windows-x86_64`）；应用只读取自己平台的条目 |
| `signature` | 对应 `.sig` 文件**原始字节的 base64**（updater 解码后做 minisign 验签；trusted comment 含 `version:` 时还会与目录版本比对，当前 CLI 产物未内嵌则跳过该步，字节级验签始终强制） |
| `url` | 更新载体下载地址；主源指 GitHub Release 资产，Gitee 镜像由 store.yml 重写为 `https://gitee.com/<owner>/my-toolbox/releases/download/…` |

更新载体：macOS 用 `.app.tar.gz`（dmg 无法静默安装）；Windows 直接用 NSIS 安装包
（静默安装后自动退出应用）。**只认带 `_<arch>` 后缀的产物名**（release.yml 收集时重命名补上）。

## 三、端点与故障转移

`tauri.conf.json::plugins.updater.endpoints`（按顺序尝试，失败自动下一个）：

1. `https://font-c.github.io/myToolbox/store/app-update.json`（主源，与商店主源同目录）
2. `https://gitee.com/font-c/my-toolbox-store/raw/master/store/app-update.json`（镜像）

公钥固定在 `plugins.updater.pubkey`；私钥丢失将无法向已发版用户推送更新。

## 四、签名

- 算法：minisign（Ed25519），与插件商店的 Ed25519 裸签名是**两套独立密钥**
- 生成：`npm run tauri signer generate -- -w .secrets/updater-signing.key`（空密码）
- 本地构建（`createUpdaterArtifacts: true` 下打正式包必须签名）：

  ```bash
  TAURI_SIGNING_PRIVATE_KEY="$(cat .secrets/updater-signing.key)" \
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  npm run tauri build
  ```

  注意：`TAURI_SIGNING_PRIVATE_KEY` 传密钥**内容**（单行 base64），构建签名不认
  `TAURI_SIGNING_PRIVATE_KEY_PATH`（那是 `tauri signer` 子命令的变量）；
  空密码密钥也须显式 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`，
  否则 CLI 交互式提示密码（无 tty 环境直接失败）。

## 五、发布管线

release.yml（发版）：
1. 打包前清空 `target/release/bundle`、收集前清空 `dist/`——**Release 资产与 Gitee 附件
   只含当次构建产物**（actions/cache 恢复的 target 会残留历史版本安装包，不清会把
   旧版本包一并带进发布资产）；Windows 构建步骤须显式 `shell: bash`
2. 构建前从 secret `TAURI_SIGNING_PRIVATE_KEY` 注入密钥内容（单行 base64）并显式置空密码变量
3. 收集产物：安装包 + `*.app.tar.gz(.sig)`（macOS 重命名补 `_<version>_<arch>`）+ `*.exe.sig`
4. 版本化 Release 用 `gh release` 查/建/上传（上传前显式清空旧资产；不手搓 curl 直传
   上传端点——302 后请求本体丢失会立即 4xx），资产含 `scripts/gen-update-catalog.mjs`
   生成的 `app-update.json`（notes 取 Release 说明；latest 滚动构建不生成目录）
5. `gitee-release` 删除重建 Gitee Release，同步安装包与 `.app.tar.gz`（`.sig` 不需要）
6. `trigger-store-sync` 触发 store.yml

store.yml（商店发布）：
1. 取「最新一个带 `app-update.json` 资产的稳定版 Release」的目录放入 `store/`（没有则跳过）
2. 镜像到 Gitee 时把目录内 URL 重写为 Gitee Release 附件地址

## 六、应用内行为（src/composables/useAppUpdater.js）

- 启动后静默检查（与插件更新红点同款，失败不打扰）
- 设置页「应用更新」卡片：手动检查 / 展示版本与说明 / 下载进度 / 安装后重启（`app_restart` 命令）
- Windows 安装阶段安装器会自行退出应用；macOS 完成后点「重启应用」

## 七、一次性配置

1. **GitHub Secret** `TAURI_SIGNING_PRIVATE_KEY` = `.secrets/updater-signing.key` 文件内容
   （空密码，无需 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）。未配置时 release.yml / build-tauri.yml
   在「Resolve updater signing key」一步明确报错。
2. 更新目录随 store.yml 的 Pages/Gitee 镜像自动发布，无额外配置。
3. 轮换密钥：重新生成 → 更新 `tauri.conf.json::pubkey` 随宿主发版 → 之后发布的新目录用新钥签名
   （旧版应用只认旧钥，需先升级到换钥前的最后一个版本）。
