# 开发指南 · 从零到上架

> 面向插件开发者。仓库内的三个内置插件（plugins/）是活的参考实现。

## 一、创建插件

```bash
npm run new-plugin                       # 交互式：输入 id 与显示名
# 或
npm run new-plugin -- --id=my-tool --name=我的工具
```

生成 `plugins/<id>/` 骨架（manifest + Vue 入口 + 构建配置），然后：

```bash
node scripts/gen-plugin-icons.mjs <id>   # 生成占位图标
npm install                              # 链接 workspace 依赖
```

## 二、开发与调试

### 方式 A：开发目录直载（推荐，热更新友好）

1. 以 debug 模式运行宿主：`npm run tauri dev`
2. 插件管理 → 「加载开发插件目录」→ 选择 `plugins/<id>`（debug 构建才显示此按钮）
3. 插件以 `dev` 来源出现在启动台/管理页，点击即可在独立窗口打开
4. 修改代码后重新 `vite build`（或对该插件跑 `vite dev` + 手动重开窗口），再重开插件窗口验证

### 方式 B：浏览器直开（纯 UI 开发）

插件构建产物是普通静态页面，`vite dev` 后在浏览器里即可调试 UI
（涉及宿主 API 的部分会因 `__TAURI_INTERNALS__` 缺失走浏览器兜底或报错）。

## 三、打包与安装

```bash
npm run build:plugins                    # 打包全部插件 → src-tauri/builtin/*.tbox
npm run build:plugins -- --only=<id>     # 只打包一个
```

- 产物用于两个去向：作为内置插件嵌入宿主（见下）、或经商店分发
- 本地验证：插件管理 → 「导入 .tbox 插件包」选择生成的 .tbox（未签名来源，需确认）

## 四、发布为内置插件（仓库维护者）

1. 在 `src-tauri/src/plugin_installer.rs::BUILTIN_PLUGINS` 的列表中已有/加入 `<id>`
2. 提交后，正常发版流程（tag `v*` 触发 release.yml）会用 `npm run build:all`
   重新打包插件并嵌入应用
3. 内置插件版本号提升时，宿主启动时会自动升级本地已装版本

## 五、上架商店（仓库维护者）

1. 确保插件在 `plugins/` 下、manifest 完整、版本号已提升
2. push tag `v*`（或手动触发 workflow「Build & Publish Plugin Store」）
3. CI：构建全部插件 → 用 `ED25519_SIGNING_SK` 签名 → 发布 GitHub Pages + Gitee 镜像
4. 前置配置（一次性，见 specs/06-store-publish.md）：
   - 仓库 Settings → Pages → Source 选 **GitHub Actions**
   - Secrets：`ED25519_SIGNING_SK`（必需）、`GITEE_TOKEN`/`GITEE_REPO`（镜像，可选）

## 六、 checklist（提交前自查）

- [ ] manifest：id/版本/描述/权限准确，`permissions` 只含实际用到的
- [ ] 图标 256×256，非占位渐变图（能认出是哪个工具）
- [ ] 窗口尺寸合理（manifest.window），页面在最小尺寸下不破版
- [ ] 引入了 `@toolbox/plugin-sdk/theme.css`，观感与宿主一致
- [ ] 错误有 UI 反馈（toast/表单提示），没有静默失败
- [ ] `npm run build:plugins` 通过，包内含 manifest/icon/entry
- [ ] 拖拽、对话框、导出全流程在宿主里实测过
