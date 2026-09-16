import { defineStore } from 'pinia'
import { loadDoc, getPageInfos } from '../composables/usePdfRenderer'

/**
 * 全局状态：当前已打开的 PDF 与其每页独立的裁剪框。
 * cropBoxes 键为 1-based 页索引。
 */
export const usePdfStore = defineStore('pdf', {
  state: () => ({
    fileName: '',
    rawBuffer: null,
    pageInfos: [],
    cropBoxes: {}, // { [pageIndex]: {x,y,w,h} | null }
    selectedPage: 1,
    loading: false,
    errorMsg: '',
  }),

  getters: {
    pageCount: (state) => state.pageInfos.length,
    hasCrops: (state) => Object.values(state.cropBoxes).some((c) => c),
    /** 供导出/打印使用的 { 1-based页索引: crop } */
    exportCropMap: (state) => {
      const map = {}
      state.pageInfos.forEach((info) => {
        const crop = state.cropBoxes[info.index]
        if (crop) map[info.index] = crop
      })
      return map
    },
  },

  actions: {
    async openFile(file) {
      this.reset()
      if (file.name.toLowerCase().slice(-4) !== '.pdf') {
        this.errorMsg = '请选择 PDF 文件。'
        return
      }
      this.loading = true
      this.errorMsg = ''
      try {
        const rawBuffer = await file.arrayBuffer()
        const doc = await loadDoc(rawBuffer)
        const infos = await getPageInfos(doc)
        this.fileName = file.name
        this.rawBuffer = rawBuffer
        this.pageInfos = infos
        this.cropBoxes = {}
      } catch (e) {
        console.error(e)
        this.errorMsg = '无法解析该 PDF 文件（可能已损坏或被加密）。'
      } finally {
        this.loading = false
      }
    },

    setCropBox(pageIndex, crop) {
      this.cropBoxes = { ...this.cropBoxes, [pageIndex]: crop }
    },

    clearCropBox(pageIndex) {
      this.setCropBox(pageIndex, null)
    },

    setSelectedPage(pageIndex) {
      this.selectedPage = pageIndex
    },

    /** 把指定页的裁剪框应用到所有页 */
    applyToAll(pageIndex) {
      const crop = this.cropBoxes[pageIndex]
      const next = {}
      this.pageInfos.forEach((info) => {
        next[info.index] = crop ? { ...crop } : null
      })
      this.cropBoxes = next
    },

    /** 清空所有裁剪框 */
    resetCrops() {
      this.cropBoxes = {}
    },

    reset() {
      this.fileName = ''
      this.rawBuffer = null
      this.pageInfos = []
      this.cropBoxes = {}
      this.selectedPage = 1
      this.errorMsg = ''
    },
  },
})