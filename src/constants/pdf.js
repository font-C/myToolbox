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