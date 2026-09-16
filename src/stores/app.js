import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getTool } from '../tools/registry'

/**
 * 应用级状态：当前视图中打开的工具。
 * activeToolId 为 null 时显示启动台首页，否则显示对应工具组件。
 * 不重置工具自身状态（如 PDF 裁剪的已选框），返回后再次进入仍保留。
 */
export const useAppStore = defineStore('app', () => {
  const activeToolId = ref(null)

  const activeTool = computed(() => getTool(activeToolId.value))

  function openTool(id) {
    activeToolId.value = id
  }

  function goHome() {
    activeToolId.value = null
  }

  return { activeToolId, activeTool, openTool, goHome }
})