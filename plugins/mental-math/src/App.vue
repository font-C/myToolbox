<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { toolbox } from '@toolbox/plugin-sdk'
import { generatePapers, validateOptions } from './mentalMath.js'
import WorksheetTab from './WorksheetTab.vue'

// —— 顶部模式：practice 互动练习 | sheet 题卡打印 ——
const mode = ref('practice')

// —— 配置状态 ——
const showConfig = ref(true)
const fetched = ref(false)

const config = reactive({
  ops: ['+', '-', '*', '/'],
  lo: 1,
  hi: 20,
  resultMin: 1,
  resultMax: 100,
  count: 10,
  mixed: false,
  division: 'exact', // 'exact' 整除 | 'remainder' 有余数
})

// —— 配置持久化（宿主 storage）：重启后保留 ——
const CONFIG_KEY = 'practiceConfig'
let configHydrated = false
const OPS = ['+', '-', '*', '/']

onMounted(async () => {
  try {
    const saved = await toolbox.storageGet(CONFIG_KEY)
    if (saved && typeof saved === 'object') {
      if (Array.isArray(saved.ops) && saved.ops.length) {
        config.ops = saved.ops.filter((o) => OPS.includes(o))
      }
      for (const k of ['lo', 'hi', 'resultMin', 'resultMax', 'count']) {
        if (Number.isFinite(saved[k]) && saved[k] > 0) config[k] = saved[k]
      }
      if (typeof saved.mixed === 'boolean') config.mixed = saved.mixed
      if (saved.division === 'exact' || saved.division === 'remainder') config.division = saved.division
    }
  } catch {}
  configHydrated = true
})
watch(config, () => {
  if (!configHydrated) return
  toolbox.storageSet(CONFIG_KEY, { ...config, ops: [...config.ops] }).catch(() => {})
})

const OP_LABELS = {
  '+': '加法',
  '-': '减法',
  '*': '乘法',
  '/': '除法',
}

const hasDivision = computed(() => config.ops.includes('/'))

// —— 答题状态 ——
const papers = ref([])
const currentIndex = ref(0)
const answer = ref('')
const answerRem = ref('')
const state = ref('idle') // idle | correct | wrong
const lastAnswer = ref(null)
const correctCount = ref(0)

const current = computed(() => papers.value[currentIndex.value])
const progress = computed(() => currentIndex.value + 1)
const isLast = computed(() => currentIndex.value >= papers.value.length - 1)
const done = computed(() => papers.value.length > 0 && currentIndex.value >= papers.value.length)
const isPair = computed(() => current.value?.kind === 'pair')

// 答对后自动跳转定时器（2 秒）
const autoTimer = ref(null)

/** 答对：更新状态并安排 2 秒后自动进入下一题 */
function markCorrect() {
  state.value = 'correct'
  correctCount.value++
  lastAnswer.value = null
  clearTimeout(autoTimer.value)
  autoTimer.value = setTimeout(() => {
    autoTimer.value = null
    next()
  }, 1000)
}

function clearAutoTimer() {
  clearTimeout(autoTimer.value)
  autoTimer.value = null
}

/** 聚焦当前答案输入框（等新题渲染完成后再聚焦） */
function focusAnswer() {
  nextTick(() => {
    const field = document.querySelector('.play__answer input:not([disabled])')
    field?.focus()
  })
}

onBeforeUnmount(clearAutoTimer)

function toggleOp(code) {
  const i = config.ops.indexOf(code)
  if (i >= 0) config.ops.splice(i, 1)
  else config.ops.push(code)
}

function validateConfig() {
  const err = validateOptions(config)
  if (err) {
    alert(err)
    return false
  }
  return true
}

function gen() {
  if (!validateConfig()) return
  const opts = {
    ops: config.ops.slice(),
    lo: config.lo,
    hi: config.hi,
    resultMin: config.resultMin,
    resultMax: config.resultMax,
    mixed: config.mixed,
    division: config.division,
  }
  const items = generatePapers(opts, config.count)
  if (!items.length) {
    alert('当前范围配置下无法生成题目，请调整数字范围或结果范围后重试。')
    return
  }
  papers.value = items
  currentIndex.value = 0
  correctCount.value = 0
  answer.value = ''
  answerRem.value = ''
  state.value = 'idle'
  fetched.value = true
  showConfig.value = false
  focusAnswer()
}

function answerText(answer) {
  if (answer && typeof answer === 'object') {
    return `${answer.quotient} 余 ${answer.remainder}`
  }
  return String(answer)
}

function submit() {
  if (state.value !== 'idle') return
  if (isPair.value) {
    const q = Number(String(answer.value ?? '').trim())
    const r = Number(String(answerRem.value ?? '').trim())
    if (!Number.isInteger(q) || !Number.isInteger(r)) {
      alert('请输入整数商和余数。')
      return
    }
    const { quotient, remainder } = current.value.answer
    if (q === quotient && r === remainder) {
      markCorrect()
    } else {
      state.value = 'wrong'
      lastAnswer.value = answerText(current.value.answer)
    }
    return
  }

  const val = Number(String(answer.value ?? '').trim())
  if (!Number.isInteger(val)) {
    alert('请输入整数答案。')
    return
  }
  if (val === current.value.answer) {
    markCorrect()
  } else {
    state.value = 'wrong'
    lastAnswer.value = current.value.answer
  }
}

function next() {
  clearAutoTimer()
  answer.value = ''
  answerRem.value = ''
  state.value = 'idle'
  currentIndex.value++
  focusAnswer()
}

function toConfig() {
  clearAutoTimer()
  fetched.value = false
  papers.value = []
  showConfig.value = true
}
</script>

<template>
  <div class="math">
    <nav class="mode-tabs">
      <button
        type="button"
        class="mode-tab"
        :class="{ 'mode-tab--on': mode === 'practice' }"
        @click="mode = 'practice'"
      >
        口算练习
      </button>
      <button
        type="button"
        class="mode-tab"
        :class="{ 'mode-tab--on': mode === 'sheet' }"
        @click="mode = 'sheet'"
      >
        题卡打印
      </button>
    </nav>

    <!-- 口算练习（互动答题） -->
    <template v-if="mode === 'practice'">
    <!-- 配置区 -->
    <section v-if="showConfig || !fetched" class="panel config">
      <h2 class="config__title">口算练习配置</h2>

      <div class="config__group">
        <span class="config__label">运算类型（可多选）</span>
        <div class="config__ops">
          <label
            v-for="(label, code) in OP_LABELS"
            :key="code"
            class="config__op"
            :class="{ 'config__op--on': config.ops.includes(code) }"
          >
            <input
              type="checkbox"
              :checked="config.ops.includes(code)"
              @change="toggleOp(code)"
            />
            {{ label }}
          </label>
        </div>
      </div>

      <div class="config__group">
        <span class="config__label">待计算的数字范围</span>
        <div class="config__range">
          <input v-model.number="config.lo" type="number" class="input" />
          <span>至</span>
          <input v-model.number="config.hi" type="number" class="input" />
        </div>
      </div>

      <div class="config__group">
        <span class="config__label">结果的范围</span>
        <div class="config__range">
          <input v-model.number="config.resultMin" type="number" class="input" />
          <span>至</span>
          <input v-model.number="config.resultMax" type="number" class="input" />
        </div>
      </div>

      <div class="config__group">
        <span class="config__label">题目数量</span>
        <input v-model.number="config.count" type="number" class="input input--sm" min="1" max="99" />
      </div>

      <div class="config__group">
        <span class="config__label">除法结果</span>
        <div class="config__ops">
          <label
            class="config__op"
            :class="{ 'config__op--on': config.division === 'exact' }"
            :style="{ opacity: !hasDivision ? 0.5 : 1 }"
          >
            <input
              type="radio"
              value="exact"
              v-model="config.division"
              :disabled="!hasDivision"
            />
            整除
          </label>
          <label
            class="config__op"
            :class="{ 'config__op--on': config.division === 'remainder' }"
            :style="{ opacity: !hasDivision ? 0.5 : 1 }"
          >
            <input
              type="radio"
              value="remainder"
              v-model="config.division"
              :disabled="!hasDivision"
            />
            有余数（填商和余数）
          </label>
        </div>
      </div>

      <label class="config__switch">
        <input v-model="config.mixed" type="checkbox" />
        <span class="config__switch__text">混合运算（如 1 + 3 × 2、（9 − 5）÷ 2）</span>
      </label>

      <button type="button" class="btn btn--primary config__submit" @click="gen">
        开始练习
      </button>
    </section>

    <!-- 答题区 -->
    <section v-else class="play">
      <div class="play__top">
        <span class="play__progress">
          第 {{ progress }} / {{ papers.length }} 题
        </span>
        <span class="play__score">答对 {{ correctCount }} 题</span>
        <button type="button" class="btn play__setting" @click="toConfig">⚙ 设置</button>
      </div>

      <!-- 全部完成 -->
      <div v-if="done" class="panel play__done">
        <div class="play__done-emoji" v-text="correctCount === papers.length ? '🎉' : '✅'" />
        <h3 class="play__done-title">练习完成</h3>
        <p class="play__done-text">
          共 {{ papers.length }} 题，答对 {{ correctCount }} 题
        </p>
        <p v-if="correctCount === papers.length" class="play__done-praise">全对，太棒了！</p>
        <button type="button" class="btn btn--primary" @click="gen">再来一组</button>
        <button type="button" class="btn" @click="toConfig">调整设置</button>
      </div>

      <!-- 答题中 -->
      <template v-else>
        <div class="panel play__card">
          <div class="play__question">{{ current.text }} = ?</div>
          <form class="play__answer" @submit.prevent="submit">
            <div class="play__answer-field">
              <input
                v-if="!isPair"
                v-model="answer"
                type="number"
                class="input play__answer-input"
                placeholder="输入答案，回车提交"
                :disabled="state !== 'idle'"
                @keydown.enter="submit"
              />
              <template v-else>
                <span class="play__answer-tag">商</span>
                <input
                  v-model="answer"
                  type="number"
                  class="input play__answer-input"
                  placeholder="商"
                  :disabled="state !== 'idle'"
                  @keydown.enter="submit"
                />
                <span class="play__answer-tag">余</span>
                <input
                  v-model="answerRem"
                  type="number"
                  class="input play__answer-input"
                  placeholder="余数"
                  :disabled="state !== 'idle'"
                  @keydown.enter="submit"
                />
              </template>
            </div>
            <button
              type="submit"
              class="btn btn--primary"
              :disabled="state !== 'idle'"
            >
              提交
            </button>
          </form>

          <div v-if="state === 'correct'" class="play__feedback play__feedback--ok">
            ✔ 回答正确，即将进入下一题…
          </div>
          <div v-else-if="state === 'wrong'" class="play__feedback play__feedback--no">
            ✖ 回答错误，正确答案是 {{ lastAnswer }}
          </div>

          <button
            v-if="state !== 'idle'"
            type="button"
            class="btn btn--primary play__next"
            @click="next"
          >
            {{ isLast ? '查看结果' : '下一题' }}
          </button>
        </div>
      </template>
    </section>
    </template>

    <!-- 口算题卡（生成 + A4 打印） -->
    <WorksheetTab v-else />
  </div>
</template>

<style scoped>
.math {
  height: 100%;
  overflow: auto;
  /* 顶部不留 padding：预览工具栏吸顶时上方不会漏出滚动内容 */
  padding: 0 24px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.mode-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 999px;
  box-shadow: var(--shadow);
  margin: 24px 0 18px;
}
.mode-tab {
  padding: 7px 22px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--c-text-muted);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.mode-tab:hover {
  color: var(--c-text);
}
.mode-tab--on {
  background: var(--c-primary);
  color: #fff;
  font-weight: 600;
}
.mode-tab--on:hover {
  color: #fff;
}
.config,
.play {
  width: 100%;
  max-width: 560px;
  margin-top: 24px;
}

/* 答题 */
.play {
  display: flex;
  flex-direction: column;
}
.play__top {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}
.play__progress,
.play__score {
  font-size: 14px;
  color: var(--c-text-muted);
}
.play__setting {
  margin-left: auto;
  padding: 6px 12px;
  font-size: 13px;
}
.play__card {
  padding: 32px;
  text-align: center;
}
.play__question {
  font-size: 34px;
  font-weight: 700;
  margin-bottom: 24px;
  min-height: 44px;
}
.play__answer {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-bottom: 16px;
}
.play__answer-input {
  width: 140px;
  font-size: 20px;
  text-align: center;
}
.play__answer-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.play__answer-tag {
  font-size: 14px;
  color: var(--c-text-muted);
  font-weight: 600;
}
.play__feedback {
  margin: 8px 0 16px;
  font-size: 16px;
  font-weight: 600;
}
.play__feedback--ok {
  color: #16a34a;
}
.play__feedback--no {
  color: var(--c-danger);
}
.play__done {
  padding: 40px;
  text-align: center;
}
.play__done-emoji {
  font-size: 48px;
}
.play__done-title {
  margin: 8px 0 4px;
  font-size: 22px;
}
.play__done-text {
  margin: 0 0 4px;
  color: var(--c-text-muted);
}
.play__done-praise {
  margin: 0 0 20px;
  color: var(--c-primary);
  font-weight: 600;
}
.play__done .btn {
  margin: 6px 6px 0;
}
</style>