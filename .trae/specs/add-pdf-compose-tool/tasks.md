# Tasks

- [x] Task 1: 常量与数学辅助（`src/constants/pdf.js` 追加 + `src/utils/composeMath.js`）
  - [x] 1.1 追加拼版常量：默认页尺寸、最小元素尺寸、标注默认配置、导出后缀等
  - [x] 1.2 `composeMath.js`：归一化坐标工具（元素移动夹取、`resizeElement` 复用 cropMath 思想、标注 normalize、跨页命中判定）

- [x] Task 2: 拼版状态存储（`src/stores/compose.js`）
  - [x] 2.1 定义状态建模：`assets`（图片/PDF 原始资源）、`elements`（{id, pageId, x, y, w, h, src: dataUrl 或 {doc,pageIdx} 引用}）、`pages`（{id, width, height, label}）、`annotations`（{id, pageId, type: cover|mosaic|text, x,y,w,h, text}）
  - [x] 2.2 actions：导入图片/PDF（PDF 用 pdfjs 逐页渲染为 dataURL，去重资源）、新增/删除/排序页、增删元素、移动/缩放元素、跨页移动元素、增删标注
  - [x] 2.3 getters：总页数、元素数、某页元素/标注、某页是否含马赛克、整体是否为空工程

- [x] Task 3: 资源导入与解析（图片 + 多页 PDF）
  - [x] 3.1 图片读取为 dataURL 并生成缩略源
  - [x] 3.2 PDF 用 `pdfjs-dist` 逐页渲染缩略图为 dataURL（复用 `usePdfRenderer` 的 worker 配置思想）
  - [x] 3.3 导入后按「默认逐页放置」初始化输出页与元素

- [x] Task 4: 拼版导出与打印（`src/composables/useComposeExport.js`）
  - [x] 4.1 `buildComposedPdfBytes()`：用 `pdf-lib` 按输出页顺序建页、绘制背景、嵌入图片元素（embedJpg/embedPng）、绘制标注（遮盖白矩形 + 黑字；文字用标准字体）
  - [x] 4.2 含马赛克页：整页先渲染为位图，对马赛克区域做块状像素化，再整体嵌入该页输出
  - [x] 4.3 `downloadComposedPdf()`：Tauri 走 `save_bytes`（系统保存对话框），浏览器走`download`
  - [x] 4.4 `printComposedPdf()`：Tauri 走现有 `print_pdf`；浏览器先注入打印层再 `window.print`（参考 `usePdfExport` 模式）

- [x] Task 5: 拼版主视图（`src/views/PdfCompose.vue`）
  - [x] 5.1 头部：上传图片/PDF、返回、打开其它、关闭
  - [x] 5.2 拼版画布：纵向输出页列表，每页渲染元素与标注，支持元素拖拽移动/缩放/跨页、标注绘制
  - [x] 5.3 底部工具栏：新增/删除/排序输出页、页尺寸设置、打印/导出
  - [x] 5.4 空态上传区与加载态，配合 toast 提示

- [x] Task 6: 拼版组件（`src/components/`）
  - [x] 6.1 `ComposeUploader.vue`：多选文件上传（图片 + PDF），拖拽/点击（复用 `PdfUploader` 交互模式）
  - [x] 6.2 `ComposePage.vue`：单输出页画布，元素绝对定位、可拖动/缩放控点、跨页放置区、标注层绘制（遮盖/马赛克/文字）
  - [x] 6.3 标注工具切换控件（遮盖/马赛克/文字/选择/删除）

- [x] Task 7: 工具注册与全局接入
  - [x] 7.1 `src/tools/registry.js` 追加 `{ id: 'pdf-compose', name: 'PDF 拼接', ... }`，懒加载 `PdfCompose.vue`

- [x] Task 8: 构建验证
  - [x] 8.1 `npm run build` 通过，`npm run tauri` 可启动，无控制台报错

# Task Dependencies
- [Task 1] 无（基础）
- [Task 2] 依赖 [Task 1]（常量与数学工具）
- [Task 3] 依赖 [Task 2]（store 的 import action）
- [Task 4] 依赖 [Task 1][Task 2]（导出需 store 数据与工具）
- [Task 5] 依赖 [Task 2][Task 3][Task 6][Task 4]（视图整合）
- [Task 6] 依赖 [Task 1][Task 2]（组件使用工具与 store）
- [Task 7] 依赖 [Task 5]（视图存在才能注册）
- [Task 8] 依赖全部上述任务