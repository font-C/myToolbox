import { defineStore } from 'pinia'
import { DEFAULT_PAGE_WIDTH, DEFAULT_PAGE_HEIGHT } from '../constants/pdf.js'
import { normalizeRect } from '../utils/composeMath.js'
import { readImageAsElement, readPdfAsElementDrafts, isImageFile, isPdfFile } from '../composables/useComposeSource.js'

let idSeq = 0
function nextId() {
  idSeq += 1
  return `c_${Date.now()}_${idSeq}`
}

/**
 * 拼版工具全局状态。
 * - assets：导入的原始资源（仅记录名称，用于展示）。
 * - elements：可排版元素，统一为图片（PDF 页在导入时已栅格化为 dataURL）。
 * - pages：输出页，宽度/高度为 pt。
 * - annotations：覆盖标注（cover=白底遮盖+黑字 / mosaic=马赛克）。
 * 所有矩形坐标采用归一化坐标（0~1，左上角为原点）。
 */
export const useComposeStore = defineStore('compose', {
  state: () => ({
    assets: [], // [{ id, name, kind }]
    elements: [], // [{ id, pageId, src, aspect, x, y, w, h }]
    pages: [], // [{ id, width, height }]
    annotations: [], // [{ id, pageId, type: 'cover'|'mosaic', x, y, w, h, text }]
    // 打码默认样式：选择样式后后续新建的打码沿用
    defaultMosaic: { style: 'grid', color: '#cfd4db' },
    // 图片剪切/复制缓存，粘贴到鼠标位置
    copyBuffer: null,
    // 统一的层级递增计数器：批注/打码/图片按覆盖先后叠在上层，PDF 页始终在最底层(z=0)
    z: 0,
    loading: false,
    errorMsg: '',
  }),

  getters: {
    totalPages: (s) => s.pages.length,
    elementCount: (s) => s.elements.length,
    isEmpty: (s) => s.elements.length === 0,
    pageById: (s) => (id) => s.pages.find((p) => p.id === id),
    elementsOf: (s) => (pageId) => s.elements.filter((e) => e.pageId === pageId),
    annotationsOf: (s) => (pageId) => s.annotations.filter((a) => a.pageId === pageId),
    /** 某输出页是否含马赛克标注（决定该页是否按位图导出） */
    pageHasMosaic: (s) => (pageId) => s.annotations.some((a) => a.pageId === pageId && a.type === 'mosaic'),
  },

  actions: {
    /** 重置整个拼版工程 */
    reset() {
      this.assets = []
      this.elements = []
      this.pages = []
      this.annotations = []
      this.errorMsg = ''
      this.loading = false
    },

    /**
     * 按「默认逐页放置」为新元素分配输出页：为每个元素单独建一页，
     * 元素以页面等比缩放并四边留白 placement 比例放置。
     * 归一化宽高分别相对页面宽/高，需回算页面宽高比以保持元素原始比例。
     */
    _placeElementDefault(element, placement = 0.9) {
      const page = this.addPage()
      element.pageId = page.id
      const e = this.elements.find((it) => it.id === element.id)
      const pageAspect = page.width / page.height // 页面宽高比
      // 先按高度铺满 placement，再换算保持原始比例的宽度
      let h = placement
      let w = h * e.aspect * pageAspect
      // 若宽度超出，改以宽度为基准
      if (w > placement) {
        w = placement
        h = w / (e.aspect * pageAspect)
      }
      e.w = Math.round(w * 1000) / 1000
      e.h = Math.round(h * 1000) / 1000
      e.x = Math.round(((1 - e.w) / 2) * 1000) / 1000
      e.y = Math.round(((1 - e.h) / 2) * 1000) / 1000
    },

    /**
     * 导入若干文件（图片/PDF 混合）。每个图片 → 1 元素，每个 PDF 每页 → 1 元素。
     * 逐页输出，每个元素单独一页。
     */
    async importFiles(files) {
      const list = Array.from(files || [])
      if (list.length === 0) return
      this.loading = true
      this.errorMsg = ''
      try {
        for (const file of list) {
          if (isImageFile(file)) {
            const { src, aspect } = await readImageAsElement(file)
            this.assets.push({ id: nextId(), name: file.name, kind: 'image' })
            this._addElement({ src, aspect, kind: 'image', locked: false })
          } else if (isPdfFile(file)) {
            const rawBuffer = await file.arrayBuffer()
            const drafts = await readPdfAsElementDrafts(rawBuffer)
            this.assets.push({ id: nextId(), name: file.name, kind: 'pdf' })
            for (const d of drafts)
              this._addElement({ src: d.src, aspect: d.aspect, kind: 'pdf', locked: true })
          } else {
            // 其它文件忽略
          }
        }
        if (this.elements.length === 0) this.errorMsg = '未识别到可用的图片或 PDF 文件。'
      } catch (e) {
        console.error(e)
        this.errorMsg = '导入失败，请检查文件是否有效。'
      } finally {
        this.loading = false
      }
    },

    // —— 元素 ——
    /** 取下一个递增层级号（越大越靠上） */
    _nextZ() {
      this.z += 1
      return this.z
    },
    _addElement({ src, aspect, kind = 'image', locked = false }) {
      const element = {
        id: nextId(),
        pageId: '',
        kind,
        locked,
        src,
        aspect,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        // PDF 页锁定在最底层(z=0)，图片/批注/打码用统一递增层级按覆盖先后叠上层
        z: locked ? 0 : this._nextZ(),
      }
      this.elements.push(element)
      this._placeElementDefault(element)
      return element
    },

    removeElement(id) {
      this.elements = this.elements.filter((e) => e.id !== id)
      this._pruneEmptyPages()
    },

    /** 移动元素到指定页并更新位置（跨页拖拽终点）。keepInPage 决定是否夹取至页内。 */
    moveElement(id, pageId, x, y, keepInPage = false) {
      const el = this.elements.find((e) => e.id === id)
      if (!el) return
      // 目标是空白承接页
      if (pageId === '__new__') pageId = this._createCarrierPage()
      if (!this.pageById(pageId)) return
      el.pageId = pageId
      if (keepInPage) {
        el.x = Math.min(Math.max(x, 0), 1 - el.w)
        el.y = Math.min(Math.max(y, 0), 1 - el.h)
      } else {
        el.x = x
        el.y = y
      }
      // 后拖动的图片置于顶层：更新层级并把该元素移到本页渲染顺序末尾（PDF 页保持最底层）
      if (el.kind !== 'pdf') el.z = this._nextZ()
      const idx = this.elements.indexOf(el)
      this.elements.splice(idx, 1)
      this.elements.push(el)
    },

    resizeElement(id, rect) {
      const el = this.elements.find((e) => e.id === id)
      if (!el) return
      const ok = normalizeRect(rect)
      if (ok) Object.assign(el, ok)
    },

    /** 复制/剪切选中的图片元素到剪贴板（剪切会立即移除原元素，粘贴到鼠标位置） */
    copyElement(id, cutting = false) {
      const el = this.elements.find((e) => e.id === id)
      if (!el) return
      // 记录原尺寸，粘贴时保留剪切/复制前的大小
      this.copyBuffer = { src: el.src, aspect: el.aspect, cutting, w: el.w, h: el.h }
      if (cutting) this.removeElement(id)
    },

    /** 在鼠标点击位置粘贴剪贴板中的图片（保留原尺寸，以点击点为左上角，夹取至页内并置于顶层） */
    pasteElementAt(pageId, point) {
      if (!this.copyBuffer) return null
      const b = this.copyBuffer
      const el = this._addElement({
        src: b.src,
        aspect: b.aspect || 1,
        kind: 'image',
        locked: false,
      })
      // 保留剪切/复制前的大小（夹取至页内合法范围）
      if (b.w && b.h) {
        el.w = Math.min(Math.max(b.w, 0.02), 1)
        el.h = Math.min(Math.max(b.h, 0.02), 1)
      }
      el.pageId = pageId
      el.x = Math.round(Math.min(Math.max(point.x, 0), 1 - el.w) * 1000) / 1000
      el.y = Math.round(Math.min(Math.max(point.y, 0), 1 - el.h) * 1000) / 1000
      // 去掉 _addElement 默认新建的空白页
      this._pruneEmptyPages()
      // 置顶：后渲染者在上
      const idx = this.elements.indexOf(el)
      this.elements.splice(idx, 1)
      this.elements.push(el)
      return el
    },

    // —— 输出页 ——
    addPage(width = DEFAULT_PAGE_WIDTH, height = DEFAULT_PAGE_HEIGHT) {
      const page = { id: nextId(), width, height }
      this.pages.push(page)
      return page
    },

    /** 新建一个空白承接页（跨页拖拽到末尾且没有空页时使用），返回其 id */
    _createCarrierPage() {
      return this.addPage().id
    },

    removePage(pageId) {
      this.pages = this.pages.filter((p) => p.id !== pageId)
      this.elements = this.elements.filter((e) => e.pageId !== pageId)
      this.annotations = this.annotations.filter((a) => a.pageId !== pageId)
    },

    /** 删除没有任何元素的空页（除最后一个外） */
    _pruneEmptyPages() {
      const nonEmpty = new Set(this.elements.map((e) => e.pageId))
      // 保留至少一页
      this.pages = this.pages.filter((p, idx) => nonEmpty.has(p.id) || this.pages.length === 1)
      this.annotations = this.annotations.filter((a) => this.pageById(a.pageId))
    },

    /** 调整输出页顺序，orderIds 为全部页 id 的目标顺序 */
    reorderPages(orderIds) {
      const byId = new Map(this.pages.map((p) => [p.id, p]))
      this.pages = orderIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .concat(this.pages.filter((p) => !orderIds.includes(p.id)))
    },

    setPageSize(pageId, width, height) {
      const page = this.pageById(pageId)
      if (page) {
        page.width = width
        page.height = height
      }
    },

    // —— 标注 ——
    /** 新增标注。rect 为归一化矩形。cover 可携带文本（白底黑字）。 */
    addAnnotation({ pageId, type, rect, text = '' }) {
      const ok = normalizeRect(rect)
      if (!ok) return null
      const m = this.defaultMosaic || {}
      const isMosaic = type === 'mosaic'
      const ann = {
        id: nextId(),
        pageId,
        type,
        ...ok,
        text,
        // 按覆盖先后叠上层
        z: this._nextZ(),
        // cover 批注：字体 / 字号 / 对齐 / 颜色
        fontFamily: 'sans-serif',
        fontSize: 12,
        alignH: 'left', // left | center | right
        alignV: 'middle', // top | middle | bottom
        color: '#000000',
        // mosaic 打码：style = grid(灰白格) | solid(纯色)；color 供 solid 使用
        ...(isMosaic
          ? { style: m.style || 'grid', color: m.color || '#cfd4db' }
          : {}),
      }
      this.annotations.push(ann)
      return ann
    },

    removeAnnotation(id) {
      this.annotations = this.annotations.filter((a) => a.id !== id)
    },

    /** 移动标注位置（夹取至页内），并置顶 */
    moveAnnotation(id, x, y) {
      const a = this.annotations.find((it) => it.id === id)
      if (!a) return
      a.x = Math.min(Math.max(x, 0), 1 - a.w)
      a.y = Math.min(Math.max(y, 0), 1 - a.h)
      a.z = this._nextZ()
      const idx = this.annotations.indexOf(a)
      this.annotations.splice(idx, 1)
      this.annotations.push(a)
    },

    /** 按归一化矩形调整标注大小 */
    resizeAnnotation(id, rect) {
      const a = this.annotations.find((it) => it.id === id)
      if (!a) return
      const ok = normalizeRect(rect)
      if (ok) Object.assign(a, ok)
    },

    setAnnotationText(id, text) {
      const ann = this.annotations.find((a) => a.id === id)
      if (ann) ann.text = text
    },

    /** 批量更新标注的样式属性（如字号、字体、打码样式与颜色） */
    setAnnotationStyle(id, patch) {
      const ann = this.annotations.find((a) => a.id === id)
      if (ann) Object.assign(ann, patch)
    },
  },
})