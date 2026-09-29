<script setup>
import { usePlannerStore } from '../store.js'
import { DEFAULT_RULES } from '../solver/model.js'

const store = usePlannerStore()

const rules = [
  { key: 'majorGold', label: '主科优先上午1-3节 / 下午1-2节', desc: '主科尽量落在上午第1-3节与下午第1-2节，避开下午末节与晚上' },
  { key: 'minorPm', label: '副科避开黄金时段（其余课时）', desc: '副科尽量不占用主科黄金时段' },
  { key: 'minorEve', label: '晚上少排副科', desc: '副科尽量避免安排到晚上' },
  { key: 'essayPm', label: '作文连堂优先周三至周五下午', desc: '科目名含「作文」的连堂课优先排在周三至周五的下午第1-2节' },
  { key: 'peAvoid', label: '体育避开午间饭点', desc: '体育不排在上午末节或下午首节，避免挤占黄金时段' },
  { key: 'pePmOnly', label: '体育只排在下午', desc: '体育不排早晨、上午与晚上，只安排在下午时段；自动排课与手动调课均生效' },
  { key: 'skipDawn', label: '早晨不自动排课', desc: '存在早晨节次时，自动排课跳过早晨时段（留作早读/晨会）；手动调课不受限' },
]

const isOn = (key) => (store.project.rules ?? DEFAULT_RULES)[key]
function toggle(key) {
  store.toggleRule(key)
  store.notify('已更新规则，重新「开始排课」后生效', 'info')
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <h2 class="page__title">排课规则</h2>
      <p class="page__desc">
        勾选自动排课启用的规则。「体育只排在下午」「早晨不自动排课」「作文连堂优先」开启时按硬约束执行（排不下会明确报告）；
        其余规则影响课表质量，不影响合法性。修改后请重新「开始排课」。
      </p>
    </header>

    <div class="card">
      <div class="card__toolbar">
        <div class="card__title">软约束优化</div>
      </div>
      <div class="rule-list">
        <label v-for="r in rules" :key="r.key" class="rule">
          <input type="checkbox" class="rule__checkbox" :checked="isOn(r.key)" @change="toggle(r.key)" />
          <span class="rule__body">
            <span class="rule__label">{{ r.label }}</span>
            <span class="rule__desc">{{ r.desc }}</span>
          </span>
        </label>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { max-width: 720px; padding: 24px 28px 40px; }
.page__head { margin-bottom: 16px; }
.page__title { margin: 0; font-size: 20px; }
.page__desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--c-text-muted);
  line-height: 1.6;
}
.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  padding: 16px;
}
.card__toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.card__title { font-size: 14px; font-weight: 600; }
.rule-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}
.rule {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  cursor: pointer;
  background: var(--c-bg);
}
.rule__checkbox {
  margin-top: 2px;
  width: 16px;
  height: 16px;
  accent-color: var(--c-primary);
  cursor: pointer;
}
.rule__body { display: flex; flex-direction: column; gap: 2px; }
.rule__label { font-size: 14px; font-weight: 600; }
.rule__desc { font-size: 12.5px; color: var(--c-text-muted); }
</style>