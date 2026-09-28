<script setup>
import { ref, onMounted, watch } from 'vue'
import { usePlannerStore } from './store.js'
import { openPlanFile, savePlanFile } from './io.js'
import TimeGridSection from './components/TimeGridSection.vue'
import ClassesSection from './components/ClassesSection.vue'
import TeachersSection from './components/TeachersSection.vue'
import SubjectsSection from './components/SubjectsSection.vue'
import SolveSection from './components/SolveSection.vue'
import TimetableSection from './components/TimetableSection.vue'
import ExportSection from './components/ExportSection.vue'

const store = usePlannerStore()
const active = ref('time')
const saving = ref(false)

const sections = [
  { group: '准备', items: [
    { id: 'time', label: '时间结构', icon: '🕐' },
    { id: 'classes', label: '班级', icon: '🏫', count: () => store.project.classes.length },
    { id: 'teachers', label: '教师', icon: '👤', count: () => store.project.teachers.length },
    { id: 'subjects', label: '科目与任务', icon: '📚', count: () => store.project.assignments.length },
  ] },
  { group: '排课', items: [
    { id: 'solve', label: '自动排课', icon: '⚡', alert: () => store.problemErrors.length },
    { id: 'timetable', label: '课表调整', icon: '🗂', alert: () => store.incompleteAssignments.length },
    { id: 'export', label: '导出打印', icon: '📤' },
  ] },
]
const viewMap = Object.fromEntries(sections.flatMap((g) => g.items.map((i) => [i.id, i])))

onMounted(() => store.restoreSession())

watch(
  () => store.project,
  () => store.persist(),
  { deep: false }
)

async function doNew() {
  if (await store.confirm('新建空白方案将清空当前全部数据，确定继续？', { danger: true })) {
    store.newProject()
    active.value = 'time'
  }
}
async function doSample() {
  if (await store.confirm('载入示例数据将替换当前方案，确定继续？')) store.loadSample()
}
async function doOpen() {
  try {
    const r = await openPlanFile()
    if (r.ok) {
      store.replaceProject(r.project)
      store.notify('方案已打开', 'ok')
      active.value = 'timetable'
    }
  } catch (e) {
    store.notify(`打开失败：${e?.message ?? e}`, 'err')
  }
}
async function doSave() {
  saving.value = true
  try {
    const r = await savePlanFile(store.project)
    if (r.ok) store.notify('方案已保存', 'ok')
  } catch (e) {
    store.notify(`保存失败：${e?.message ?? e}`, 'err')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="app">
    <aside class="side">
      <div class="side__brand">
        <div class="side__title">智能排课</div>
        <div class="side__sub">班级 · 教师 · 课表</div>
      </div>
      <nav class="nav">
        <template v-for="group in sections" :key="group.group">
          <div class="nav__group">{{ group.group }}</div>
          <button
            v-for="item in group.items"
            :key="item.id"
            class="nav__item"
            :class="{ 'nav__item--active': active === item.id }"
            @click="active = item.id"
          >
            <span class="nav__icon">{{ item.icon }}</span>
            <span class="nav__label">{{ item.label }}</span>
            <span v-if="item.alert?.()" class="nav__badge nav__badge--warn">{{ item.alert() }}</span>
            <span v-else-if="item.count?.()" class="nav__badge">{{ item.count() }}</span>
          </button>
        </template>
      </nav>
      <div class="side__foot">
        <button class="btn side__btn" @click="doNew">新建</button>
        <button class="btn side__btn" @click="doSample">示例</button>
        <button class="btn side__btn" @click="doOpen">打开</button>
        <button class="btn btn--primary side__btn" :disabled="saving" @click="doSave">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </aside>

    <main class="main">
      <component :is="{
        time: TimeGridSection,
        classes: ClassesSection,
        teachers: TeachersSection,
        subjects: SubjectsSection,
        solve: SolveSection,
        timetable: TimetableSection,
        export: ExportSection,
      }[active]" />
    </main>

    <!-- 轻提示 -->
    <Transition name="toast">
      <div v-if="store.toast" class="toast" :class="`toast--${store.toast.kind}`">
        {{ store.toast.text }}
      </div>
    </Transition>

    <!-- 确认框 -->
    <div v-if="store.confirmBox" class="mask" @click.self="store.resolveConfirm(false)">
      <div class="dialog">
        <div class="dialog__text">{{ store.confirmBox.text }}</div>
        <div class="dialog__actions">
          <button class="btn" @click="store.resolveConfirm(false)">取消</button>
          <button
            class="btn"
            :class="store.confirmBox.danger ? 'btn--danger' : 'btn--primary'"
            @click="store.resolveConfirm(true)"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100%;
  overflow: hidden;
}
.side {
  width: 208px;
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--c-surface);
  border-right: 1px solid var(--c-border);
}
.side__brand {
  padding: 18px 16px 12px;
}
.side__title {
  font-size: 17px;
  font-weight: 700;
}
.side__sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--c-text-muted);
}
.nav {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 8px;
}
.nav__group {
  margin: 10px 8px 4px;
  font-size: 11px;
  color: var(--c-text-muted);
  letter-spacing: 1px;
}
.nav__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-size: 13.5px;
  color: var(--c-text);
  cursor: pointer;
  text-align: left;
}
.nav__item:hover {
  background: var(--c-bg);
}
.nav__item--active {
  background: var(--c-bg);
  color: var(--c-primary);
  font-weight: 600;
}
.nav__icon {
  width: 18px;
  text-align: center;
}
.nav__label {
  flex: 1;
}
.nav__badge {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 9px;
  background: var(--c-bg);
  color: var(--c-text-muted);
  font-size: 11px;
  text-align: center;
}
.nav__badge--warn {
  background: #fef2f2;
  color: var(--c-danger);
}
.side__foot {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--c-border);
}
.main {
  flex: 1;
  overflow: auto;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  max-width: 70%;
  padding: 9px 18px;
  border-radius: 8px;
  background: #0f172a;
  color: #fff;
  font-size: 13px;
  box-shadow: var(--shadow);
  z-index: 60;
}
.toast--ok { background: #059669; }
.toast--warn { background: #d97706; }
.toast--err { background: var(--c-danger); }
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

.mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.dialog {
  width: 340px;
  background: var(--c-surface);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 8px 30px rgba(15, 23, 42, 0.2);
}
.dialog__text {
  font-size: 14px;
  line-height: 1.6;
}
.dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.btn--danger {
  background: var(--c-danger);
  border-color: var(--c-danger);
  color: #fff;
}
.btn--danger:hover:not(:disabled) {
  background: #dc2626;
  color: #fff;
}
</style>
