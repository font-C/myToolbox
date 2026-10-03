<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { toolbox, useNativeFileDrop } from '@toolbox/plugin-sdk'
import { splitLines, diffRegions, buildSideRows, buildUnifiedRows, toUnifiedDiff } from './diffcore.js'
import { buildDirTree, defaultExpanded, collectDirRels } from './dirtree.js'
import { sha256Hex } from './hash.js'
import DiffRows from './DiffRows.vue'
import DirTree from './DirTree.vue'
import FileVerdict from './FileVerdict.vue'

// ---------- 双页签 ----------
// text=文本对比（行级差异）；file=文件对比（哈希一致性 + 目录树）
const activeTab = ref('text')

// ---------- 两侧输入（文本对比页） ----------
const sides = reactive({
  left: emptySide(),
  right: emptySide(),
})
const windowDragging = ref(false)
const activeSide = ref('left')

function emptySide() {
  return { kind: 'text', text: '', file: null, dir: null }
}

// ---------- 两侧输入（文件对比页） ----------
// kind: 'file'（按哈希校验一致性）| 'dir'（树状逐文件对比）
const fSides = reactive({
  left: fEmptySide(),
  right: fEmptySide(),
})

function fEmptySide() {
  return { kind: 'none', file: null, dir: null }
}

// ---------- 阶段与选项 ----------
// paneState：文本页 edit=输入卡片；diff=同一位置原位显示差异（不换页）
// fPane：文件页同样的两态
const paneState = ref('edit')
const fPane = ref('edit')
const optIgnoreWs = ref(false)
const optIgnoreCase = ref(false)
const optCollapse = ref(true)
const view = ref('side') // side=并排 | unified=上下

// ---------- 文本/文件对比结果 ----------
const result = ref(null) // { diff, sideRows, unifiedRows, collapseForced }

const sideLabel = (side) => (side === 'left' ? '原' : '新')
const sideName = (side) => {
  const s = sides[side]
  return s.file?.name || (side === 'left' ? '原内容' : '新内容')
}
const st = computed(() => result.value?.diff.stats ?? null)
const hasChanges = computed(() => !!result.value && result.value.diff.stats.hunks > 0)

// ---------- 文件对比页状态 ----------
// 文件对：SHA-256 校验；目录对：树状对比（树在上，点击文件下方面板显示判定）
const fResult = ref(null) // 文件对校验结果 { same, sizeL, sizeR, hashL, hashR, firstDiff }
const fBusy = ref(false)
// 目录对结果被两个页签共用：forTab 标记由哪个页签发起，页面只显示属于自己的结果
const dirResult = ref(null) // { forTab, rootL, rootR, nameL, nameR, rows, stats, truncated }
const dirFilter = ref('')
const dirExpanded = ref(new Set()) // 已展开目录 rel 集合（含差异链默认展开）
const dirActiveRel = ref(null) // 文本页：选中查看文本差异的文件
const verdictRel = ref(null) // 文件页：选中查看一致性判定的文件
const verdict = ref(null) // 文件页：选中文件的判定结果
const verdictBusy = ref(false)
const dirFile = ref(null) // 文本页：选中文件的 { diff, sideRows, unifiedRows }
const dirFileTexts = ref(null) // { l, r } 选中文件的原文缓存
const dirSelectedEncodings = ref({ l: '', r: '' })
const dirBusy = ref(false)
const dirProgress = ref(null)

const MAX_COMPARE_BYTES = 16 * 1024 * 1024
const MAX_TEXT_BYTES = 16 * 1024 * 1024

const isDirCompare = computed(() => fSides.left.kind === 'dir' && fSides.right.kind === 'dir')
const isTextDirCompare = computed(() => sides.left.kind === 'dir' && sides.right.kind === 'dir')

// 平铺行 → 目录树（对比结果与编辑态预览共用）
const dirTree = computed(() => (dirResult.value ? buildDirTree(dirResult.value.rows) : []))
const previewTreesFile = computed(() => ({
  left: fSides.left.kind === 'dir' ? buildDirTree(fSides.left.dir.entries.map((e) => ({ rel: e.path, status: 'plain' }))) : null,
  right: fSides.right.kind === 'dir' ? buildDirTree(fSides.right.dir.entries.map((e) => ({ rel: e.path, status: 'plain' }))) : null,
}))
const canExportReport = computed(() => (activeTab.value === 'text' ? !!result.value : !!dirResult.value))

function dirsReady(side) {
  return !!fSides[side].dir?.entries
}

// ---------- 通用 ----------
const error = ref('')

function firstEmptySide() {
  if (activeTab.value === 'file') {
    if (fSides.left.kind === 'none') return 'left'
    if (fSides.right.kind === 'none') return 'right'
    return 'left'
  }
  if (!sides.left.text) return 'left'
  if (!sides.right.text) return 'right'
  return activeSide.value
}

function stageToEditIfNeeded() {
  if (paneState.value !== 'edit') paneState.value = 'edit'
}

function stageFileEditIfNeeded() {
  if (fPane.value !== 'edit') fPane.value = 'edit'
}

function joinPath(root, rel) {
  return root.replace(/[\\/]+$/, '') + '/' + rel
}

function decodeBytes(bytes) {
  if (bytes.includes(0)) throw new Error('二进制文件不支持文本对比（内容含 NUL 字节）')
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' }
  } catch {
    try {
      return { text: new TextDecoder('gbk').decode(bytes), encoding: 'GBK（自动识别）' }
    } catch {
      return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF-8' }
    }
  }
}

function isBinaryBytes(bytes) {
  const n = Math.min(bytes.length, 8192)
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
  return false
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// ---------- 对比入口：文本页（文本/文件 → 行级差异；目录对 → 逐文件文本对比） ----------
function startCompare() {
  error.value = ''
  if (isTextDirCompare.value) {
    if (!sides.left.dir || !sides.right.dir) {
      error.value = '请先在两侧选择目录'
      return
    }
    compareDirs('text')
  } else if (sides.left.kind === 'dir' || sides.right.kind === 'dir') {
    error.value = '两侧类型需一致：都是目录，或都是文本'
  } else runCompare()
}

function backToEdit() {
  paneState.value = 'edit'
}

// ---------- 对比入口：文件页（文件对 → 哈希；目录对 → 树状） ----------
function startFileCompare() {
  error.value = ''
  if (fSides.left.kind === 'none' || fSides.right.kind === 'none') {
    error.value = '请先在两侧选择文件或目录'
    return
  }
  if (fSides.left.kind !== fSides.right.kind) {
    error.value = '两侧类型需一致：都是文件，或都是目录'
    return
  }
  if (fSides.left.kind === 'dir') compareDirs('file')
  else fileCompare()
}

function backToFileEdit() {
  fPane.value = 'edit'
}

function fSwapSides() {
  const l = fSides.left
  fSides.left = fSides.right
  fSides.right = l
  fResult.value = null
  dirResult.value = null
  verdictRel.value = null
  verdict.value = null
}

// ---------- 文件对：SHA-256 一致性校验 ----------
async function fileCompare() {
  fBusy.value = true
  fResult.value = null
  dirResult.value = null
  try {
    const [lb, rb] = await Promise.all([
      toolbox.readGranted(fSides.left.file.path),
      toolbox.readGranted(fSides.right.file.path),
    ])
    const sizeL = lb.length
    const sizeR = rb.length
    const [hashL, hashR] = await Promise.all([sha256Hex(lb), sha256Hex(rb)])
    let firstDiff = null
    if (sizeL === sizeR) {
      for (let i = 0; i < sizeL; i++) {
        if (lb[i] !== rb[i]) {
          firstDiff = i
          break
        }
      }
    }
    fResult.value = { same: sizeL === sizeR && firstDiff === null, sizeL, sizeR, hashL, hashR, firstDiff }
    fPane.value = 'diff'
  } catch (e) {
    error.value = `对比失败：${e.message || e}`
  } finally {
    fBusy.value = false
  }
}

// ---------- 文本/文件对比 ----------
let cache = null
function computeDiff() {
  const l = sides.left.text
  const r = sides.right.text
  const ws = optIgnoreWs.value
  const ci = optIgnoreCase.value
  if (cache && cache.l === l && cache.r === r && cache.ws === ws && cache.ci === ci) return cache.diff
  const a = splitLines(l)
  const b = splitLines(r)
  const diff = diffRegions(a.lines, b.lines, { ignoreWhitespace: ws, ignoreCase: ci, oldNoEol: a.noEol, newNoEol: b.noEol })
  cache = { l, r, ws, ci, diff }
  return diff
}

function buildViewRows(diff, collapse) {
  let useCollapse = collapse
  let collapseForced = false
  if (!useCollapse) {
    let estimate = diff.stats.unchanged
    for (const rg of diff.regions) {
      if (rg.type === 'change') estimate += Math.max(rg.oldLines.length, rg.newLines.length)
    }
    if (estimate > 8000) {
      useCollapse = true
      collapseForced = true
    }
  }
  return {
    sideRows: buildSideRows(diff, { context: 3, collapse: useCollapse }),
    unifiedRows: buildUnifiedRows(diff, { context: 3, collapse: useCollapse }),
    collapseForced,
  }
}

function runCompare() {
  error.value = ''
  if (!sides.left.text && !sides.right.text) {
    error.value = '请先在两侧输入内容、选择文件或拖入文件'
    return
  }
  const total = sides.left.text.length + sides.right.text.length
  if (total > 8_000_000) {
    error.value = `内容过大（约 ${(total / 1e6).toFixed(1)}M 字符），请拆分后对比`
    return
  }
  const diff = computeDiff()
  result.value = { diff, ...buildViewRows(diff, optCollapse.value) }
  expandedGaps.value = new Set()
  paneState.value = 'diff'
}

// 结果态切换选项 → 就地重建（文本页差异 / 文件页目录展开差异）
watch([optIgnoreWs, optIgnoreCase, optCollapse], () => {
  if (result.value && paneState.value === 'diff') {
    const diff = computeDiff()
    result.value = { diff, ...buildViewRows(diff, optCollapse.value) }
    expandedGaps.value = new Set()
  } else if (dirFile.value && dirFileTexts.value) {
    rebuildDirFileRows()
  }
})

// 切换页签：结果不属于目标页签时回到编辑态，避免展示他页发起的对比
watch(activeTab, (t) => {
  if (t === 'text' && paneState.value === 'diff' && !result.value && dirResult.value?.forTab !== 'text') {
    paneState.value = 'edit'
  }
  if (t === 'file' && fPane.value === 'diff' && !fResult.value && dirResult.value?.forTab !== 'file') {
    fPane.value = 'edit'
  }
})

// ---------- 折叠展开 ----------
const expandedGaps = ref(new Set())
function flatten(rows) {
  if (!rows) return []
  const out = []
  for (const r of rows) {
    if (r.kind === 'gap' && expandedGaps.value.has(r.id)) out.push(...r.rows)
    else out.push(r)
  }
  return out
}
const sideDisplay = computed(() => flatten(currentRows()?.sideRows ?? null))
const unifiedDisplay = computed(() => flatten(currentRows()?.unifiedRows ?? null))
// 按当前页签取差异行：文本页 → 文本结果或目录选中文件的差异；文件页无行级差异
function currentRows() {
  if (activeTab.value !== 'text' || paneState.value !== 'diff') return null
  return isTextDirCompare.value ? dirFile.value : result.value
}
function expandGap(id) {
  expandedGaps.value.add(id)
}

// ---------- 文本/文件：载入（文本页） ----------
async function applyFile(side, { name, bytes }) {
  if (bytes.length > MAX_TEXT_BYTES) {
    throw new Error(`文件过大（${fmtSize(bytes.length)}），文本对比仅支持 16MB 以内`)
  }
  const { text, encoding } = decodeBytes(bytes)
  sides[side] = { kind: 'text', text, file: { name, encoding, size: bytes.length }, dir: null }
}

async function pickFile(side) {
  try {
    const files = await toolbox.pickOpenFile()
    if (!files.length) return
    await applyFile(side, files[0])
  } catch (e) {
    error.value = `读取文件失败：${e.message || e}`
  }
}

// ---------- 文件/目录：载入（文件页，不读内容） ----------
function setFileEntry(side, f) {
  fSides[side] = { kind: 'file', file: { name: f.name, path: f.path, size: f.bytes?.length ?? null }, dir: null }
}

async function pickFileMeta(side) {
  try {
    const files = await toolbox.pickOpenFile()
    if (!files.length) return
    setFileEntry(side, files[0])
    error.value = ''
  } catch (e) {
    error.value = `读取文件失败：${e.message || e}`
  }
}

async function pickDirText(side) {
  try {
    const picked = await toolbox.pickDirectory()
    if (!picked) return
    const listing = await toolbox.listDir(picked.path)
    sides[side] = {
      kind: 'dir',
      text: '',
      file: null,
      dir: { path: picked.path, name: picked.name, entries: listing.entries, truncated: listing.truncated },
    }
    error.value = ''
  } catch (e) {
    error.value = `读取目录失败：${e.message || e}`
  }
}

async function pickDir(side) {
  try {
    const picked = await toolbox.pickDirectory()
    if (!picked) return
    const listing = await toolbox.listDir(picked.path)
    fSides[side] = {
      kind: 'dir',
      file: null,
      dir: { path: picked.path, name: picked.name, entries: listing.entries, truncated: listing.truncated },
    }
    error.value = ''
  } catch (e) {
    error.value = `读取目录失败：${e.message || e}`
  }
}

function clearSide(side) {
  sides[side] = emptySide()
}

function fClearSide(side) {
  fSides[side] = fEmptySide()
  fResult.value = null
}

// Tauri 原生拖拽：按当前页签路由，目录填入当前页的目录输入
async function onNativeDrop(list) {
  if (!list?.length) return
  error.value = ''
  try {
    const droppedDirs = []
    const droppedFiles = []
    for (const f of list) {
      const info = await toolbox.dirInfo(f.path).catch(() => null)
      if (info) droppedDirs.push({ path: f.path, listing: info })
      else droppedFiles.push(f)
    }
    if (droppedDirs.length) {
      const toFileTab = activeTab.value === 'file'
      if (toFileTab) stageFileEditIfNeeded()
      else stageToEditIfNeeded()
      const fill = (side, d) => fillSideFromPath(side, d, toFileTab ? 'file' : 'text')
      if (droppedDirs.length >= 2) {
        fill('left', droppedDirs[0])
        fill('right', droppedDirs[1])
      } else {
        fill(firstEmptySide(), droppedDirs[0])
      }
      if (droppedFiles.length) error.value = '目录与文件请分两次拖入'
    } else if (activeTab.value === 'file') {
      stageFileEditIfNeeded()
      if (droppedFiles.length >= 2) {
        setFileEntry('left', droppedFiles[0])
        setFileEntry('right', droppedFiles[1])
        startFileCompare()
      } else {
        setFileEntry(firstEmptySide(), droppedFiles[0])
      }
    } else {
      // 文本页：文件读入内容做行级对比
      const loadOne = async (side, f) => {
        const bytes = await toolbox.readGranted(f.path)
        await applyFile(side, { name: f.name, bytes })
      }
      if (droppedFiles.length >= 2) {
        await loadOne('left', droppedFiles[0])
        await loadOne('right', droppedFiles[1])
        runCompare()
      } else {
        stageToEditIfNeeded()
        await loadOne(firstEmptySide(), droppedFiles[0])
      }
    }
  } catch (e) {
    error.value = `读取拖入内容失败：${e.message || e}`
  }
}

function fillSideFromPath(side, d, tab) {
  const dir = {
    path: d.path,
    name: d.path.split(/[\\/]/).pop(),
    entries: d.listing.entries,
    truncated: d.listing.truncated,
  }
  if (tab === 'file') fSides[side] = { kind: 'dir', file: null, dir }
  else sides[side] = { kind: 'dir', text: '', file: null, dir }
}

let stopNativeDrop = () => {}
let stopRawDrop = () => {}
onMounted(() => {
  // 浏览器兜底（HTML5 拖拽，仅文件）
  stopNativeDrop = useNativeFileDrop({
    onFiles: (list) => onNativeDrop(list),
    onDragState: (v) => (windowDragging.value = v),
  })
  // 原生拖拽（拿原始路径，区分文件/文件夹）
  stopRawDrop = toolbox.onDragDrop({
    onEnter: () => (windowDragging.value = true),
    onOver: () => (windowDragging.value = true),
    onLeave: () => (windowDragging.value = false),
    onDrop: (files) => {
      windowDragging.value = false
      onNativeDrop(files)
    },
  })
})
onUnmounted(() => {
  stopNativeDrop()
  stopRawDrop()
})

// ---------- 卡片辅助 ----------
function cardTitle(side) {
  const s = sides[side]
  if (s.kind === 'dir') return `📁 ${s.dir.path}`
  return s.file ? `📄 ${s.file.name}` : '粘贴文本、选择文件或目录，或拖入窗口'
}
function cardMeta(side) {
  const s = sides[side]
  if (s.kind === 'dir') {
    return `共 ${s.dir.entries.length} 个文件${s.dir.truncated ? '（已截断）' : ''}`
  }
  const lines = s.text === '' ? 0 : splitLines(s.text).lines.length
  return `${lines} 行 · ${s.file ? `${s.file.encoding} · ${fmtSize(s.file.size)}` : '手动输入'}`
}
function fCardTitle(side) {
  const s = fSides[side]
  if (s.kind === 'dir') return `📁 ${s.dir.path}`
  if (s.kind === 'file') return `📄 ${s.file.name}`
  return '选择文件或目录，或拖入窗口'
}
function fCardMeta(side) {
  const s = fSides[side]
  if (s.kind === 'dir') {
    return `共 ${s.dir.entries.length} 个文件${s.dir.truncated ? '（已截断）' : ''}`
  }
  if (s.kind === 'file') {
    return s.file.path || ''
  }
  return ''
}
function fmtSize(n) {
  if (n == null) return '—'
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`
}

function swapSides() {
  const l = sides.left
  sides.left = sides.right
  sides.right = l
}

// ---------- 目录对比（两页签共用引擎；文本口径：逐文件文本对比，一致性口径：逐文件哈希判定） ----------
const DIR_STATUS = {
  diff: { label: '内容不同', cls: 'b--diff' },
  binary: { label: '二进制/未比较', cls: 'b--bin' },
  onlyL: { label: '仅原目录', cls: 'b--l' },
  onlyR: { label: '仅新目录', cls: 'b--r' },
  same: { label: '相同', cls: 'b--same' },
}

async function analyzeCommonFile(rel, sizeL, sizeR, rootL, rootR) {
  try {
    if (Math.max(sizeL, sizeR) > MAX_COMPARE_BYTES) {
      // 过大不逐字节比较：尺寸相同视为未比较，尺寸不同视为有差异
      return { status: sizeL === sizeR ? 'binary' : 'diff', plus: null, minus: null }
    }
    const [lb, rb] = await Promise.all([
      toolbox.readGranted(joinPath(rootL, rel)),
      toolbox.readGranted(joinPath(rootR, rel)),
    ])
    if (bytesEqual(lb, rb)) return { status: 'same', plus: 0, minus: 0 }
    if (isBinaryBytes(lb) || isBinaryBytes(rb)) return { status: 'binary', plus: null, minus: null }
    const l = decodeBytes(lb)
    const r = decodeBytes(rb)
    const a = splitLines(l.text)
    const b = splitLines(r.text)
    const d = diffRegions(a.lines, b.lines, {
      ignoreWhitespace: optIgnoreWs.value,
      ignoreCase: optIgnoreCase.value,
      oldNoEol: a.noEol,
      newNoEol: b.noEol,
    })
    return {
      status: 'diff',
      plus: d.stats.added + d.stats.modified,
      minus: d.stats.removed + d.stats.modified,
    }
  } catch {
    return { status: 'binary', plus: null, minus: null }
  }
}

/**
 * 目录对比。tab='text'：文本页逐文件文本对比（就地展开差异）；
 * tab='file'：文件页逐文件一致性（点击文件在下方面板看哈希判定）。
 */
async function compareDirs(tab) {
  const src = tab === 'text' ? sides : fSides
  error.value = ''
  dirActiveRel.value = null
  dirFile.value = null
  dirFileTexts.value = null
  verdictRel.value = null
  verdict.value = null
  dirBusy.value = true
  try {
    const rootL = src.left.dir.path
    const rootR = src.right.dir.path
    const nameL = src.left.dir.name
    const nameR = src.right.dir.name
    const L = new Map(src.left.dir.entries.map((e) => [e.path, e]))
    const R = new Map(src.right.dir.entries.map((e) => [e.path, e]))
    const rows = []
    let onlyL = 0
    let onlyR = 0
    for (const [rel, e] of L) {
      if (!R.has(rel)) {
        rows.push({ rel, status: 'onlyL', sizeL: e.size, sizeR: null, plus: null, minus: null })
        onlyL++
      }
    }
    for (const [rel, e] of R) {
      if (!L.has(rel)) {
        rows.push({ rel, status: 'onlyR', sizeL: null, sizeR: e.size, plus: null, minus: null })
        onlyR++
      }
    }
    const common = []
    for (const [rel, e] of L) {
      const r = R.get(rel)
      if (r) common.push({ rel, sizeL: e.size, sizeR: r.size })
    }
    dirProgress.value = { done: 0, total: common.length }
    let same = 0
    let diff = 0
    let binary = 0
    let totalPlus = 0
    let totalMinus = 0
    for (const c of common) {
      const res = await analyzeCommonFile(c.rel, c.sizeL, c.sizeR, rootL, rootR)
      rows.push({ rel: c.rel, status: res.status, sizeL: c.sizeL, sizeR: c.sizeR, plus: res.plus, minus: res.minus })
      if (res.status === 'same') same++
      else if (res.status === 'diff') diff++
      else binary++
      if (res.plus != null) {
        totalPlus += res.plus
        totalMinus += res.minus
      }
      dirProgress.value = { done: dirProgress.value.done + 1, total: common.length }
    }
    rows.sort((a, b) => a.rel.localeCompare(b.rel))
    dirResult.value = {
      forTab: tab,
      rootL,
      rootR,
      nameL,
      nameR,
      rows,
      stats: { onlyL, onlyR, same, diff, binary, common: common.length, totalPlus, totalMinus },
      truncated: src.left.dir.truncated || src.right.dir.truncated,
    }
    // 默认展开：含差异文件的目录链；纯相同子树折叠
    dirExpanded.value = defaultExpanded(dirTree.value)
    if (tab === 'text') {
      result.value = null // 与文本差异互斥显示
      paneState.value = 'diff'
      // 自动展开第一个内容不同的文件（就地差异）
      const first = rows.find((r) => r.status === 'diff')
      if (first) await openDirFile(first)
    } else {
      fResult.value = null // 与文件对判定互斥显示
      fPane.value = 'diff'
      // 自动选中第一个不一致的文件（下方面板显示判定）
      const first = rows.find((r) => r.status === 'diff' || r.status === 'binary')
      if (first) await openDirFileVerdict(first)
    }
  } finally {
    dirBusy.value = false
    dirProgress.value = null
  }
}

function toggleDir(rel) {
  const next = new Set(dirExpanded.value)
  next.has(rel) ? next.delete(rel) : next.add(rel)
  dirExpanded.value = next
}

function expandAllDirs() {
  dirExpanded.value = new Set(collectDirRels(dirTree.value))
}

function collapseAllDirs() {
  dirExpanded.value = new Set()
}

// ---------- 文本页目录模式：就地展开选中文件的文本差异 ----------
// 单侧文件（仅原=整文件删除，仅新=整文件新增）读取存在的一侧，缺侧为空文本
async function openDirFile(row) {
  error.value = ''
  try {
    let lText = ''
    let rText = ''
    let lEnc = ''
    let rEnc = ''
    if (row.status === 'onlyL') {
      const d = decodeBytes(await toolbox.readGranted(joinPath(dirResult.value.rootL, row.rel)))
      lText = d.text
      lEnc = d.encoding
    } else if (row.status === 'onlyR') {
      const d = decodeBytes(await toolbox.readGranted(joinPath(dirResult.value.rootR, row.rel)))
      rText = d.text
      rEnc = d.encoding
    } else {
      const lb = await toolbox.readGranted(joinPath(dirResult.value.rootL, row.rel))
      const rb = await toolbox.readGranted(joinPath(dirResult.value.rootR, row.rel))
      const l = decodeBytes(lb)
      const r = decodeBytes(rb)
      lText = l.text
      rText = r.text
      lEnc = l.encoding
      rEnc = r.encoding
    }
    dirFileTexts.value = { l: lText, r: rText }
    rebuildDirFileRows()
    dirSelectedEncodings.value = { l: lEnc, r: rEnc }
    dirActiveRel.value = row.rel
  } catch (e) {
    error.value = `读取文件失败：${e.message || e}`
  }
}

function rebuildDirFileRows() {
  const { l, r } = dirFileTexts.value
  const a = splitLines(l)
  const b = splitLines(r)
  const diff = diffRegions(a.lines, b.lines, {
    ignoreWhitespace: optIgnoreWs.value,
    ignoreCase: optIgnoreCase.value,
    oldNoEol: a.noEol,
    newNoEol: b.noEol,
  })
  dirFile.value = { diff, ...buildViewRows(diff, optCollapse.value) }
  expandedGaps.value = new Set()
}

function toggleDirFile(row) {
  if (dirActiveRel.value === row.rel) {
    dirActiveRel.value = null
    dirFile.value = null
    dirFileTexts.value = null
    return
  }
  openDirFile(row)
}

function onDirRowClick(row) {
  // 「内容不同」与单侧文件（删除/新增）可展开差异；相同与二进制行只作状态展示
  if (row.status === 'diff' || row.status === 'onlyL' || row.status === 'onlyR') toggleDirFile(row)
}

// ---------- 文件页目录模式：选中文件在下方面板显示哈希判定 ----------
async function openDirFileVerdict(row) {
  error.value = ''
  if (verdictRel.value === row.rel) {
    verdictRel.value = null
    verdict.value = null
    return
  }
  verdictRel.value = row.rel
  verdict.value = null
  verdictBusy.value = true
  try {
    const [lb, rb] = await Promise.all([
      toolbox.readGranted(joinPath(dirResult.value.rootL, row.rel)),
      toolbox.readGranted(joinPath(dirResult.value.rootR, row.rel)),
    ])
    const [hashL, hashR] = await Promise.all([sha256Hex(lb), sha256Hex(rb)])
    let firstDiff = null
    if (lb.length === rb.length) {
      for (let i = 0; i < lb.length; i++) {
        if (lb[i] !== rb[i]) {
          firstDiff = i
          break
        }
      }
    }
    verdict.value = { same: lb.length === rb.length && firstDiff === null, sizeL: lb.length, sizeR: rb.length, hashL, hashR, firstDiff }
  } catch (e) {
    error.value = `读取文件失败：${e.message || e}`
    verdictRel.value = null
  } finally {
    verdictBusy.value = false
  }
}

function onDirRowClickFile(row) {
  // 双侧都存在的文件（相同/不同/二进制）可查看判定；单侧独有无从比较
  if (row.status === 'onlyL' || row.status === 'onlyR') return
  openDirFileVerdict(row)
}

function closeVerdict() {
  verdictRel.value = null
  verdict.value = null
}

// ---------- 导出 ----------
async function savePatch() {
  if (!hasChanges.value) return
  const patch = toUnifiedDiff(result.value.diff, {
    oldName: sides.left.file?.name || '原内容',
    newName: sides.right.file?.name || '新内容',
  })
  if (!patch) return
  try {
    const path = await toolbox.pickSaveFile({
      defaultName: '对比补丁.patch',
      filters: [{ name: '补丁文件', extensions: ['patch', 'diff', 'txt'] }],
      bytes: new TextEncoder().encode(patch),
    })
  } catch (e) {
    error.value = `保存失败：${e.message || e}`
  }
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function makeHtmlReport() {
  if (isDirCompare.value) return makeDirHtmlReport()
  const r = result.value
  const s = r.diff.stats
  let body
  if (!hasChanges.value) {
    body = '<tr class="same"><td colspan="4">两个内容完全一致</td></tr>'
  } else {
    body = r.unifiedRows
      .map((row) => {
        if (row.kind === 'gap') return `<tr class="gap"><td colspan="4">⋯ 相同内容 ${row.count} 行（已折叠）⋯</td></tr>`
        const sign = row.kind === 'del' ? '-' : row.kind === 'add' ? '+' : ' '
        const content = row.segs
          ? row.segs.map((x) => (x.chg ? `<span class="hl">${esc(x.t)}</span>` : esc(x.t))).join('')
          : esc(row.text)
        return `<tr class="${row.kind}"><td class="n">${row.on ?? ''}</td><td class="n">${row.nn ?? ''}</td><td class="sign">${sign}</td><td class="c"><pre>${content || ' '}</pre></td></tr>`
      })
      .join('\n')
  }
  const time = new Date().toLocaleString('zh-CN')
  const opts = [optIgnoreWs.value && '忽略空白', optIgnoreCase.value && '忽略大小写'].filter(Boolean).join('、') || '无'
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>文件对比报告 · ${esc(sideName('left'))} vs ${esc(sideName('right'))}</title>
<style>
  body { font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; margin: 24px auto; max-width: 1000px; color: #1e293b; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .meta { color: #64748b; font-size: 12.5px; margin: 0 0 16px; }
  table { border-collapse: collapse; width: 100%; border: 1px solid #e2e8f0; border-radius: 8px; }
  td { font-size: 12.5px; vertical-align: top; }
  td.n { width: 44px; text-align: right; padding: 0 8px 0 0; color: #94a3b8; background: #f8fafc; user-select: none;
         font: 11px/1.7 ui-monospace, Menlo, Consolas, monospace; }
  td.sign { width: 18px; text-align: center; color: #94a3b8; font: 12.5px/1.7 ui-monospace, Menlo, Consolas, monospace; }
  td.c pre { margin: 0; padding: 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4;
             font: 12.5px/1.7 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; }
  tr.del td { background: #fef2f2; } tr.del td.n { background: #fee2e2; color: #b91c1c; } tr.del .hl { background: #fecaca; }
  tr.add td { background: #f0fdf4; } tr.add td.n { background: #dcfce7; color: #15803d; } tr.add .hl { background: #bbf7d0; }
  tr.gap td { text-align: center; color: #64748b; background: #f1f5f9; font-size: 12px; padding: 3px; }
  tr.same td { text-align: center; color: #16a34a; font-size: 13px; padding: 14px; }
</style>
</head>
<body>
<h1>文件对比报告</h1>
<p class="meta">${esc(sideName('left'))} → ${esc(sideName('right'))} · ${time} · 差异 ${s.hunks} 处（+${s.added} 新增 / −${s.removed} 删除 / ~${s.modified} 修改） · 对比选项：${opts}</p>
<table>
${body}
</table>
</body>
</html>
`
}

function makeDirHtmlReport() {
  const s = dirResult.value.stats
  const time = new Date().toLocaleString('zh-CN')
  const rowsHtml = dirResult.value.rows
    .map((r) => {
      const badge = DIR_STATUS[r.status]
      const sizeL = r.sizeL == null ? '—' : fmtSize(r.sizeL)
      const sizeR = r.sizeR == null ? '—' : fmtSize(r.sizeR)
      return `<tr class="st-${r.status}"><td>${badge.label}</td><td class="p">${esc(r.rel)}</td><td class="s">${sizeL}</td><td class="s">${sizeR}</td></tr>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>目录对比报告 · ${esc(dirResult.nameL)} vs ${esc(dirResult.nameR)}</title>
<style>
  body { font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; margin: 24px auto; max-width: 1000px; color: #1e293b; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .meta { color: #64748b; font-size: 12.5px; margin: 0 0 16px; line-height: 1.8; }
  table { border-collapse: collapse; width: 100%; border: 1px solid #e2e8f0; }
  th { background: #f8fafc; font-size: 12px; color: #64748b; text-align: left; padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
  td { font-size: 12.5px; padding: 4px 10px; border-bottom: 1px solid #f1f5f9; }
  td.p { font-family: ui-monospace, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
  td.s { color: #64748b; white-space: nowrap; }
  tr.st-diff td:first-child { color: #b45309; font-weight: 600; }
  tr.st-onlyL td:first-child, tr.st-onlyR td:first-child { color: #64748b; }
  tr.st-same td:first-child { color: #16a34a; }
  tr.st-binary td:first-child { color: #94a3b8; }
</style>
</head>
<body>
<h1>目录对比报告</h1>
<p class="meta">
  原目录：${esc(dirResult.rootL)}<br>
  新目录：${esc(dirResult.rootR)}<br>
  ${time} · 共同文件 ${s.common}（相同 ${s.same} / 不同 ${s.diff} / 二进制 ${s.binary}）· 仅原目录 ${s.onlyL} · 仅新目录 ${s.onlyR}
</p>
<table>
<tr><th>状态</th><th>文件</th><th>原大小</th><th>新大小</th></tr>
${rowsHtml}
</table>
</body>
</html>
`
}

async function saveHtml() {
  if (!canExportReport.value) return
  try {
    await toolbox.pickSaveFile({
      defaultName: isDirCompare.value ? '目录对比报告.html' : '对比报告.html',
      filters: [{ name: 'HTML 报告', extensions: ['html'] }],
      bytes: new TextEncoder().encode(makeHtmlReport()),
    })
  } catch (e) {
    error.value = `保存失败：${e.message || e}`
  }
}

// ---------- 键盘 ----------
function toggleByKeyboard() {
  if (activeTab.value === 'text') {
    paneState.value === 'edit' ? startCompare() : backToEdit()
  } else {
    fPane.value === 'edit' ? startFileCompare() : backToFileEdit()
  }
}
</script>

<template>
  <div class="page" @keydown.ctrl.enter="toggleByKeyboard" @keydown.meta.enter="toggleByKeyboard">
    <header class="header">
      <h1>文件对比</h1>
      <p class="header__sub">文本对比：行级差异并排查看 · 文件对比：SHA-256 校验一致性、目录树状对比 · 全部本地处理</p>
    </header>

    <main class="body">
      <!-- 页签 -->
      <nav class="tabs">
        <button type="button" :class="{ on: activeTab === 'text' }" @click="activeTab = 'text'">文本对比</button>
        <button type="button" :class="{ on: activeTab === 'file' }" @click="activeTab = 'file'">文件对比</button>
      </nav>

      <!-- 工具栏（吸顶，两页共用；首按钮与导出按页签切换） -->
      <section class="toolbar">
        <template v-if="activeTab === 'text'">
          <button v-if="paneState === 'edit'" type="button" class="btn btn--primary" @click="startCompare">开始对比</button>
          <button v-else type="button" class="btn" @click="backToEdit">重新编辑</button>
          <button v-if="paneState === 'edit'" type="button" class="btn" title="交换两侧内容" @click="swapSides">⇄ 交换</button>
        </template>
        <template v-else>
          <button v-if="fPane === 'edit'" type="button" class="btn btn--primary" :disabled="fBusy || dirBusy" @click="startFileCompare">
            开始对比
          </button>
          <button v-else type="button" class="btn" @click="backToFileEdit">重新编辑</button>
          <button v-if="fPane === 'edit'" type="button" class="btn" title="交换两侧内容" @click="fSwapSides">⇄ 交换</button>
        </template>
        <label class="opt"><input v-model="optIgnoreWs" type="checkbox" /> 忽略空白</label>
        <label class="opt"><input v-model="optIgnoreCase" type="checkbox" /> 忽略大小写</label>
        <label class="opt"><input v-model="optCollapse" type="checkbox" /> 折叠相同区域</label>
        <span class="spacer" />
        <div class="seg">
          <button type="button" :class="{ on: view === 'side' }" @click="view = 'side'">并排</button>
          <button type="button" :class="{ on: view === 'unified' }" @click="view = 'unified'">上下</button>
        </div>
        <button v-if="activeTab === 'text'" type="button" class="btn" :disabled="!hasChanges" @click="savePatch">保存 .patch</button>
        <button type="button" class="btn" :disabled="!canExportReport" @click="saveHtml">保存 HTML 报告</button>
      </section>

      <p v-if="dirBusy && dirProgress" class="notice">正在比较文件 {{ dirProgress.done }}/{{ dirProgress.total }} …</p>
      <p v-if="fBusy" class="notice">正在计算 SHA-256 …</p>
      <p v-if="error" class="error">{{ error }}</p>

      <!-- ===== 页签一：文本对比 ===== -->
      <div v-show="activeTab === 'text'" class="tabpane">
        <!-- 编辑态：两侧卡片 -->
        <section v-show="paneState === 'edit'" class="panes" :class="view === 'side' ? 'panes--side' : 'panes--stack'">
          <div v-for="side in ['left', 'right']" :key="side" class="pane">
            <div class="pane__head">
              <span class="card__label" :class="side === 'left' ? 'card__label--l' : 'card__label--r'">{{ sideLabel(side) }}</span>
              <span class="pane__name" :title="sides[side].kind === 'dir' ? sides[side].dir?.path : sides[side].file?.name || ''">
                {{ cardTitle(side) }}
              </span>
              <button type="button" class="btn btn--mini" @click="pickFile(side)">选择文件</button>
              <button type="button" class="btn btn--mini" @click="pickDirText(side)">
                {{ side === 'left' ? '选择原目录' : '选择新目录' }}
              </button>
              <button type="button" class="btn btn--mini" @click="clearSide(side)">清空</button>
            </div>
            <!-- 目录：文件数 + 平铺预览 -->
            <div v-if="sides[side].kind === 'dir'" class="pane__dirlist">
              <div class="dircard__sum">
                共 {{ sides[side].dir.entries.length }} 个文件<span v-if="sides[side].dir.truncated">（超出上限，已截断）</span>
              </div>
              <div class="dircard__list">
                <div v-for="e in sides[side].dir.entries.slice(0, 40)" :key="e.path" class="dircard__item">{{ e.path }}</div>
                <div v-if="sides[side].dir.entries.length > 40" class="dircard__item dircard__item--more">
                  … 以及另外 {{ sides[side].dir.entries.length - 40 }} 个文件
                </div>
              </div>
            </div>
            <!-- 文本：编辑框 -->
            <textarea
              v-else
              v-model="sides[side].text"
              class="pane__ta"
              spellcheck="false"
              :placeholder="side === 'left' ? '粘贴原文件内容，或把文件拖到这里…' : '粘贴新文件内容，或把文件拖到这里…'"
              @focus="activeSide = side"
            ></textarea>
            <div class="pane__meta">{{ cardMeta(side) }}</div>
          </div>
        </section>

        <!-- 编辑态空提示 -->
        <section v-if="paneState === 'edit' && !sides.left.text && !sides.right.text && !sides.left.dir && !sides.right.dir" class="empty">
          <p>① 每侧可粘贴文本、选择文件或选择目录（支持拖进窗口）</p>
          <p>② 两侧都是目录 → 按目录+文件名逐个对比文本内容，点击文件就地展开差异；否则比较文本内容（Ctrl/⌘ + Enter）</p>
          <p class="empty__hint">UTF-8 / GBK 自动识别 · 行内差异高亮 · 可导出 git 补丁与 HTML 报告 · 只判断文件是否一致请切到「文件对比」页</p>
        </section>

        <!-- 对比态：原位差异 -->
        <template v-if="paneState === 'diff' && result">
          <section v-if="hasChanges" class="statsbar">
            <span class="chip chip--del">−{{ st.removed }} 删除</span>
            <span class="chip chip--add">+{{ st.added }} 新增</span>
            <span class="chip chip--mod">~{{ st.modified }} 修改</span>
            <span class="chip">{{ st.unchanged }} 行相同</span>
            <span class="chip">{{ st.hunks }} 处差异</span>
            <span v-if="result.collapseForced" class="chip chip--warn">内容较长，已自动折叠相同区域</span>
          </section>
          <section v-else class="samebox">✓ 两个内容完全一致（{{ st.unchanged }} 行）</section>

          <DiffRows
            v-if="hasChanges"
            :view="view"
            :side-rows="sideDisplay"
            :unified-rows="unifiedDisplay"
            :left-title="sideName('left')"
            :right-title="sideName('right')"
            @expand="expandGap"
          />
        </template>

        <!-- 对比态：目录对 → 树状逐文件文本对比（点击 diff 文件就地展开差异） -->
        <template v-if="isTextDirCompare && paneState === 'diff' && dirResult?.forTab === 'text'">
          <section class="statsbar">
            <span class="chip chip--mod">{{ dirResult.stats.diff }} 个文件不同</span>
            <span class="chip">
              <b class="pm-plus">+{{ dirResult.stats.totalPlus }}</b>
              <b class="pm-minus">−{{ dirResult.stats.totalMinus }}</b>
            </span>
            <span class="chip">{{ dirResult.stats.same }} 个相同</span>
            <span class="chip">{{ dirResult.stats.onlyL + dirResult.stats.onlyR }} 个单侧独有</span>
            <span v-if="dirResult.truncated" class="chip chip--warn">目录文件数超上限，结果可能不完整</span>
          </section>

          <section class="dirbar">
            <input v-model="dirFilter" class="input" type="text" placeholder="按路径筛选…" spellcheck="false" />
          </section>

          <section class="dirlist">
            <DirTree
              flat
              :tree="dirTree"
              :expanded="dirExpanded"
              :expanded-rel="dirActiveRel"
              :filter="dirFilter"
              @open="onDirRowClick"
            >
              <template #expand="{ rel }">
                <template v-if="dirFile">
                  <div class="dexpand__meta">
                    原 {{ dirResult.nameL }}/{{ rel }}（{{ dirSelectedEncodings.l || '不存在' }}）
                    → 新 {{ dirResult.nameR }}/{{ rel }}（{{ dirSelectedEncodings.r || '不存在' }}）
                  </div>
                  <DiffRows
                    :view="view"
                    :side-rows="sideDisplay"
                    :unified-rows="unifiedDisplay"
                    :left-title="'原 · ' + rel"
                    :right-title="'新 · ' + rel"
                    @expand="expandGap"
                  />
                </template>
              </template>
            </DirTree>
          </section>
        </template>
      </div>

      <!-- ===== 页签二：文件对比 ===== -->
      <div v-show="activeTab === 'file'" class="tabpane">
        <!-- 编辑态：两侧卡片 -->
        <section v-show="fPane === 'edit'" class="panes" :class="view === 'side' ? 'panes--side' : 'panes--stack'">
          <div v-for="side in ['left', 'right']" :key="side" class="pane">
            <div class="pane__head">
              <span class="card__label" :class="side === 'left' ? 'card__label--l' : 'card__label--r'">{{ sideLabel(side) }}</span>
              <span class="pane__name" :title="fSides[side].kind === 'dir' ? fSides[side].dir?.path : fSides[side].file?.path || ''">
                {{ fCardTitle(side) }}
              </span>
              <button type="button" class="btn btn--mini" @click="pickFileMeta(side)">选择文件</button>
              <button type="button" class="btn btn--mini" @click="pickDir(side)">
                {{ side === 'left' ? '选择原目录' : '选择新目录' }}
              </button>
              <button type="button" class="btn btn--mini" @click="fClearSide(side)">清空</button>
            </div>
            <!-- 目录：文件数 + 树状预览 -->
            <div v-if="fSides[side].kind === 'dir'" class="pane__dirlist">
              <div class="dircard__sum">
                共 {{ fSides[side].dir.entries.length }} 个文件<span v-if="fSides[side].dir.truncated">（超出上限，已截断）</span>
              </div>
              <DirTree v-if="previewTreesFile[side]" :tree="previewTreesFile[side]" preview :limit="80" class="dircard__tree" />
            </div>
            <!-- 文件：信息卡 -->
            <div v-else-if="fSides[side].kind === 'file'" class="pane__fileinfo">
              <div class="pane__fileinfo__icon">📄</div>
              <div class="pane__fileinfo__name">{{ fSides[side].file.name }}</div>
              <div class="pane__fileinfo__path" :title="fSides[side].file.path">{{ fSides[side].file.path }}</div>
              <div v-if="fSides[side].file.size != null" class="pane__fileinfo__size">{{ fmtSize(fSides[side].file.size) }}</div>
            </div>
            <!-- 空：占位 -->
            <div v-else class="pane__fileinfo pane__fileinfo--empty">
              <div class="pane__fileinfo__icon">🗂️</div>
              <div class="pane__fileinfo__name">选择文件或目录</div>
              <div class="pane__fileinfo__path">也可直接拖入窗口</div>
            </div>
            <div class="pane__meta">{{ fCardMeta(side) }}</div>
          </div>
        </section>

        <!-- 编辑态空提示 -->
        <section v-if="fPane === 'edit' && fSides.left.kind === 'none' && fSides.right.kind === 'none'" class="empty">
          <p>① 每侧选择文件或目录（支持把文件/文件夹拖进窗口）</p>
          <p>② 两个文件 → 计算 SHA-256 判断是否完全一致；两个目录 → 树图展示各文件一致性，点击文件在下方面板查看判定</p>
          <p class="empty__hint">大文件、二进制文件都适用 · 需要查看行级差异请切到「文本对比」页</p>
        </section>

        <!-- 对比态：文件对 → 哈希校验结果 -->
        <template v-if="fPane === 'diff' && fResult">
          <FileVerdict
            :result="fResult"
            :left-name="fSides.left.file?.name || '原文件'"
            :right-name="fSides.right.file?.name || '新文件'"
          />
        </template>

        <!-- 对比态：目录对 → 树图在上，点击文件在下方面板显示一致性判定 -->
        <template v-if="isDirCompare && fPane === 'diff' && dirResult?.forTab === 'file'">
          <section class="statsbar">
            <span class="chip chip--mod">{{ dirResult.stats.diff + dirResult.stats.binary }} 个不一致</span>
            <span class="chip">{{ dirResult.stats.same }} 个一致</span>
            <span class="chip">{{ dirResult.stats.onlyL + dirResult.stats.onlyR }} 个单侧独有</span>
            <span v-if="dirResult.truncated" class="chip chip--warn">目录文件数超上限，结果可能不完整</span>
          </section>

          <section class="dirbar">
            <input v-model="dirFilter" class="input" type="text" placeholder="按路径筛选…" spellcheck="false" />
            <button type="button" class="btn btn--mini" :disabled="!!dirFilter.trim()" @click="expandAllDirs">全部展开</button>
            <button type="button" class="btn btn--mini" :disabled="!!dirFilter.trim()" @click="collapseAllDirs">全部折叠</button>
          </section>

          <section class="dirlist">
            <DirTree
              verdict
              :tree="dirTree"
              :expanded="dirExpanded"
              :active-rel="verdictRel"
              :filter="dirFilter"
              @toggle="toggleDir"
              @open="onDirRowClickFile"
            />
          </section>

          <!-- 选中文件的判定面板 -->
          <section v-if="verdictRel" class="dirdetail">
            <div class="dirdetail__head">
              <span class="dirdetail__meta">
                原 {{ dirResult.nameL }}/{{ verdictRel }} → 新 {{ dirResult.nameR }}/{{ verdictRel }}
              </span>
              <button type="button" class="btn btn--mini" @click="closeVerdict">关闭</button>
            </div>
            <p v-if="verdictBusy" class="notice">正在计算 SHA-256 …</p>
            <FileVerdict
              v-else-if="verdict"
              :result="verdict"
              :left-name="dirResult.nameL + '/' + verdictRel"
              :right-name="dirResult.nameR + '/' + verdictRel"
            />
          </section>
        </template>
      </div>
    </main>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; overflow-y: auto; }
.header { text-align: center; padding: 14px 16px 2px; }
.header h1 { margin: 0 0 5px; font-size: 21px; }
.header__sub { margin: 0; font-size: 13px; color: var(--c-text-muted); }
.body { width: 100%; display: flex; flex-direction: column; gap: 12px; padding: 4px 22px 28px; flex: 1; min-height: 0; }
@media (max-width: 860px) { .body { padding: 4px 14px 20px; } }
.spacer { flex: 1; }

/* 双面板容器：并排=两列，上下=两行，铺满剩余空间 */
.panes { flex: 1; min-height: 260px; display: grid; gap: 12px; }
.panes--side { grid-template-columns: 1fr 1fr; }
.panes--stack { grid-template-rows: 1fr 1fr; }
@media (max-width: 860px) { .panes--side { grid-template-columns: 1fr; grid-template-rows: none; } }
.pane {
  background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px;
  padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; min-height: 0;
  transition: border-color 0.15s, background 0.15s;
}
.pane--drag, .pane:hover { border-color: var(--c-border); }
.pane__head { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.card__label { border-radius: 6px; padding: 2px 9px; font-size: 12px; font-weight: 700; flex: none; }
.card__label--l { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
.card__label--r { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
.pane__name { font-size: 12px; color: var(--c-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; direction: rtl; text-align: left; }
.btn--mini { padding: 3px 10px; font-size: 12px; flex: none; }
.pane__ta {
  flex: 1; width: 100%; box-sizing: border-box; min-height: 220px; padding: 10px 12px;
  border: 1px solid var(--c-border); border-radius: 10px; background: #fff; color: var(--c-text);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, 'Courier New', monospace;
  font-size: 12.5px; line-height: 1.6; resize: none; tab-size: 4;
}
.pane__ta:focus { outline: 2px solid var(--c-primary); outline-offset: -1px; }
.pane__meta { font-size: 11.5px; color: var(--c-text-muted); }

/* 目录预览 */
.pane__dirlist {
  flex: 1; min-height: 220px; overflow-y: auto; border: 1px dashed var(--c-border); border-radius: 10px; padding: 8px 10px;
}
.dircard__sum { font-size: 12px; font-weight: 600; margin-bottom: 6px; }
.dircard__list {
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11.5px; color: var(--c-text-muted); line-height: 1.8;
}
.dircard__item { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dircard__item--more { color: var(--c-primary); }

/* 工具栏 */
.toolbar {
  position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 2px; margin-bottom: 2px;
  background: rgba(241, 245, 249, 0.94); backdrop-filter: blur(8px); border-bottom: 1px solid var(--c-border);
}
.opt { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; cursor: pointer; user-select: none; white-space: nowrap; }
.opt input { accent-color: var(--c-primary); margin: 0; }
.seg { display: inline-flex; border: 1px solid var(--c-border); border-radius: 8px; overflow: hidden; background: var(--c-surface); flex: none; }
.seg button { border: none; background: transparent; padding: 7px 14px; font-size: 12.5px; cursor: pointer; color: var(--c-text-muted); }
.seg button.on { background: var(--c-primary); color: #fff; }

/* 页签 */
.tabs {
  align-self: center; display: inline-flex; border: 1px solid var(--c-border); border-radius: 10px;
  overflow: hidden; background: var(--c-surface);
}
.tabs button { border: none; background: transparent; padding: 8px 24px; font-size: 13.5px; font-weight: 600; cursor: pointer; color: var(--c-text-muted); }
.tabs button + button { border-left: 1px solid var(--c-border); }
.tabs button.on { background: var(--c-primary); color: #fff; }
/* 页签容器：复制 .body 的纵向布局，保证内部 flex:1 元素正常撑满 */
.tabpane { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; }

/* 统计与提示 */
.statsbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
button.chip { cursor: pointer; font-family: inherit; }
.chip {
  font-size: 12px; padding: 3px 10px; border-radius: 999px; background: var(--c-surface);
  color: var(--c-text-muted); border: 1px solid var(--c-border); white-space: nowrap;
}
.chip--on { border-color: var(--c-primary); color: var(--c-primary); box-shadow: 0 0 0 1px var(--c-primary) inset; }
.chip--add { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
.chip--del { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
.chip--mod, .chip--warn { background: #fffbeb; color: #b45309; border-color: #fde68a; }
.samebox {
  text-align: center; color: #16a34a; font-size: 14px; font-weight: 600;
  background: var(--c-surface); border: 1px solid #bbf7d0; border-radius: 12px; padding: 28px 0; flex: 1;
}
.notice { margin: 0; font-size: 12.5px; color: #16a34a; }
.error { margin: 0; color: var(--c-danger); font-size: 13px; }

.empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; color: var(--c-text-muted); font-size: 13px; line-height: 2.1; padding: 20px 0;
}
.empty p { margin: 0; }
.empty__hint { font-size: 12px; opacity: 0.8; }

/* 目录树（渲染在 DirTree.vue） */
.dirbar { display: flex; align-items: center; gap: 10px; }
.input {
  flex: 1; min-width: 0; max-width: 420px; padding: 6px 10px; border: 1px solid var(--c-border); border-radius: 8px;
  font-size: 12.5px; background: var(--c-surface); color: var(--c-text); font-family: inherit;
}
.input:focus { outline: 2px solid var(--c-primary); outline-offset: -1px; }
.dirlist {
  flex: 1; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 10px;
  overflow: visible; min-height: 160px; padding: 4px 0;
  display: flex; flex-direction: column;
}
.pm-plus { color: #16a34a; font-weight: 600; }
.pm-minus { color: #dc2626; font-weight: 600; }

/* 就地展开的差异 */
.dexpand__meta { font-size: 11.5px; color: var(--c-text-muted); }

/* 文件页：文件信息卡 */
.pane__fileinfo {
  flex: 1; min-height: 220px; border: 1px dashed var(--c-border); border-radius: 10px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 16px;
}
.pane__fileinfo--empty { color: var(--c-text-muted); }
.pane__fileinfo__icon { font-size: 34px; line-height: 1; }
.pane__fileinfo__name { font-size: 14px; font-weight: 600; max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pane__fileinfo__path {
  font-size: 11.5px; color: var(--c-text-muted); font-family: ui-monospace, Menlo, Consolas, monospace;
  max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pane__fileinfo__size { font-size: 12px; color: var(--c-text-muted); }

/* 文件页：目录模式选中文件的判定面板（树在上，面板在下） */
.dirdetail {
  background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 10px;
  padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;
}
.dirdetail__head { display: flex; align-items: center; gap: 10px; }
.dirdetail__meta {
  flex: 1; min-width: 0; font-size: 11.5px; color: var(--c-text-muted);
  font-family: ui-monospace, Menlo, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dirdetail :deep(.fcmp) { padding: 14px 16px; gap: 10px; }
</style>
