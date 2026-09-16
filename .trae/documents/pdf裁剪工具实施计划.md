# 本地 PDF 裁剪桌面应用 - 实施计划 (Tauri v2 + Vue3)

## 1. 需求概述

参考 [ilovepdf crop-pdf](https://www.ilovepdf.com/zh-cn/crop-pdf)，实现一个**本地桌面应用**（非网站部署）Pdf 裁剪工具：

- **上传 PDF**：应用内选择本地文件（也可拖拽到窗口）。
- **选框裁剪**：在每页缩略图上用鼠标拖拽绘制裁剪框，框选保留区域。
- **裁剪预览**：框选后「预览」该页裁剪后效果；**页面始终显示原始整页，不随框选改变**，可反复调整。
- **多页独立**：每页可框选**不同位置/大小**，互不影响；提供「应用到所有页」。
- **导出**：以每页各自裁剪框生成裁剪后新 PDF 并下载保存到本地。
- **打印**：框选完成后可**直接打印**（浏览器/系统打印对话框输出），无需先下载。
- **纯本地**：所有处理在前端 webview 内完成，数据不离开本机。

## 2. 技术方案

| 用途 | 技术 | 说明 |
|------|------|------|
| 应用壳 | **Tauri v2** (Rust) | 生成原生 macOS 应用（.app/.dmg），非网站形式 |
| 界面 | **Vue3 (JS) + Vite + Pinia** | 沿用用户前端规范（Composition API + `<script setup>`） |
| 页面渲染 / 预览 | **pdfjs-dist** (pdf.js) | 把每页渲染成 canvas 供框选与预览 |
| 实际裁剪 | **pdf-lib** | 修改每页 `MediaBox`/`CropBox`，**保留矢量文字图形** |
| 打印 | webview `print()` + Blob iframe | 系统打印对话框直接输出裁剪结果，不下载 |

**坐标换算**（CropBox 目标坐标，PDF 原点左下、单位 pt）：
```
scale       = canvasWidth / pageWidthPts
cropLeftPts    = screenLeft / scale
cropBottomPts  = (canvasHeight - (screenTop + screenHeight)) / scale
cropWidthPts   = screenWidth / scale
cropHeightPts  = screenHeight / scale
```

## 3. 项目结构

```text
<workspace>/
├─ package.json                 # 前端依赖 + tauri scripts
├─ vite.config.js
├─ index.html
├─ src/                         # Vue3 前端（运行于 webview）
│  ├─ main.js                   # 挂载 Vue + Pinia
│  ├─ App.vue
│  ├─ views/
│  │  └─ CropTool.vue           # 主界面：上传/工具栏/页面网格
│  ├─ components/
│  │  ├─ PdfUploader.vue        # 本地文件选择 + 拖拽
│  │  ├─ Toolbar.vue            # 应用到所有页/重置/打印/导出
│  │  ├─ PageCard.vue           # 单页缩略图 + 选框(SVG 遮罩) + 预览入口
│  │  └─ CropPreviewModal.vue   # 预览弹窗（pdf.js 渲染裁剪区域）
│  ├─ stores/
│  │  └─ pdf.js                 # fileInfo、pages[]、每页独立 cropBox、loadedPdf
│  ├─ composables/
│  │  ├─ usePdfRenderer.js      # pdf.js worker、renderPageToCanvas、renderCropPreview
│  │  └─ usePdfExport.js        # buildCroppedPdfBytes/download/print
│  ├─ utils/
│  │  └─ cropMath.js            # screen→PDF 坐标、生成 MediaBox
│  └─ constants/
│     └─ pdf.js                 # DPI、颜色等常量
└─ src-tauri/                   # Tauri v2 Rust 壳
   ├─ Cargo.toml
   ├─ tauri.conf.json           # productName、identifier、window、bundle
   ├─ build.rs
   ├─ capabilities/default.json
   ├─ icons/                    # 应用图标（tauri icon 生成）
   └─ src/
      ├─ main.rs
      └─ lib.rs
```

- 单 SFC ≤ 300 行，复杂逻辑入 composable/utils；异步均 try/catch。

## 4. 分步实施

### Step 1 - 初始化 Tauri v2 + Vue3 工程
- 用 `npm create tauri-app@latest`（Vue + JS 模板）在当前目录生成骨架。
- 安装依赖：`vue`、`pinia`、`pdfjs-dist`、`pdf-lib`；devDeps：`@tauri-apps/cli`、`@tauri-apps/api`、`vite`、`@vitejs/plugin-vue`。
- `tauri.conf.json`：配置 `productName`（如 PdfCrop）、`identifier`、窗口尺寸、`bundle`（dmg）。
- 生成图标：`npm run tauri icon`（提供/生成一个默认 PNG 图标源）。
- 配置 pdf.js worker：`import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` 并 `GlobalWorkerOptions.workerSrc = workerSrc`。

### Step 2 - 上传模块（PdfUploader）
- 应用内点选 `.pdf`（校验扩展名）＋ 拖拽到窗口。
- 读取为 `ArrayBuffer`，pdf.js 打开获取 `numPages`，初始化每页 cropBox 为「无(整页)」。
- 逐页渲染 canvas 缩略图供 `PageCard` 展示。
- 解析失败/加密：友好错误提示；加密 PDF 弹窗一次获取密码（基础支持）。

### Step 3 - 选框交互（PageCard）
- 每页 canvas 缩略图 + SVG 遮罩叠加，**底层始终渲染原始整页**。
- 鼠标按下/移动/抬起绘制虚线框，显示尺寸提示；框外半透明遮罩突出保留区。
- **每页独立存储** cropBox；支持替换、清空（整页）、反复调整。
- 「预览」→ `CropPreviewModal` 用 pdf.js 渲染该页裁剪区域；关闭后仍回原整页。

### Step 4 - 工具栏（Toolbar）
- **应用到所有页**：将当前选中页 cropBox 复制到全部页。
- **重置裁剪**：清空所有 cropBox。
- **打印** / **导出 PDF**：调用 `usePdfExport`。

### Step 5 - 导出 / 打印（usePdfExport）
- 公共 `buildCroppedPdfBytes()`：
  1. `pdf-lib` 加载原始 ArrayBuffer（捕获加密错误以取密码）。
  2. 遍历每页读取各自 cropBox，有裁剪则 `setMediaBox`+`setCropBox`；未框选保持整页。
  3. `doc.save()` 返回 Uint8Array。
- **导出 `downloadCropped()`**：bytes→Blob→对象URL 下载 `xxx-cropped.pdf`，完成后 revoke。
- **打印 `printCropped()`**：bytes→Blob→对象URL→隐藏 iframe 加载，onLoad 后 `iframe.contentWindow.focus()`+`print()`，结束后移除 iframe 并 `revokeObjectURL`；**不产生文件下载**，由系统打印对话框输出。
- 两者只依据每页 cropBox 数据，与预览时页面显示无关。

### Step 6 - 样式与体验
- 工具型简洁界面：顶部标题+打开文件、中部页面网格（自适应列）、底部工具栏（应用到所有页/重置/打印/导出）。
- BEM 类名；避免 `!important` 与深层选择器；空态/加载/错误提示。

### Step 7 - 本地打包
- `npm run tauri build` 产出 macOS `.app`/`.dmg`；`npm run tauri dev` 开发调试。

## 5. 假设与决策
- **技术栈**：Tauri v2（Rust 壳）+ Vue3（webview 前端），本地原生应用，非网站部署。
- **保留矢量**：pdf-lib 修改 CropBox，不栅格化。
- **纯本地**：全部处理在本机 webview 完成，不上传。
- **页面不随框选变化**：框选/预览仅叠加视觉层，底层显示原整页。
- **导出与打印共用同一裁剪逻辑**，打印通过 Blob iframe + `print()` 直接输出。
- **多页独立裁剪**：每页独立框选位置；含「应用到所有页」。
- 加密 PDF：一次密码输入兜底（复杂度过高则降级为友好提示）。

## 6. 验证步骤
1. `npm run build` 前端构建通过；`cargo` 相关由 `tauri build` 校验。
2. `npm run tauri dev` 启动本地应用窗口，用浏览器子代理 / manual 实测：
   - 打开多页 PDF → 页面正常渲染。
   - 单页框选 → 页面仍显原整页，可再次框选。
   - 「预览」→ 显示该页裁剪后效果；关闭后回原整页。
   - 不同页框选不同位置 → 「应用到所有页」生效。
   - 「导出」→ 保存的 PDF 每页仅保留各自框选区域、文字仍矢量可选。
   - 「打印」→ 系统打印对话框预览为裁剪结果，且无文件下载发生。
   - 边界/空态（裁剪框越界、取消绘制、重置）处理正常。
3. `npm run tauri build` 成功产出 macOS 安装包。