<script setup>
import { ref } from 'vue'
import * as XLSX from 'xlsx'
import { usePlannerStore } from '../store.js'
import { exportXlsx, exportCsv, buildWorkbook, buildMasterCsv } from '../io.js'

const store = usePlannerStore()
const busy = ref(false)
const browserMode = !('__TAURI_INTERNALS__' in window)

function download(name, bytes, mime) {
  const blob = new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

async function doExportXlsx() {
  busy.value = true
  try {
    if (browserMode) {
      const wb = buildWorkbook(store.project)
      const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      download('课表.xlsx', bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      store.notify('已下载 课表.xlsx', 'ok')
    } else {
      const r = await exportXlsx(store.project)
      if (r.ok) store.notify('已导出 Excel', 'ok')
    }
  } catch (e) {
    store.notify(`导出失败：${e?.message ?? e}`, 'err')
  } finally {
    busy.value = false
  }
}

async function doExportCsv() {
  busy.value = true
  try {
    if (browserMode) {
      download('课表.csv', buildMasterCsv(store.project), 'text/csv')
      store.notify('已下载 课表.csv', 'ok')
    } else {
      const r = await exportCsv(store.project)
      if (r.ok) store.notify('已导出 CSV', 'ok')
    }
  } catch (e) {
    store.notify(`导出失败：${e?.message ?? e}`, 'err')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <h2 class="page__title">导出打印</h2>
      <p class="page__desc">
        导出 Excel 工作簿（含总课表、逐班课表、逐教师课表三张表）或 CSV；
        打印请到「课表调整」页选择视图后点打印（会打印当前显示的课表）。
      </p>
    </header>

    <div class="card">
      <div class="card__title">文件导出</div>
      <div class="btn-row">
        <button class="btn btn--primary" :disabled="busy" @click="doExportXlsx">
          导出 Excel（.xlsx）
        </button>
        <button class="btn" :disabled="busy" @click="doExportCsv">导出 CSV</button>
      </div>
      <div class="meta-row">
        <span>包含班级 {{ store.project.classes.length }} 个 · 教师 {{ store.project.teachers.length }} 位</span>
        <span>已排单元 {{ Object.values(store.project.schedule ?? {}).reduce((s, arr) => s + arr.length, 0) }}</span>
      </div>
      <div v-if="!store.project.classes.length" class="warn-tip">还没有班级数据，导出内容将为空。</div>
    </div>

    <div class="card">
      <div class="card__title">打印</div>
      <p class="desc">到「课表调整」页，切换到需要的视图（按班级 / 按教师 / 全校总表）后点右上角「打印」。</p>
      <ol class="steps">
        <li>打开「课表调整」页；</li>
        <li>切换到需要的视图（按班级 / 按教师 / 全校总表）并选择对象；</li>
        <li>点击该页右上角的「打印」按钮，调起系统打印。</li>
      </ol>
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
  margin-bottom: 14px;
}
.card__title { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
.btn-row { display: flex; gap: 10px; }
.meta-row {
  display: flex;
  gap: 16px;
  font-size: 12.5px;
  color: var(--c-text-muted);
  margin-top: 12px;
}
.warn-tip { margin-top: 10px; font-size: 12.5px; color: #b45309; }
.desc { font-size: 13px; color: var(--c-text-muted); margin: 0 0 10px; }
.steps { margin: 10px 0 0; padding-left: 20px; font-size: 13px; color: var(--c-text-muted); line-height: 1.9; }
</style>
