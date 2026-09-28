/**
 * 拆分范围解析。
 *
 * 自定义范围输入支持分组（每组输出一个 PDF）：
 *   "1-8；1,2,3；1-3,8,9"  →  [[1..8], [1,2,3], [1,3,8,9]]
 * 组分隔符：中文分号；英文分号 ; 换行。组内分隔符：中文逗号，英文逗号 , 顿号 、
 * 组内元素：单页数字或 "a-b" 范围（a 可大于 b，自动交换）。组内重复页自动去重并升序。
 *
 * @param {string} input
 * @param {number} pageCount 总页数（1-based 校验）
 * @returns {number[][]} 每组的页码（1-based、升序、去重）
 * @throws {Error} 语法或页码越界时抛出带位置信息的中文错误
 */
export function parseGroups(input, pageCount) {
  const groups = []
  const rawGroups = String(input || '')
    .split(/[；;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (rawGroups.length === 0) {
    throw new Error('请输入拆分范围，例如：1-8；1,2,3；1-3,8,9')
  }

  rawGroups.forEach((group, gi) => {
    const parts = group.split(/[，,、]+/).map((s) => s.trim()).filter(Boolean)
    if (parts.length === 0) {
      throw new Error(`第 ${gi + 1} 组为空，请检查分隔符`)
    }
    const pages = new Set()
    for (const part of parts) {
      const range = part.match(/^(\d+)\s*[-–—~至到]\s*(\d+)$/)
      if (range) {
        let a = Number(range[1])
        let b = Number(range[2])
        if (a > b) [a, b] = [b, a]
        for (let i = a; i <= b; i++) {
          if (i < 1 || i > pageCount) {
            throw new Error(`第 ${gi + 1} 组「${part}」包含越界页码（文档共 ${pageCount} 页）`)
          }
          pages.add(i)
        }
      } else if (/^\d+$/.test(part)) {
        const n = Number(part)
        if (n < 1 || n > pageCount) {
          throw new Error(`第 ${gi + 1} 组「${part}」超出范围（文档共 ${pageCount} 页）`)
        }
        pages.add(n)
      } else {
        throw new Error(`第 ${gi + 1} 组「${part}」无法识别，应形如 3 或 1-8`)
      }
    }
    if (pages.size === 0) {
      throw new Error(`第 ${gi + 1} 组没有有效页码`)
    }
    groups.push([...pages].sort((a, b) => a - b))
  })

  return groups
}

/** 每 N 页拆分 → 分组（1-based 页码数组）。N 不合法或超出页数时抛错。 */
export function groupsEveryN(n, pageCount) {
  const size = Number(n)
  if (!Number.isInteger(size) || size < 1) {
    throw new Error('每份页数应为正整数')
  }
  const groups = []
  for (let start = 1; start <= pageCount; start += size) {
    const end = Math.min(start + size - 1, pageCount)
    const g = []
    for (let i = start; i <= end; i++) g.push(i)
    groups.push(g)
  }
  return groups
}

/** 逐页拆分 → 分组 */
export function groupsPerPage(pageCount) {
  return groupsEveryN(1, pageCount)
}

/** 生成输出文件名：原名_第k组_1-8.pdf / 原名_1-8页.pdf / 原名_p03.pdf */
export function outputName(baseName, groupIndex, pages, style) {
  const base = baseName.replace(/\.pdf$/i, '')
  const span = pages.length === 1 ? `${pages[0]}` : `${pages[0]}-${pages[pages.length - 1]}`
  if (style === 'everyN') return `${base}_${span}页.pdf`
  if (style === 'perpage') return `${base}_p${String(pages[0]).padStart(2, '0')}.pdf`
  const list = pages.length <= 6 ? pages.join(',') : `${pages[0]}-${pages[pages.length - 1]}`
  return `${base}_组${groupIndex}_${list}.pdf`
}
