/**
 * 工具注册表：工具箱首页启动台网格的数据来源。
 * 后续新增工具只需往 tools 数组中追加一项即可，无需改动其它代码。
 *
 * @typedef {Object} ToolDefinition
 * @property {string} id      唯一标识
 * @property {string} name    显示名称
 * @property {string} desc    一句话描述
 * @property {string} icon    图标（当前使用 emoji，可由 SVG/组件替换）
 * @property {() => import('vue').Component} component 懒加载组件工厂
 */

import { defineAsyncComponent } from 'vue'

/** 懒加载异步组件，供 <component :is> 使用 */
const lazyCropTool = defineAsyncComponent(() => import('../views/CropTool.vue'))
const lazyMentalMath = defineAsyncComponent(() => import('../views/MentalMath.vue'))
const lazyComposeTool = defineAsyncComponent(() => import('../views/PdfCompose.vue'))

export const tools = [
  {
    id: 'pdf-crop',
    name: 'PDF 裁剪',
    desc: '框选裁剪 PDF 页面',
    icon: '✂️',
    component: lazyCropTool,
  },
  {
    id: 'mental-math',
    name: '口算练习',
    desc: '加减乘除口算，支持混合运算',
    icon: '🧮',
    component: lazyMentalMath,
  },
  {
    id: 'pdf-compose',
    name: 'PDF 拼接',
    desc: '多图片/多PDF自由拼版，支持标注与打印',
    icon: '🧩',
    component: lazyComposeTool,
  },
]

/** 按 id 查找工具定义，未找到返回 undefined */
export function getTool(id) {
  return tools.find((tool) => tool.id === id)
}