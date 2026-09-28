<script setup>
import { ref, computed } from 'vue'
import { usePlannerStore } from '../store.js'

const store = usePlannerStore()
const quality = ref('standard')
const solving = ref(false)

const qualityOptions = [
  { value: 'fast', label: '快速', desc: '少量尝试，适合数据量大的学校' },
  { value: 'standard', label: '标准', desc: '均衡速度与质量' },
  { value: 'fine', label: '精细', desc: '多次尝试与优化，耗时略长' },
]

const ready = computed(() => store.problemErrors.length === 0)

const report = computed(() => store.lastResult)

const unplacedLabels = computed(() => {
  if (!report.value?.unplaced?.length) return []
  return report.value.unplaced.map((u) => {
    const a = store.project.assignments.find((x) => x.id === u.assignmentId)
    const cls = store.project.classes.find((c) => c.id === a?.classId)?.name ?? '?'
    const subj = store.project.subjects.find((s) => s.id === a?.subjectId)?.name ?? '?'
    const t = store.project.teachers.find((t2) => t2.id === a?.teacherId)?.name ?? '?'
    return { id: u.assignmentId, label: `${cls} · ${subj} · ${t}`, reason: u.reason }
  })
})

async function run() {
  solving.value = true
  // 让 spinner 先渲染
  await new Promise((r) => setTimeout(r, 30))
  try {
    store.applySolve(quality.value)
  } finally {
    solving.value = false
  }
}

async function clearSchedule() {
  if (await store.confirm('清空当前课表？基础数据会保留。', { danger: true })) {
    store.clearSchedule()
  }
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <h2 class="page__title">自动排课</h2>
      <p class="page__desc">
        一键生成满足全部硬约束的课表：班级、教师、教室同时段不冲突，教师与班级不可用时段自动避开，
        课时精确排满，连堂课同半天相邻；并按软约束（主科黄金时段、科目分布、教师课量均衡等）优化。
      </p>
    </header>

    <div v-if="!ready" class="alert">
      <div class="alert__title">还不能开始排课，请先完善：</div>
      <ul class="alert__list">
        <li v-for="(e, i) in store.problemErrors" :key="i">{{ e }}</li>
      </ul>
    </div>

    <div class="card">
      <div class="card__title">求解质量</div>
      <div class="quality">
        <label
          v-for="opt in qualityOptions"
          :key="opt.value"
          class="quality__item"
          :class="{ 'quality__item--active': quality === opt.value }"
        >
          <input v-model="quality" type="radio" name="quality" :value="opt.value" />
          <div>
            <div class="quality__name">{{ opt.label }}</div>
            <div class="quality__desc">{{ opt.desc }}</div>
          </div>
        </label>
      </div>

      <div class="run-row">
        <button class="btn btn--primary btn--big" :disabled="!ready || solving" @click="run">
          {{ solving ? '正在求解…' : '⚡ 开始排课' }}
        </button>
        <span v-if="solving" class="spinner spinner--inline"></span>
        <button v-if="store.project.schedule && Object.keys(store.project.schedule).length" class="btn btn--ghost" @click="clearSchedule">
          清空课表
        </button>
      </div>
      <div class="stat-row">
        <span class="stat">任务 {{ store.project.assignments.length }} 项</span>
        <span class="stat">时段 {{ store.project.days.length }}×{{ store.project.periods.length }} = {{ store.nSlots }}</span>
        <span class="stat">班级 {{ store.project.classes.length }} · 教师 {{ store.project.teachers.length }}</span>
      </div>
    </div>

    <div v-if="report" class="card" :class="report.ok ? 'card--ok' : 'card--warn'">
      <div class="card__title">
        {{ report.ok ? '✅ 排课成功' : '⚠ 未全部排完' }}
        <span class="hint">{{ report.message }}</span>
      </div>
      <div class="result-meta">
        <span>方案罚分：{{ report.penalty }}（越低越好）</span>
        <span>完整性检查：{{ store.integrityIssues.length ? store.integrityIssues.length + ' 个问题' : '通过' }}</span>
      </div>
      <div v-if="unplacedLabels.length" class="unplaced">
        <div class="unplaced__title">未排任务（{{ unplacedLabels.length }}）：</div>
        <div v-for="u in unplacedLabels" :key="u.id" class="unplaced__item">
          <span class="unplaced__label">{{ u.label }}</span>
          <span class="unplaced__reason">{{ u.reason }}</span>
        </div>
        <div class="unplaced__tip">可到「课表调整」页把未排任务拖入空位，或调整数据后重新排课。</div>
      </div>
      <div v-else-if="report.ok" class="result-tip">可前往「课表调整」查看与微调，或到「导出打印」导出。</div>
    </div>
  </section>
</template>

<style scoped>
.page { max-width: 820px; padding: 24px 28px 40px; }
.page__head { margin-bottom: 16px; }
.page__title { margin: 0; font-size: 20px; }
.page__desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--c-text-muted);
  line-height: 1.7;
}
.alert {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: var(--radius);
  padding: 14px 16px;
  margin-bottom: 14px;
}
.alert__title { font-size: 13.5px; font-weight: 600; color: #b91c1c; }
.alert__list { margin: 6px 0 0; padding-left: 18px; font-size: 13px; color: #b91c1c; }
.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 14px;
}
.card--ok { border-color: #a7f3d0; }
.card--warn { border-color: #fde68a; }
.card__title { font-size: 14px; font-weight: 600; }
.card__title .hint { font-weight: 400; font-size: 12.5px; color: var(--c-text-muted); margin-left: 6px; }
.quality { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; }
.quality__item {
  display: flex;
  gap: 8px;
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
}
.quality__item--active { border-color: var(--c-primary); background: #eff6ff; }
.quality__name { font-size: 13.5px; font-weight: 600; }
.quality__desc { font-size: 12px; color: var(--c-text-muted); margin-top: 2px; }
.run-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}
.btn--big { padding: 10px 22px; font-size: 14.5px; }
.btn--ghost { border-color: transparent; color: var(--c-text-muted); }
.btn--ghost:hover:not(:disabled) { color: var(--c-danger); border-color: transparent; }
.spinner--inline { width: 20px; height: 20px; border-width: 2.5px; }
.stat-row { display: flex; gap: 14px; margin-top: 14px; }
.stat {
  font-size: 12.5px;
  color: var(--c-text-muted);
  background: var(--c-bg);
  border-radius: 999px;
  padding: 3px 12px;
}
.result-meta {
  display: flex;
  gap: 18px;
  font-size: 12.5px;
  color: var(--c-text-muted);
  margin-top: 8px;
}
.unplaced { margin-top: 12px; }
.unplaced__title { font-size: 13px; font-weight: 600; color: #b45309; }
.unplaced__item {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 13px;
  padding: 5px 0;
  border-bottom: 1px dashed var(--c-border);
}
.unplaced__label { font-weight: 500; }
.unplaced__reason { color: var(--c-text-muted); font-size: 12.5px; }
.unplaced__tip { font-size: 12.5px; color: var(--c-text-muted); margin-top: 8px; }
.result-tip { margin-top: 10px; font-size: 13px; color: var(--c-text-muted); }
</style>
