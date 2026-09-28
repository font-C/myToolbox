<script setup>
import { ref, computed } from 'vue'

const tab = ref('loan') // loan | date | unit

// ---------- 房贷 ----------
const loanType = ref('commercial') // commercial | fund | combined
const method = ref('both') // both = 两种方式并列展示
const amountC = ref(100) // 商贷金额（万）
const rateC = ref(3.6) // 商贷年利率 %
const amountF = ref(60) // 公积金金额（万）
const rateF = ref(2.85)
const years = ref(30)

function monthlyRate(annualPct) {
  return annualPct / 100 / 12
}
// 等额本息：月供；返回 { monthly, totalInterest, totalPay, schedule: [{year, principal, interest, remain}] }
function equalPayment(principalWan, annualPct, nYears) {
  const P = principalWan * 10000
  const n = nYears * 12
  const i = monthlyRate(annualPct)
  if (P <= 0 || n <= 0) return null
  const monthly = (P * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1)
  let remain = P
  const schedule = []
  let yPrincipal = 0
  let yInterest = 0
  for (let m = 1; m <= n; m++) {
    const interest = remain * i
    const principal = monthly - interest
    remain -= principal
    yPrincipal += principal
    yInterest += interest
    if (m % 12 === 0 || m === n) {
      schedule.push({ year: Math.ceil(m / 12), principal: yPrincipal, interest: yInterest, remain: Math.max(0, remain) })
      yPrincipal = 0
      yInterest = 0
    }
  }
  return { monthly, totalInterest: monthly * n - P, totalPay: monthly * n, schedule, first: monthly, last: monthly }
}
// 等额本金
function equalPrincipal(principalWan, annualPct, nYears) {
  const P = principalWan * 10000
  const n = nYears * 12
  const i = monthlyRate(annualPct)
  if (P <= 0 || n <= 0) return null
  const monthlyPrincipal = P / n
  const first = monthlyPrincipal + P * i
  const last = monthlyPrincipal + monthlyPrincipal * i
  let remain = P
  const schedule = []
  let yPrincipal = 0
  let yInterest = 0
  let yFirst = 0
  let yLast = 0
  for (let m = 1; m <= n; m++) {
    const interest = remain * i
    const principal = monthlyPrincipal
    remain -= principal
    yPrincipal += principal
    yInterest += interest
    if (m % 12 === 1) yFirst = principal + interest
    if (m % 12 === 0 || m === n) {
      yLast = principal + interest
      schedule.push({ year: Math.ceil(m / 12), principal: yPrincipal, interest: yInterest, remain: Math.max(0, remain), first: yFirst, last: yLast })
      yPrincipal = 0
      yInterest = 0
      yFirst = 0
      yLast = 0
    }
  }
  return { monthly: first, first, last, monthlyPrincipal, totalInterest: (n + 1) * P * i / 2, totalPay: P + (n + 1) * P * i / 2, schedule }
}

const wan = (v) => (v / 10000).toFixed(2)

const loanParts = computed(() => {
  const parts = []
  if (loanType.value === 'commercial') parts.push({ name: '商贷', amount: amountC.value, rate: rateC.value })
  else if (loanType.value === 'fund') parts.push({ name: '公积金', amount: amountF.value, rate: rateF.value })
  else {
    parts.push({ name: '商贷', amount: amountC.value, rate: rateC.value })
    parts.push({ name: '公积金', amount: amountF.value, rate: rateF.value })
  }
  return parts
})

const ep = computed(() => {
  // 等额本息（组合贷合并）
  let monthly = 0
  let totalInterest = 0
  let totalPay = 0
  const schedules = []
  for (const p of loanParts.value) {
    const r = equalPayment(p.amount, p.rate, years.value)
    if (!r) return null
    monthly += r.monthly
    totalInterest += r.totalInterest
    totalPay += r.totalPay
    schedules.push(r.schedule)
  }
  return { monthly, totalInterest, totalPay, schedules, name: '等额本息' }
})
const epr = computed(() => {
  // 等额本金（组合贷合并，按各自计划年合计相加）
  let first = 0
  let last = 0
  let monthlyPrincipal = 0
  let totalInterest = 0
  let totalPay = 0
  const schedules = []
  for (const p of loanParts.value) {
    const r = equalPrincipal(p.amount, p.rate, years.value)
    if (!r) return null
    first += r.first
    last += r.last
    monthlyPrincipal += r.monthlyPrincipal
    totalInterest += r.totalInterest
    totalPay += r.totalPay
    schedules.push(r.schedule)
  }
  return { first, last, monthlyPrincipal, monthly: first, totalInterest, totalPay, schedules, name: '等额本金' }
})

const showDetail = ref(false)
const detailRows = computed(() => {
  // 按年合并各 part 的计划
  const rows = []
  if (!ep.value || !epr.value) return rows
  const nYears = Math.ceil(years.value)
  for (let y = 1; y <= nYears; y++) {
    const epRow = ep.value.schedules.reduce((s, sch) => {
      const r = sch.find((x) => x.year === y)
      return r ? { principal: s.principal + r.principal, interest: s.interest + r.interest, remain: s.remain + r.remain } : s
    }, { principal: 0, interest: 0, remain: 0 })
    const eprRow = epr.value.schedules.reduce((s, sch) => {
      const r = sch.find((x) => x.year === y)
      return r ? { first: s.first + r.first, last: s.last + r.last } : s
    }, { first: 0, last: 0 })
    rows.push({ year: y, ...epRow, ...eprRow })
  }
  return rows
})

const money = (v) => v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })

// ---------- 日期 ----------
const birth = ref('1995-06-15')
const dateA = ref('')
const dateB = ref('')
const baseDate = ref('')
const offsetDays = ref(100)

function parseD(s) {
  const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return isNaN(d.getTime()) ? null : d
}
function fmtD(d) {
  const wd = '日一二三四五六'[d.getDay()]
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${wd}`
}

const ageInfo = computed(() => {
  const b = parseD(birth.value)
  if (!b) return null
  const now = new Date()
  let years = now.getFullYear() - b.getFullYear()
  let months = now.getMonth() - b.getMonth()
  let days = now.getDate() - b.getDate()
  if (days < 0) {
    months--
    days += new Date(now.getFullYear(), now.getMonth(), 0).getDate()
  }
  if (months < 0) {
    years--
    months += 12
  }
  const totalDays = Math.floor((now - b) / 86400000)
  return { years, months, days, totalDays }
})

const gapInfo = computed(() => {
  const a = parseD(dateA.value)
  const b = parseD(dateB.value)
  if (!a || !b) return null
  const diff = Math.round((b - a) / 86400000)
  return { days: Math.abs(diff), weeks: (Math.abs(diff) / 7).toFixed(1), from: diff < 0 ? fmtD(b) : fmtD(a), earlier: diff < 0 ? fmtD(a) : fmtD(b) }
})

const offsetInfo = computed(() => {
  const base = parseD(baseDate.value)
  if (!base || !Number.isFinite(offsetDays.value)) return null
  const target = new Date(base.getTime() + offsetDays.value * 86400000)
  return { date: fmtD(target) }
})

// ---------- 单位换算 ----------
const unitCategory = ref('length')
const unitFrom = ref('m')
const unitTo = ref('km')
const unitInput = ref(1)

const UNITS = {
  length: { label: '长度', units: { m: ['米', 1], km: ['千米', 1000], dm: ['分米', 0.1], cm: ['厘米', 0.01], mm: ['毫米', 0.001], li: ['里', 500], chi: ['尺', 1 / 3], cun: ['寸', 1 / 30], in: ['英寸', 0.0254], ft: ['英尺', 0.3048], mi: ['英里', 1609.344], nmi: ['海里', 1852] } },
  weight: { label: '重量', units: { kg: ['千克', 1], g: ['克', 0.001], t: ['吨', 1000], jin: ['斤', 0.5], liang: ['两', 0.05], lb: ['磅', 0.45359237], oz: ['盎司', 0.028349523] } },
  temp: { label: '温度', units: { c: ['摄氏度 ℃', 'c'], f: ['华氏度 ℉', 'f'], k: ['开尔文 K', 'k'] } },
  area: { label: '面积', units: { sqm: ['平方米', 1], sqkm: ['平方公里', 1e6], mu: ['亩', 666.6667], ha: ['公顷', 10000], sqft: ['平方英尺', 0.09290304], ping: ['坪', 3.305785] } },
  volume: { label: '体积', units: { l: ['升', 1], ml: ['毫升', 0.001], cbm: ['立方米', 1000], galus: ['加仑(美)', 3.785412], cft: ['立方英尺', 28.31685] } },
  data: { label: '数据', units: { b: ['字节 B', 1], kb: ['KB', 1024], mb: ['MB', 1024 ** 2], gb: ['GB', 1024 ** 3], tb: ['TB', 1024 ** 4] } },
}

function toBase(cat, unit, v) {
  const def = UNITS[cat].units[unit][1]
  if (cat === 'temp') {
    if (unit === 'c') return v
    if (unit === 'f') return ((v - 32) * 5) / 9
    return v - 273.15
  }
  return v * def
}
function fromBase(cat, unit, base) {
  const def = UNITS[cat].units[unit][1]
  if (cat === 'temp') {
    if (unit === 'c') return base
    if (unit === 'f') return (base * 9) / 5 + 32
    return base + 273.15
  }
  return base / def
}
const unitResult = computed(() => {
  const cat = unitCategory.value
  const v = Number(unitInput.value)
  if (!Number.isFinite(v)) return ''
  const base = toBase(cat, unitFrom.value, v)
  const r = fromBase(cat, unitTo.value, base)
  if (!Number.isFinite(r)) return ''
  return Math.abs(r) >= 1e6 || (Math.abs(r) < 0.001 && r !== 0) ? r.toExponential(6) : Number(r.toPrecision(10)).toLocaleString('zh-CN', { maximumFractionDigits: 8 })
})

function switchCategory(c) {
  unitCategory.value = c
  const keys = Object.keys(UNITS[c].units)
  unitFrom.value = keys[0]
  unitTo.value = keys[1]
}
function swapUnits() {
  const f = unitFrom.value
  unitFrom.value = unitTo.value
  unitTo.value = f
}
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>生活计算</h1>
      <p class="header__sub">房贷 · 日期 · 单位换算 · 纯本地计算</p>
    </header>

    <main class="body">
      <div class="tabs">
        <button type="button" class="tab" :class="{ 'tab--active': tab === 'loan' }" @click="tab = 'loan'">房贷计算</button>
        <button type="button" class="tab" :class="{ 'tab--active': tab === 'date' }" @click="tab = 'date'">日期计算</button>
        <button type="button" class="tab" :class="{ 'tab--active': tab === 'unit' }" @click="tab = 'unit'">单位换算</button>
      </div>

      <!-- 房贷 -->
      <section v-if="tab === 'loan'" class="panel">
        <div class="row">
          <span class="row__label">贷款类型</span>
          <div class="seg">
            <button type="button" class="segbtn" :class="{ 'segbtn--on': loanType === 'commercial' }" @click="loanType = 'commercial'">商业贷款</button>
            <button type="button" class="segbtn" :class="{ 'segbtn--on': loanType === 'fund' }" @click="loanType = 'fund'">公积金</button>
            <button type="button" class="segbtn" :class="{ 'segbtn--on': loanType === 'combined' }" @click="loanType = 'combined'">组合贷款</button>
          </div>
        </div>
        <div class="cards">
          <div v-if="loanType !== 'fund'" class="card">
            <p class="card__title">商业贷款</p>
            <label class="gfield"><span>金额（万元）</span><input v-model.number="amountC" type="number" min="1" class="input" /></label>
            <label class="gfield"><span>年利率（%）</span><input v-model.number="rateC" type="number" step="0.01" class="input" /></label>
          </div>
          <div v-if="loanType !== 'commercial'" class="card">
            <p class="card__title">公积金贷款</p>
            <label class="gfield"><span>金额（万元）</span><input v-model.number="amountF" type="number" min="1" class="input" /></label>
            <label class="gfield"><span>年利率（%）</span><input v-model.number="rateF" type="number" step="0.01" class="input" /></label>
          </div>
          <div class="card">
            <p class="card__title">贷款期限</p>
            <label class="gfield"><span>年限（年）</span>
              <select v-model.number="years" class="input">
                <option v-for="y in [1, 3, 5, 10, 15, 20, 25, 30]" :key="y" :value="y">{{ y }} 年</option>
              </select>
            </label>
          </div>
        </div>

        <div v-if="ep && epr" class="compare">
          <div class="plan">
            <p class="plan__name">等额本息</p>
            <p class="plan__big">{{ money(ep.monthly) }} <span class="plan__unit">元/月</span></p>
            <p class="plan__sub">每月还款固定</p>
            <p class="plan__line">总利息 <b>{{ wan(ep.totalInterest) }} 万</b></p>
            <p class="plan__line">本息合计 {{ wan(ep.totalPay) }} 万</p>
          </div>
          <div class="plan">
            <p class="plan__name">等额本金</p>
            <p class="plan__big">{{ money(epr.first) }} <span class="plan__unit">元/月（首月）</span></p>
            <p class="plan__sub">逐月递减，末月 {{ money(epr.last) }} 元</p>
            <p class="plan__line">总利息 <b>{{ wan(epr.totalInterest) }} 万</b>（少 {{ wan(ep.totalInterest - epr.totalInterest) }} 万）</p>
            <p class="plan__line">本息合计 {{ wan(epr.totalPay) }} 万</p>
          </div>
        </div>

        <details v-if="detailRows.length" class="detail">
          <summary>查看按年还款明细</summary>
          <table class="table">
            <thead>
              <tr><th>年份</th><th>本息·本金</th><th>本息·利息</th><th>本金·首月</th><th>本金·末月</th><th>年末剩余</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in detailRows" :key="r.year">
                <td>第 {{ r.year }} 年</td>
                <td>{{ money(r.principal) }}</td>
                <td>{{ money(r.interest) }}</td>
                <td>{{ money(r.first) }}</td>
                <td>{{ money(r.last) }}</td>
                <td>{{ wan(r.remain) }} 万</td>
              </tr>
            </tbody>
          </table>
        </details>
        <p class="muted">计算结果仅供参考，以贷款银行实际审批为准。</p>
      </section>

      <!-- 日期 -->
      <section v-else-if="tab === 'date'" class="panel">
        <div class="dategrid">
          <div class="card">
            <p class="card__title">年龄计算</p>
            <label class="gfield"><span>出生日期</span><input v-model="birth" type="date" class="input" /></label>
            <div v-if="ageInfo" class="card__result">
              <p class="plan__big">{{ ageInfo.years }}<span class="plan__unit"> 岁</span></p>
              <p class="plan__line">{{ ageInfo.years }} 岁 {{ ageInfo.months }} 个月 {{ ageInfo.days }} 天</p>
              <p class="plan__line">已活 {{ ageInfo.totalDays.toLocaleString() }} 天</p>
            </div>
          </div>
          <div class="card">
            <p class="card__title">日期间隔</p>
            <div class="gfield"><span>开始日期</span><input v-model="dateA" type="date" class="input" /></div>
            <div class="gfield"><span>结束日期</span><input v-model="dateB" type="date" class="input" /></div>
            <div v-if="gapInfo" class="card__result">
              <p class="plan__big">{{ gapInfo.days }}<span class="plan__unit"> 天</span></p>
              <p class="plan__line">约 {{ gapInfo.weeks }} 周</p>
              <p class="plan__line">从 {{ gapInfo.from }} 到 {{ gapInfo.earlier }}</p>
            </div>
          </div>
          <div class="card">
            <p class="card__title">日期加减</p>
            <div class="gfield"><span>基准日期</span><input v-model="baseDate" type="date" class="input" /></div>
            <div class="gfield"><span>天数（可负）</span><input v-model.number="offsetDays" type="number" class="input" /></div>
            <div v-if="offsetInfo" class="card__result">
              <p class="plan__big">{{ offsetDays > 0 ? '+' : '' }}{{ offsetDays }}<span class="plan__unit"> 天后</span></p>
              <p class="plan__line">{{ offsetInfo.date }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 换算 -->
      <section v-else class="panel">
        <div class="seg seg--wrap">
          <button v-for="(v, k) in UNITS" :key="k" type="button" class="segbtn" :class="{ 'segbtn--on': unitCategory === k }" @click="switchCategory(k)">{{ v.label }}</button>
        </div>
        <div class="convert">
          <label class="gfield"><span>从</span>
            <input v-model.number="unitInput" type="number" class="input" />
            <select v-model="unitFrom" class="input">
              <option v-for="(v, k) in UNITS[unitCategory].units" :key="k" :value="k">{{ v[0] }}</option>
            </select>
          </label>
          <button type="button" class="swapbtn" title="互换单位" @click="swapUnits">⇄</button>
          <label class="gfield"><span>到</span>
            <div class="input input--readonly">{{ unitResult }}</div>
            <select v-model="unitTo" class="input">
              <option v-for="(v, k) in UNITS[unitCategory].units" :key="k" :value="k">{{ v[0] }}</option>
            </select>
          </label>
        </div>
        <p class="muted">数据存储按 1KB = 1024B 换算；1 亩 ≈ 666.67 平方米。</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; align-items: center; overflow-y: auto; }
.header { text-align: center; padding: 20px 16px 8px; }
.header h1 { margin: 0 0 6px; font-size: 22px; }
.header__sub { margin: 0; font-size: 13px; color: var(--c-text-muted); }
.body { width: 100%; max-width: 820px; display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 6px 24px 32px; }

.tabs { width: 100%; display: grid; grid-template-columns: 1fr 1fr 1fr; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 4px; gap: 4px; }
.tab { border: none; background: transparent; padding: 10px; font-size: 14px; font-weight: 600; border-radius: 8px; cursor: pointer; color: var(--c-text-muted); }
.tab--active { background: var(--c-primary); color: #fff; }

.panel { width: 100%; display: flex; flex-direction: column; gap: 14px; }
.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.row__label { font-size: 13px; font-weight: 600; min-width: 64px; }
.seg { display: flex; gap: 4px; background: var(--c-bg); border-radius: 8px; padding: 3px; }
.seg--wrap { flex-wrap: wrap; }
.segbtn { border: none; background: transparent; padding: 7px 14px; font-size: 13px; border-radius: 6px; cursor: pointer; color: var(--c-text-muted); }
.segbtn--on { background: var(--c-primary); color: #fff; }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.card { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.card__title { margin: 0; font-size: 14px; font-weight: 700; }
.card__result { display: flex; flex-direction: column; gap: 4px; }
.gfield { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--c-text-muted); }
.gfield span { font-weight: 600; }
.input { padding: 9px 11px; border: 1px solid var(--c-border); border-radius: 8px; font-size: 14px; background: var(--c-bg); color: var(--c-text); font-family: inherit; }
.input:focus { outline: 2px solid var(--c-primary); outline-offset: -1px; }
.input--readonly { background: var(--c-surface); font-weight: 700; color: var(--c-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.plan { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 6px; }
.plan__name { margin: 0; font-size: 13px; font-weight: 700; color: var(--c-text-muted); }
.plan__big { margin: 0; font-size: 28px; font-weight: 800; color: var(--c-primary); }
.plan__unit { font-size: 13px; font-weight: 500; color: var(--c-text-muted); }
.plan__sub { margin: 0; font-size: 12px; color: var(--c-text-muted); }
.plan__line { margin: 0; font-size: 13px; }
.plan__line b { color: var(--c-primary); }

.detail { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 10px 14px; }
.detail summary { cursor: pointer; font-size: 13px; font-weight: 600; }
.table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 8px; }
.table th, .table td { border-bottom: 1px solid var(--c-border); padding: 6px 8px; text-align: right; }
.table th:first-child, .table td:first-child { text-align: left; }
.table th { color: var(--c-text-muted); font-weight: 600; }

.dategrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }

.convert { display: grid; grid-template-columns: 1fr auto 1fr; gap: 14px; align-items: center; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; padding: 16px; }
.swapbtn { border: 1px solid var(--c-border); background: var(--c-surface); border-radius: 50%; width: 42px; height: 42px; font-size: 18px; cursor: pointer; }

.muted { margin: 0; font-size: 12px; color: var(--c-text-muted); }
.error { margin: 0; color: var(--c-danger); font-size: 13px; }
</style>
