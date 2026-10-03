/**
 * file-diff 对比内核：行级 diff（jsdiff diffArrays）→ 区域模型 → 视图行构建
 * （并排 / 上下，含相同区域折叠）→ 统一格式补丁导出。
 *
 * 纯函数、无 DOM 依赖，可在 Node 中直接单测。
 * 「区域（region）」是对比的基本产物：
 *   - { type:'equal',  oldStart, newStart, count }               连续相同的行
 *   - { type:'change', oldStart, newStart, oldLines[], newLines[] } 一处变更（删/增交错合并）
 * 区域内下标均为 0 基；行号展示时 +1。
 */
import { diffArrays, diffChars, diffWordsWithSpace } from 'diff'

const NO_NL = '\\ No newline at end of file'

/** 行内高亮的长度上限：单行对超过此总长就只做整行着色（防 O(n²) 卡顿） */
const INLINE_LIMIT = 600
const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u3000-\u303f\u3040-\u30ff]/

/**
 * 按行切分文本（兼容 \r\n / \r / \n）。
 * @returns {{ lines: string[], noEol: boolean }} noEol：文件末尾没有换行符
 */
export function splitLines(text) {
  if (text === '') return { lines: [], noEol: false }
  const noEol = !/(\r\n|\r|\n)$/.test(text)
  const lines = text.split(/\r\n|\r|\n/)
  if (!noEol) lines.pop() // 结尾换行产生的空串不是一行
  return { lines, noEol }
}

/** 规范化单行（只影响对比相等性，不改变显示内容） */
function normalizeLine(line, { ignoreWhitespace, ignoreCase }) {
  let s = line
  if (ignoreWhitespace) s = s.replace(/\s+/g, ' ').trim()
  if (ignoreCase) s = s.toLowerCase()
  return s
}

/**
 * 计算行级差异。
 * @param {string[]} oldLines 原侧行数组（显示用原文）
 * @param {string[]} newLines 新侧行数组
 * @param {{ ignoreWhitespace?: boolean, ignoreCase?: boolean, oldNoEol?: boolean, newNoEol?: boolean }} opts
 * @returns {{ regions: object[], stats: object, oldLines: string[], newLines: string[], oldNoEol: boolean, newNoEol: boolean }}
 * 回传行数组与结尾换行标记，视图构建 / 补丁导出直接消费同一对象。
 * 「modified」按并排行对计：删后紧跟增的行视为修改；added/removed 只统计纯增/纯删。
 */
export function diffRegions(oldLines, newLines, opts = {}) {
  const { oldNoEol = false, newNoEol = false } = opts
  const a = oldLines.map((l) => normalizeLine(l, opts))
  const b = newLines.map((l) => normalizeLine(l, opts))
  // 两侧「末尾有无换行符」不同：视为最后一行内容不同（与 git 对无结尾换行的处理一致）
  if (oldNoEol !== newNoEol) {
    if (!oldNoEol && a.length) a[a.length - 1] += '\u0000'
    if (!newNoEol && b.length) b[b.length - 1] += '\u0000'
  }

  const parts = diffArrays(a, b)
  const regions = []
  let oi = 0
  let ni = 0
  let i = 0
  while (i < parts.length) {
    const p = parts[i]
    if (p.added || p.removed) {
      const region = { type: 'change', oldStart: oi, newStart: ni, oldLines: [], newLines: [] }
      while (i < parts.length && (parts[i].added || parts[i].removed)) {
        const q = parts[i]
        const dst = q.removed ? region.oldLines : region.newLines
        for (const line of q.value) dst.push(line)
        if (q.removed) oi += q.count
        else ni += q.count
        i++
      }
      regions.push(region)
    } else {
      regions.push({ type: 'equal', oldStart: oi, newStart: ni, count: p.count })
      oi += p.count
      ni += p.count
      i++
    }
  }

  const stats = { added: 0, removed: 0, modified: 0, unchanged: 0, hunks: 0 }
  for (const r of regions) {
    if (r.type === 'equal') {
      stats.unchanged += r.count
    } else {
      stats.hunks++
      const pairs = Math.min(r.oldLines.length, r.newLines.length)
      stats.modified += pairs
      stats.removed += r.oldLines.length - pairs
      stats.added += r.newLines.length - pairs
    }
  }
  return { regions, stats, oldLines, newLines, oldNoEol, newNoEol }
}

/**
 * 行内（词/字级）差异片段。返回 [leftSegs, rightSegs]，每项为 [{t, chg}]；
 * 行过长或无行内差异时返回 null（调用方退化为整行着色）。
 */
function inlineSegs(oldText, newText) {
  if (!oldText || !newText || oldText === newText) return null
  if (oldText.length + newText.length > INLINE_LIMIT) return null
  const useChars = CJK_RE.test(oldText) || CJK_RE.test(newText)
  const parts = useChars ? diffChars(oldText, newText) : diffWordsWithSpace(oldText, newText)
  const left = []
  const right = []
  for (const p of parts) {
    if (p.added) right.push({ t: p.value, chg: true })
    else if (p.removed) left.push({ t: p.value, chg: true })
    else {
      left.push({ t: p.value, chg: false })
      right.push({ t: p.value, chg: false })
    }
  }
  return [left, right]
}

/**
 * 相同区域的可见切片（折叠逻辑两种视图共用）。
 * 头部相同区只露尾部 context 行，尾部相同区只露头部 context 行，
 * 中间相同区两头各露 context 行，其余输出折叠段。
 * @param {object} r equal region
 * @param {(from: number, to: number) => void} onVisible
 * @param {(from: number, to: number) => void} onGap
 */
function walkEqual(r, idx, total, context, collapse, onVisible, onGap) {
  if (!collapse) {
    onVisible(0, r.count)
    return
  }
  const isFirst = idx === 0
  const isLast = idx === total - 1
  if (isFirst && isLast) {
    onVisible(0, r.count) // 全部相同（无任何变更）——由 UI 特判提示
    return
  }
  if (isFirst) {
    const tail = Math.min(context, r.count)
    const hidden = r.count - tail
    if (hidden > 0) onGap(0, hidden)
    onVisible(r.count - tail, r.count)
  } else if (isLast) {
    const head = Math.min(context, r.count)
    onVisible(0, head)
    if (r.count > head) onGap(head, r.count)
  } else if (r.count <= context * 2) {
    onVisible(0, r.count)
  } else {
    onVisible(0, context)
    onGap(context, r.count - context)
    onVisible(r.count - context, r.count)
  }
}

/** 并排视图行：{ kind:'equal'|'mod'|'del'|'add', ln, rn, segsL?, segsR? } 或 { kind:'gap', id, count, rows } */
export function buildSideRows(diff, { context = 3, collapse = true } = {}) {
  const { regions, oldLines, newLines } = diff
  const rows = []
  const pushEqual = (r, from, to) => {
    for (let i = from; i < to; i++) {
      rows.push({
        kind: 'equal',
        ln: { n: r.oldStart + i + 1, text: oldLines[r.oldStart + i] },
        rn: { n: r.newStart + i + 1, text: newLines[r.newStart + i] },
      })
    }
  }
  const pushGap = (id, r, from, to) => {
    const hidden = []
    for (let i = from; i < to; i++) {
      hidden.push({
        kind: 'equal',
        ln: { n: r.oldStart + i + 1, text: oldLines[r.oldStart + i] },
        rn: { n: r.newStart + i + 1, text: newLines[r.newStart + i] },
      })
    }
    rows.push({ kind: 'gap', id, count: to - from, rows: hidden })
  }
  regions.forEach((r, idx) => {
    if (r.type === 'equal') {
      walkEqual(r, idx, regions.length, context, collapse, (f, t) => pushEqual(r, f, t), (f, t) => pushGap(`s${idx}`, r, f, t))
      return
    }
    const max = Math.max(r.oldLines.length, r.newLines.length)
    for (let k = 0; k < max; k++) {
      const lo = k < r.oldLines.length ? { n: r.oldStart + k + 1, text: oldLines[r.oldStart + k] } : null
      const ro = k < r.newLines.length ? { n: r.newStart + k + 1, text: newLines[r.newStart + k] } : null
      const row = { kind: lo && ro ? 'mod' : lo ? 'del' : 'add', ln: lo, rn: ro }
      if (lo && ro) {
        const segs = inlineSegs(lo.text, ro.text)
        if (segs) {
          row.segsL = segs[0]
          row.segsR = segs[1]
        }
      }
      rows.push(row)
    }
  })
  return rows
}

/** 上下（统一）视图行：{ kind:'ctx'|'del'|'add', on?, nn?, text, segs? } 或 { kind:'gap', id, count, rows } */
export function buildUnifiedRows(diff, { context = 3, collapse = true } = {}) {
  const { regions, oldLines, newLines } = diff
  const rows = []
  const pushEqual = (r, from, to) => {
    for (let i = from; i < to; i++) {
      rows.push({ kind: 'ctx', on: r.oldStart + i + 1, nn: r.newStart + i + 1, text: oldLines[r.oldStart + i] })
    }
  }
  const pushGap = (id, r, from, to) => {
    const hidden = []
    for (let i = from; i < to; i++) {
      hidden.push({ kind: 'ctx', on: r.oldStart + i + 1, nn: r.newStart + i + 1, text: oldLines[r.oldStart + i] })
    }
    rows.push({ kind: 'gap', id, count: to - from, rows: hidden })
  }
  regions.forEach((r, idx) => {
    if (r.type === 'equal') {
      walkEqual(r, idx, regions.length, context, collapse, (f, t) => pushEqual(r, f, t), (f, t) => pushGap(`u${idx}`, r, f, t))
      return
    }
    const pairs = Math.min(r.oldLines.length, r.newLines.length)
    r.oldLines.forEach((_, k) => {
      const row = { kind: 'del', on: r.oldStart + k + 1, text: oldLines[r.oldStart + k] }
      if (k < pairs) {
        const segs = inlineSegs(row.text, newLines[r.newStart + k])
        if (segs) row.segs = segs[0]
      }
      rows.push(row)
    })
    r.newLines.forEach((_, k) => {
      const row = { kind: 'add', nn: r.newStart + k + 1, text: newLines[r.newStart + k] }
      if (k < pairs) {
        const segs = inlineSegs(oldLines[r.oldStart + k], row.text)
        if (segs) row.segs = segs[1]
      }
      rows.push(row)
    })
  })
  return rows
}

/**
 * 生成统一格式补丁（unified diff，可直接 `git apply`）。无差异时返回 ''。
 * @param {object} diff diffRegions 的返回值，另需携带 oldLines/newLines/oldNoEol/newNoEol
 */
export function toUnifiedDiff(diff, { context = 3, oldName = 'a', newName = 'b' } = {}) {
  const { regions, oldLines, newLines, oldNoEol, newNoEol } = diff
  const changes = regions.filter((r) => r.type === 'change')
  if (!changes.length) return ''

  // 变更范围外扩 context 行并合并重叠 → hunk 列表
  const hunks = []
  for (const r of changes) {
    const lo0 = Math.max(0, r.oldStart - context)
    const lo1 = Math.min(oldLines.length, r.oldStart + r.oldLines.length + context)
    const rn0 = Math.max(0, r.newStart - context)
    const rn1 = Math.min(newLines.length, r.newStart + r.newLines.length + context)
    const last = hunks[hunks.length - 1]
    if (last && lo0 <= last.lo1) {
      last.lo1 = Math.max(last.lo1, lo1)
      last.rn1 = Math.max(last.rn1, rn1)
    } else {
      hunks.push({ lo0, lo1, rn0, rn1 })
    }
  }

  const out = [`--- a/${oldName}`, `+++ b/${newName}`]
  for (const h of hunks) {
    const oc = h.lo1 - h.lo0
    const nc = h.rn1 - h.rn0
    // 纯插入（旧行数 0）时 git 约定显示插入点下标（文件开头为 0）
    const oHead = oc ? h.lo0 + 1 : h.lo0
    const nHead = nc ? h.rn0 + 1 : h.rn0
    out.push(`@@ -${oHead},${oc} +${nHead},${nc} @@`)
    for (const r of regions) {
      if (r.type === 'equal') {
        const s = Math.max(h.lo0, r.oldStart)
        const e = Math.min(h.lo1, r.oldStart + r.count)
        for (let i = s; i < e; i++) {
          out.push(' ' + oldLines[i])
          if (i === oldLines.length - 1 && oldNoEol && newNoEol) out.push(NO_NL)
        }
      } else {
        const s = Math.max(h.lo0, r.oldStart)
        const e = Math.min(h.lo1, r.oldStart + r.oldLines.length)
        for (let i = s; i < e; i++) {
          out.push('-' + oldLines[i])
          if (i === oldLines.length - 1 && oldNoEol) out.push(NO_NL)
        }
        const s2 = Math.max(h.rn0, r.newStart)
        const e2 = Math.min(h.rn1, r.newStart + r.newLines.length)
        for (let i = s2; i < e2; i++) {
          out.push('+' + newLines[i])
          if (i === newLines.length - 1 && newNoEol) out.push(NO_NL)
        }
      }
    }
  }
  return out.join('\n') + '\n'
}
