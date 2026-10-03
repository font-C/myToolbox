/**
 * 目录对比树：把平铺的文件行（相对路径）组装成目录树，供 DirTree 渲染。
 * 纯函数、无 DOM 依赖，可在 Node 中直接单测。
 *
 * 节点：
 *   目录 { type:'dir', name, rel, children: Node[], stats }
 *   文件 { type:'file', name, rel, row }
 * stats 为目录子树内文件的聚合：{ files, diff, onlyL, onlyR, binary, same, plus, minus }。
 * 目录按「目录在前、名称排序」排列，保证两侧目录结构合并后顺序稳定。
 */

const collator = new Intl.Collator(['zh-Hans-CN', 'en'], { numeric: true, sensitivity: 'base' })

export function baseName(rel) {
  const i = rel.lastIndexOf('/')
  return i === -1 ? rel : rel.slice(i + 1)
}

export function dirPart(rel) {
  const i = rel.lastIndexOf('/')
  return i === -1 ? '' : rel.slice(0, i)
}

/**
 * 平铺行 → 树（根层子节点数组）。
 * @param {{ rel: string, status?: string, plus?: number|null, minus?: number|null }[]} rows
 */
export function buildDirTree(rows) {
  const root = { type: 'dir', name: '', rel: '', children: new Map() }
  for (const row of rows) {
    const segs = row.rel.split('/')
    let node = root
    for (let i = 0; i < segs.length - 1; i++) {
      const rel = segs.slice(0, i + 1).join('/')
      let child = node.children.get(segs[i])
      if (!child || child.type !== 'dir') {
        child = { type: 'dir', name: segs[i], rel, children: new Map() }
        node.children.set(segs[i], child)
      }
      node = child
    }
    const name = segs[segs.length - 1]
    node.children.set(name, { type: 'file', name, rel: row.rel, row })
  }
  return finalizeDir(root).children
}

function finalizeDir(dir) {
  const stats = { files: 0, diff: 0, onlyL: 0, onlyR: 0, binary: 0, same: 0, plus: 0, minus: 0 }
  for (const child of dir.children.values()) {
    if (child.type === 'file') {
      stats.files++
      stats[child.row.status] = (stats[child.row.status] ?? 0) + 1
      if (child.row.plus != null) {
        stats.plus += child.row.plus
        stats.minus += child.row.minus
      }
    } else {
      finalizeDir(child)
      for (const k of Object.keys(stats)) stats[k] += child.stats[k]
    }
  }
  dir.stats = stats
  dir.children = [...dir.children.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return collator.compare(a.name, b.name)
  })
  return dir
}

/** 目录行右侧汇总。verdict=true 按「一致性」口径（文件对比页）：不一致数含二进制 */
export function dirSummary(stats, verdict = false) {
  const parts = []
  if (verdict) {
    const bad = stats.diff + stats.binary
    if (bad) parts.push(`${bad} 不一致`)
  } else {
    if (stats.diff) parts.push(`${stats.diff} 不同`)
    if (stats.binary && !stats.diff) parts.push(`${stats.binary} 二进制`)
  }
  if (stats.onlyL) parts.push(`${stats.onlyL} 仅原`)
  if (stats.onlyR) parts.push(`${stats.onlyR} 仅新`)
  return parts.length ? parts.join(' · ') : verdict ? '全部一致' : '全部相同'
}

/** 目录汇总的着色分类：diff=有差异 / same=全部相同 / 空串=中性 */
export function dirSummaryKind(stats) {
  if (stats.diff) return 'diff'
  if (!stats.onlyL && !stats.onlyR && !stats.binary) return 'same'
  return ''
}

/**
 * 默认展开集合：包含任一「非相同」文件的目录链全部展开，纯相同子树折叠。
 * @returns {Set<string>} 已展开目录的 rel 集合
 */
export function defaultExpanded(tree) {
  const set = new Set()
  const walk = (children) => {
    let interesting = false
    for (const node of children) {
      if (node.type === 'file') {
        if (node.row.status !== 'same') interesting = true
      } else if (walk(node.children)) {
        interesting = true
        set.add(node.rel)
      }
    }
    return interesting
  }
  walk(tree)
  return set
}

/** 收集树中全部目录 rel（全部展开用） */
export function collectDirRels(tree, acc = []) {
  for (const node of tree) {
    if (node.type === 'dir') {
      acc.push(node.rel)
      collectDirRels(node.children, acc)
    }
  }
  return acc
}

/**
 * 按展开集合把树铺平为可见行 [{ node, depth }]。
 * 超出 limit 即停止并标记 truncated（调用方提示筛选）。
 */
export function flattenTree(tree, expanded, limit = 1200) {
  const rows = []
  let truncated = false
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      if (rows.length >= limit) {
        truncated = true
        return
      }
      rows.push({ node, depth })
      if (node.type === 'dir' && expanded.has(node.rel)) {
        walk(node.children, depth + 1)
        if (truncated) return
      }
    }
  }
  walk(tree, 0)
  return { rows, truncated }
}

/**
 * 树中全部文件按路径排序平铺（文本对比页目录模式：不分组，直接列文件）。
 * kw 非空时按路径过滤；超出 limit 截断。
 */
export function flatFiles(tree, { kw = '', limit = 1200 } = {}) {
  const all = []
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type === 'file') all.push(n)
      else walk(n.children)
    }
  }
  walk(tree)
  const k = kw.trim().toLowerCase()
  const matched = k ? all.filter((n) => n.rel.toLowerCase().includes(k)) : all
  matched.sort((a, b) => collator.compare(a.rel, b.rel))
  return { files: matched.slice(0, limit), truncated: matched.length > limit }
}
