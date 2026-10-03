<script setup>
/**
 * FileVerdict — 两个文件的一致性校验结果卡。
 * 文件对直接对比与目录对比选中文件共用；result 由父组件计算（SHA-256 + 逐字节首差异）。
 */
import { ref } from 'vue'
import { toolbox } from '@toolbox/plugin-sdk'

const props = defineProps({
  result: { type: Object, required: true }, // { same, sizeL, sizeR, hashL, hashR, firstDiff }
  leftName: { type: String, default: '原文件' },
  rightName: { type: String, default: '新文件' },
})

const copyOk = ref('')
const copyErr = ref('')

function fmtSize(n) {
  if (n == null) return '—'
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`
}

async function copyHash(text) {
  try {
    await toolbox.writeClipboardText(text)
    copyOk.value = text
    copyErr.value = ''
    setTimeout(() => (copyOk.value = ''), 1500)
  } catch (e) {
    copyErr.value = `复制失败：${e.message || e}`
    setTimeout(() => (copyErr.value = ''), 2500)
  }
}
</script>

<template>
  <section class="fcmp" :class="result.same ? 'fcmp--same' : 'fcmp--diff'">
    <div class="fcmp__verdict">{{ result.same ? '✓ 两个文件完全一致' : '✗ 两个文件不一致' }}</div>
    <table class="fcmp__table">
      <tr>
        <th></th>
        <th>原 · {{ leftName }}</th>
        <th>新 · {{ rightName }}</th>
      </tr>
      <tr>
        <th>大小</th>
        <td :class="{ 'fcmp__bad': result.sizeL !== result.sizeR }">{{ fmtSize(result.sizeL) }}</td>
        <td :class="{ 'fcmp__bad': result.sizeL !== result.sizeR }">{{ fmtSize(result.sizeR) }}</td>
      </tr>
      <tr>
        <th>SHA-256</th>
        <td>
          <code class="fcmp__hash">{{ result.hashL }}</code>
          <button type="button" class="btn btn--mini" @click="copyHash(result.hashL)">
            {{ copyOk === result.hashL ? '已复制' : '复制' }}
          </button>
        </td>
        <td>
          <code class="fcmp__hash">{{ result.hashR }}</code>
          <button type="button" class="btn btn--mini" @click="copyHash(result.hashR)">
            {{ copyOk === result.hashR ? '已复制' : '复制' }}
          </button>
        </td>
      </tr>
      <tr v-if="result.firstDiff != null">
        <th>首个差异</th>
        <td colspan="2">第 {{ result.firstDiff + 1 }} 字节起内容不同</td>
      </tr>
      <tr v-else-if="!result.same">
        <th>差异</th>
        <td colspan="2">文件大小不同（相差 {{ Math.abs(result.sizeL - result.sizeR) }} 字节）</td>
      </tr>
    </table>
    <p v-if="copyErr" class="fcmp__err">{{ copyErr }}</p>
  </section>
</template>

<style scoped>
.fcmp {
  background: var(--c-surface); border-radius: 12px; padding: 22px 26px; display: flex; flex-direction: column; gap: 16px;
}
.fcmp--same { border: 1px solid #bbf7d0; }
.fcmp--diff { border: 1px solid #fecaca; }
.fcmp__verdict { text-align: center; font-size: 17px; font-weight: 700; }
.fcmp--same .fcmp__verdict { color: #16a34a; }
.fcmp--diff .fcmp__verdict { color: #dc2626; }
.fcmp__table { border-collapse: collapse; width: 100%; }
.fcmp__table th, .fcmp__table td {
  border: 1px solid var(--c-border); padding: 8px 12px; font-size: 12.5px; text-align: left; vertical-align: top;
}
.fcmp__table th { background: #f8fafc; color: #64748b; font-weight: 600; white-space: nowrap; }
.fcmp__table th:not(:first-child) { min-width: 38%; overflow-wrap: anywhere; }
.fcmp__bad { color: #dc2626; font-weight: 600; }
.fcmp__hash {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 11.5px;
  overflow-wrap: anywhere; display: block; margin-bottom: 6px;
}
.fcmp__err { margin: 0; font-size: 12px; color: var(--c-danger); }
</style>
