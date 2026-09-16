/**
 * 口算题生成工具
 *
 * 支持两种模式：
 *  - 简单模式（mixed = false）:每道题为一个二元运算，如 `3 + 5`、`4 × 6`
 *  - 混合模式（mixed = true）:生成含优先级与括号的复合算式，如 `1 + 3 × 2`、`(9 - 5) ÷ 2`
 *
 * 约束：
 *  - 参与计算的操作数（叶子）落在数字范围 [lo, hi] 内
 *  - 最终结果落在结果范围 [resultMin, resultMax] 内，且恒为非负整数
 *  - 减法保证结果非负；除法保证整除且除数 > 0
 */

const OPS = {
  '+': { sym: '+', prio: 1, apply: (a, b) => a + b },
  '-': { sym: '-', prio: 1, apply: (a, b) => a - b },
  '*': { sym: '×', prio: 2, apply: (a, b) => a * b },
  '/': { sym: '÷', prio: 2, apply: (a, b) => a / b },
}

/** 在 [lo, hi] 内取随机整数（含端点） */
function randInt(lo, hi) {
  if (hi < lo) return lo
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

/** 随机打乱数组（返回新数组） */
function shuffle(list) {
  const arr = list.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function makeLeaf(value) {
  return { isLeaf: true, value }
}

function makeNode(op, left, right) {
  return { isLeaf: false, op, left, right, value: OPS[op].apply(left.value, right.value) }
}

/**
 * 尝试用两个叶子（数字都在 [lo,hi] 内）直接运算得到 target
 * @returns {{op:string,left:Node,right:Node}|null}
 */
function findPair(target, ops, lo, hi) {
  for (const code of shuffle(ops)) {
    let a, b
    if (code === '+') {
      // b = target - a，a ∈ [max(lo, target-hi), min(hi, target-lo)]
      const aLo = Math.max(lo, target - hi)
      const aHi = Math.min(hi, target - lo)
      if (aLo > aHi) continue
      a = randInt(aLo, aHi)
      b = target - a
      if (b < lo || b > hi) continue
    } else if (code === '-') {
      // 差必须为正（至少为 1）
      if (target < 1) continue
      // a - b = target → a = b + target
      const bLo = Math.max(lo, lo - target)
      const bHi = Math.min(hi, hi - target)
      if (bLo > bHi) continue
      b = randInt(bLo, bHi)
      a = b + target
      if (a < lo || a > hi) continue
    } else if (code === '*') {
      // a * b = target，枚举 target 的约数
      const candidates = []
      for (let d = lo; d <= hi; d++) {
        if (d !== 0 && target % d === 0) {
          const other = target / d
          if (other >= lo && other <= hi) candidates.push(d)
        }
      }
      if (!candidates.length) continue
      a = pick(candidates)
      b = target / a
    } else {
      // '/'：a / b = target → a = b * target
      if (target <= 0) continue
      const bLo = Math.max(lo, Math.ceil(lo / target))
      const bHi = Math.min(hi, Math.floor(hi / target))
      if (bLo > bHi) continue
      b = randInt(bLo, bHi)
      a = b * target
      if (a < lo || a > hi) continue
    }
    if (a < lo || a > hi || b < lo || b > hi) continue
    return { op: code, left: makeLeaf(a), right: makeLeaf(b) }
  }
  return null
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

/**
 * 生成一道有余数的整除算式：a ÷ b = q …… r（r ∈ [1, b-1]）。
 * 除数 b、被除数 a 均限制在数字范围 [lo, hi] 内，商 q 落在结果范围 [resultMin, resultMax] 内。
 * @returns {{a:number, b:number, quotient:number, remainder:number}|null}
 */
function findRemainderPair(lo, hi, resultMin, resultMax) {
  const qLo = Math.max(resultMin, 1)
  for (let attempt = 0; attempt < 40; attempt++) {
    const b = randInt(lo, hi)
    if (b < 2) continue // 余数需要除数 ≥ 2
    // 被除数 a = b*q + r ≤ hi，且 r 最小为 1，故 q 上限由 (hi - 1) / b 决定
    const qHi = Math.min(resultMax, Math.floor((hi - 1) / b))
    if (qHi < qLo) continue
    const q = randInt(qLo, qHi)
    const r = randInt(1, b - 1)
    const a = b * q + r
    if (a < lo || a > hi) continue
    return { a, b, quotient: q, remainder: r }
  }
  return null
}

/**
 * 拆分 target：一侧为叶子（值落 [lo,hi]），另一侧结果继续递归
 * @returns {{op:string, leaf:number, rest:number}|null}
 */
function splitOne(target, ops, lo, hi) {
  for (const code of shuffle(ops)) {
    let leaf, rest
    if (code === '+') {
      leaf = randInt(lo, hi) // b
      rest = target - leaf // a = rest
      if (rest < 0) continue
    } else if (code === '-') {
      // 差必须为正（至少为 1）
      if (target < 1) continue
      leaf = randInt(lo, hi) // b
      rest = target + leaf // a
    } else if (code === '*') {
      const factors = []
      for (let d = lo; d <= hi; d++) {
        if (d !== 0 && target % d === 0) factors.push(d)
      }
      if (!factors.length) continue
      leaf = pick(factors)
      rest = target / leaf
    } else {
      if (target <= 0) continue
      leaf = randInt(lo, hi) // 除数 b
      rest = target * leaf // a
    }
    if (leaf < lo || leaf > hi || rest < 0) continue
    return { op: code, leaf, rest }
  }
  return null
}

/**
 * 递归构建结果恰为 target 的复合表达式节点。
 * depth 为剩余可展开层数：depth 越大，操作数越多。
 * strict 为 true 时，有展开空间就必须继续递归生成复合式，不退化为二元式。
 */
function build(target, ops, lo, hi, depth, strict) {
  // 深度用尽：必须收敛为叶子或二元式
  if (depth <= 0) {
    if (target >= lo && target <= hi) return makeLeaf(target)
    const direct = findPair(target, ops, lo, hi)
    if (direct) return makeNode(direct.op, direct.left, direct.right)
    throw new Error('build exhausted')
  }

  // 还有展开空间：优先递归拆分，其余子树走二元式/叶子
  const split = splitOne(target, ops, lo, hi)
  if (split) {
    try {
      const restNode = build(split.rest, ops, lo, hi, depth - 1, strict)
      const leafNode = makeLeaf(split.leaf)
      if (split.op === '+') return makeNode('+', restNode, leafNode)
      if (split.op === '-') return makeNode('-', restNode, leafNode)
      if (split.op === '*') return makeNode('*', restNode, leafNode)
      return makeNode('/', restNode, leafNode)
    } catch {
      if (strict) throw new Error('strict split failed')
    }
  }

  // 严格模式：不允许退化为二元式
  if (strict) throw new Error('no split in strict mode')

  const direct = findPair(target, ops, lo, hi)
  if (direct) return makeNode(direct.op, direct.left, direct.right)

  if (target >= lo && target <= hi) return makeLeaf(target)
  throw new Error('unable to build')
}

/** 将节点渲染为字符串（带必要的括号） */
function toStr(node) {
  if (node.isLeaf) return String(node.value)
  const p = OPS[node.op].prio
  const leftStr = renderChild(node, node.left, p, false)
  const rightStr = renderChild(node, node.right, p, true)
  return `${leftStr} ${OPS[node.op].sym} ${rightStr}`
}

function renderChild(parent, child, parentPrio, isRight) {
  let inner
  if (child.isLeaf) {
    inner = String(child.value)
  } else {
    const childPrio = OPS[child.op].prio
    const rightFlag = isRight && parent.op !== '+' && parent.op !== '*'
    inner = childPrio < parentPrio || (rightFlag && childPrio <= parentPrio)
      ? `(${toStr(child)})`
      : toStr(child)
  }
  return inner
}

/**
 * 生成一道口算题
 * @param {{ops:string[], lo:number, hi:number, resultMin:number, resultMax:number, mixed:boolean, division?:"exact"|"remainder"}} options
 * @returns {{text:string, answer:number|{quotient:number,remainder:number}, kind:"number"|"pair"}|null}
 */
export function generateExpression(options) {
  const { ops, lo, hi, resultMin, resultMax, mixed, division = 'exact' } = options
  const active = ops.length ? ops : ['+']

  // 减法结果必须为正，故有效结果下限至少为 1
  const loResult = Math.max(resultMin, 1)

  // 外部兜底重试：范围配置可能无解，最多尝试若干次
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if (mixed) {
        // 混合运算：从结果范围取目标值，构建复合算式（固定展开 2 层，约 3~4 个操作数）
        const target = randInt(loResult, Math.max(resultMax, loResult))
        const node = build(target, active, lo, hi, 2, true)
        if (node.value < loResult || node.value > resultMax) continue
        return { text: toStr(node), answer: node.value, kind: 'number' }
      }

      // 简单运算：随机选一个运算符
      const op = pick(active)

      // 有余数除法：a ÷ b = q …… r，答案需要填商和余数
      if (op === '/' && division === 'remainder') {
        const r = findRemainderPair(lo, hi, resultMin, resultMax)
        if (!r) continue
        return {
          text: `${r.a} ÷ ${r.b}`,
          answer: { quotient: r.quotient, remainder: r.remainder },
          kind: 'pair',
        }
      }

      // 其余情况：生成二元算式
      const target = randInt(loResult, Math.max(resultMax, loResult))
      const direct = findPair(target, [op], lo, hi)
      if (!direct) continue
      const node = makeNode(op, direct.left, direct.right)
      if (node.value < loResult || node.value > resultMax) continue
      return { text: toStr(node), answer: node.value, kind: 'number' }
    } catch {
      // 重新生成
    }
  }
  return null
}

/** 批量生成，返回 null-safe 的题目数组（跳过失败项） */
export function generatePapers(options, count) {
  const papers = []
  for (let i = 0; i < count; i++) {
    const item = generateExpression(options)
    if (item) papers.push(item)
  }
  return papers
}