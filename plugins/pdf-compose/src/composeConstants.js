// PDF 拼接插件专用常量（自宿主 constants/pdf.js 拆分）
// 拼版工具导出文件名后缀
export const COMPOSE_SUFFIX = '-merged.pdf'
// 拼版默认输出页尺寸（pt）
export const DEFAULT_PAGE_WIDTH = 595.28 // A4 宽
export const DEFAULT_PAGE_HEIGHT = 841.89 // A4 高
// 拼版元素/标注最小归一化尺寸，小于则视为误触忽略
export const MIN_COMPOSE = 0.02
// 标注默认配置
export const COVER_FILL = '#ffffff' // 遮盖白底
export const COVER_TEXT_FILL = '#000000' // 遮盖上的黑字
// 马赛克块大小（像素）
export const MOSAIC_BLOCK = 12
// 拼版文件输入 accept（图片 + PDF）
export const COMPOSE_ACCEPT = '.png,.jpg,.jpeg,.pdf,image/*,application/pdf'
// 图片元素最大缩略尺寸（px，避免超大 dataURL 拖垮内存）
export const ELEMENT_MAX_PIXEL = 1600
