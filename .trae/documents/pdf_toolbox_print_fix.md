# 修复：Tauri 内打印总是显示第一次框选区域

## 摘要

在“工具箱”桌面应用（Tauri v2 + Vue3）的 PDF 裁剪工具中，**导出内容正确**，但**打印**无论之后如何重新框选，始终打印第一次框选的区域。

用户建议的方案：点击打印时，参考导出流程先生成裁剪后的 PDF 到内存，再把这份内存 PDF 交给系统打印。

## 现状分析（已探查确认）

数据链路全部是“最新值”，字节来源与导出完全一致：

- `CropTool.vue` 的 `handlePrint` / `handleExport` 都实时读取 `store.exportCropMap`（Pinia getter，每次求值取最新 `cropBoxes`）。
- `PageCard.vue` 的 `onUp` / 控点 `onResize` 重新框选后调用 `store.setCropBox(pageIndex, crop)`，**替换式更新**存储（确认无残留旧框）。
- `printCroppedPdf`（Tauri 路径）用与导出相同的 `buildCroppedPdfBytes(rawBuffer, cropBoxes, pageInfos)` 生成**全新** PDF 字节，再 `invoke('print_pdf', { bytes })`。
- 导出（`save_bytes` 写文件）内容正确 ⇒ 说明 `buildCroppedPdfBytes` 生成的字节、以及 `cropBoxes`/`pageInfos` 均为最新。

**结论：数据层无问题，字节是全新的。**

因此“永远打印第一次区域”是 **macOS 原生打印复用旧打印任务/文档**所致。当前 Rust `print_pdf` 用 `NSPrintInfo::sharedPrintInfo()`（全局共享打印设置）＋ `PDFDocument::initWithData`，未对每次打印做隔离，打印面板/PDFKit 复用了上一次任务。

## 用户方案可行性结论

**可行。** “内存生成裁剪 PDF → 打印该 PDF”正是当前数据链路已具备的能力（导出即同一套字节）。修复不改变架构，只需让原生打印侧**每次打印完全隔离、全新构建**。

## 拟修改内容

### 1. `src-tauri/src/lib.rs` — 重写 `print_pdf`（macOS）

核心：把每次打印做成一个完全独立的、无共享状态的打印任务。

- **写入唯一临时 PDF 文件**
  先用 `std::env::temp_dir()` 生成唯一文件名（含毫秒时间戳，如 `toolbox_print_{millis}.pdf`），把 `bytes` 写入该文件。打印前先清理上一次遗留的临时文件。
- **全新 `NSPrintInfo`**：改用 `NSPrintInfo::new()`（每次新实例），**不再**用 `NSPrintInfo::sharedPrintInfo()`，避免上一次任务的纸张/预览/设置残留。
- **从文件加载文档**：用 `PDFDocument::initWithURL(&nsurl, ...)`（新建、文件为最新内容），保证文档全新。
- **全新 `PDFView`**：`initWithFrame` 非零 frame（612×792），`setAutoScales(true)`，`setDisplayMode(SinglePageContinuous)`。
- **唯一 Job 标题**：`operation.setJobTitle(Some(含时间戳))`，进一步避免打印队列/预览缓存，并便于人工核对是否为最新任务。
- `operation.runOperation()` 同步阻塞直到用户完成/取消。
- **打印结束清理**临时 PDF 文件（无论成功失败都在返回前删除）。

> 说明：`NSPrintOperation::runOperation()` 是同步阻塞的，天然规避了之前“弹框立刻被关闭”与“整页快照”两类时序问题。

### 2. 前端 `src/composables/usePdfExport.js`（基本不改，仅微调可选）

- 数据链路已正确，保持 `printCroppedPdf` 的 Tauri 分支不变（内存生成字节 → `print_pdf`）。
- 可选：去掉 `.catch((e) => { console.error(...) })` 的静默吞错，让 `handlePrint` 的 try/catch 能弹出“打印失败”提示，便于人工判断异常。

### 3. `src-tauri/Cargo.toml`（无新增依赖）

仅引用的现有依赖：`objc2-app-kit`、`objc2-pdf-kit`、`objc2-foundation`、`objc2-core-foundation` 已就位，无需新增。

## 前提与决策

- **假设**：旧打印源于 macOS 原生打印/PDFKit 复用，而非数据 bug（已由“导出正确”佐证）。
- **决策**：不再使用任何“临时打印窗口 / 主窗口覆盖层 / `window.print`”方案；统一走“内存生成裁剪 PDF → AppKit `runOperation()` 同步打印”。
- **范围**：仅改动原生打印路径，不动导出与浏览器打印逻辑。

## 验证步骤

1. `npm run tauri build` 重新打包 `工具箱.app`。
2. 打开应用 → 载入 PDF → 框选第 1 区域 A → 点打印 → 确认打印/预览为 A。
3. 在同一页重新框选到不同区域 B → 点打印 → **确认显示 B 而非 A**（本 bug 的验收点）。
4. 框选多页 → 打印 → 确认逐页均为最新选区。
5. 复核导出仍正确（确保未破坏导出链路）。
6. 打印对话框的 Job 标题应随每次打印变化（含时间戳），辅助确认每次是全新任务。