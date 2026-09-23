// 渲染缩略图/预览用分辨率倍数（越大越清晰，内存开销也越大）
export const RENDER_SCALE = 1.75
// 裁剪预览图的期望宽度（px）
export const PREVIEW_WIDTH = 720
// 合法的最小裁剪框尺寸（归一化 0~1），小于则视为误触并忽略
export const MIN_CROP = 0.02
// 选框外遮罩颜色
export const MASK_FILL = 'rgba(15, 23, 42, 0.45)'
// 选框描边颜色
export const CROP_STROKE = '#3b82f6'
// 接受的文件扩展名
export const ACCEPTED_EXTENSION = '.pdf'
// 导出文件名的后缀
export const EXPORT_SUFFIX = '-cropped.pdf'
// 拼版工具导出文件名后缀
export const COMPOSE_SUFFIX = '-merged.pdf'
// 拼版默认输出页尺寸（pt）
export const DEFAULT_PAGE_WIDTH = 595.28 // A4 宽
export const DEFAULT_PAGE_HEIGHT = 841.89 // A4 高
// 拼版元素/标注最小归一化尺寸，小于则视为误触忽略
export const MIN_COMPOSE = 0.02
// 元素默认占据单页的比例（约 90%，四边留白）
export const DEFAULT_ELEMENT_INSET = 0.05
// 标注默认配置
export const COVER_FILL = '#ffffff' // 遮盖白底
export const COVER_TEXT_FILL = '#000000' // 遮盖上的黑字
// 马赛克块大小（像素）
export const MOSAIC_BLOCK = 12
// 拼版文件输入 accept（图片 + PDF）
export const COMPOSE_ACCEPT = '.png,.jpg,.jpeg,.pdf,image/*,application/pdf'
// 图片元素最大缩略尺寸（px，避免超大 dataURL 拖垮内存）
export const ELEMENT_MAX_PIXEL = 1600