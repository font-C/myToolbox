<script setup>
import { ref, computed } from 'vue'
import { toolbox } from '@toolbox/plugin-sdk'
import PdfUploader from './PdfUploader.vue'

const file = ref(null) // { name, bytes }
const preset = ref('recommended')
const busy = ref(false)
const result = ref(null) // { bytes }
const error = ref('')
const savedPath = ref('')
const showBytesTip = ref(false)

const presets = [
  { id: 'light', title: '轻', desc: '尽量保画质', hint: '适合打印与高清阅读' },
  { id: 'recommended', title: '推荐', desc: '画质与体积均衡', hint: '大多数文档的选择' },
  { id: 'extreme', title: '极限', desc: '最小体积', hint: '适合邮件附件与快速传输' },
]

const savedRatio = computed(() => {
  if (!file.value || !result.value) return 0
  const before = file.value.bytes.length
  const after = result.value.bytes.length
  if (before <= 0) return 0
  return Math.max(0, Math.round((1 - after / before) * 100))
})

function fmtSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

async function onSelect(f) {
  error.value = ''
  result.value = null
  savedPath.value = ''
  const bytes = new Uint8Array(await f.arrayBuffer())
  file.value = { name: f.name, bytes }
}

async function compress() {
  if (!file.value || busy.value) return
  busy.value = true
  error.value = ''
  result.value = null
  savedPath.value = ''
  try {
    const bytes = await toolbox.compressPdf(file.value.bytes, preset.value)
    result.value = { bytes }
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}

async function save() {
  if (!result.value) return
  const base = file.value.name.replace(/\.pdf$/i, '')
  const path = await toolbox.pickSaveFile({
    defaultName: `${base}_压缩.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    bytes: result.value.bytes,
  })
  if (path) savedPath.value = path
}

function reset() {
  file.value = null
  result.value = null
  error.value = ''
  savedPath.value = ''
  showBytesTip.value = false
}
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>PDF 压缩</h1>
      <p class="header__sub">本地重编码内嵌图像 · 文字保持矢量可选中 · 文件不出本机</p>
    </header>

    <main class="body">
      <PdfUploader v-if="!file" @select="onSelect" @invalid="error = '请选择 PDF 文件'" />

      <template v-else>
        <section class="filecard">
          <div class="filecard__icon">📄</div>
          <div class="filecard__meta">
            <p class="filecard__name">{{ file.name }}</p>
            <p class="filecard__size">原始大小 {{ fmtSize(file.bytes.length) }}</p>
          </div>
          <button type="button" class="btn filecard__reset" @click="reset">重新选择</button>
        </section>

        <section v-if="!result" class="presets">
          <button
            v-for="p in presets"
            :key="p.id"
            type="button"
            class="preset"
            :class="{ 'preset--active': preset === p.id }"
            @click="preset = p.id"
          >
            <span class="preset__title">{{ p.title }}</span>
            <span class="preset__desc">{{ p.desc }}</span>
            <span class="preset__hint">{{ p.hint }}</span>
          </button>
        </section>

        <section v-if="result" class="result">
          <p class="result__ratio">体积减少 {{ savedRatio }}%</p>
          <div class="result__sizes">
            <span>{{ fmtSize(file.bytes.length) }}</span>
            <span class="result__arrow">→</span>
            <span class="result__after">{{ fmtSize(result.bytes.length) }}</span>
          </div>
          <p v-if="savedRatio === 0" class="result__note">
            这份文档已经很紧凑（图像占比低），压缩收益有限
          </p>
          <div class="result__actions">
            <button type="button" class="btn btn--primary" @click="save">保存压缩后的 PDF</button>
            <button type="button" class="btn" @click="reset">再处理一份</button>
          </div>
          <p v-if="savedPath" class="result__saved">已保存到 {{ savedPath }}</p>
        </section>

        <p v-if="error" class="error">{{ error }}</p>

        <footer v-if="!result" class="footer">
          <button type="button" class="btn btn--primary" :disabled="busy" @click="compress">
            <span v-if="busy" class="spinner" />
            {{ busy ? '压缩中…' : '开始压缩' }}
          </button>
          <button type="button" class="link" @click="showBytesTip = !showBytesTip">压缩说明</button>
        </footer>

        <p v-if="showBytesTip && !result" class="tip">
          压缩通过重编码文档中的图片实现：极限档会明显降低图片分辨率与画质；
          扫描件（整页都是图片）效果最明显，纯文字文档收益很小。
        </p>
      </template>
    </main>
  </div>
</template>

<style scoped>
.page {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-y: auto;
}

.header {
  text-align: center;
  padding: 24px 16px 12px;
}

.header h1 {
  margin: 0 0 6px;
  font-size: 22px;
}

.header__sub {
  margin: 0;
  font-size: 13px;
  color: var(--c-text-muted);
}

.body {
  width: 100%;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 8px 24px 32px;
}

.filecard {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 14px 16px;
}

.filecard__icon {
  font-size: 28px;
}

.filecard__meta {
  flex: 1;
  min-width: 0;
}

.filecard__name {
  margin: 0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filecard__size {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--c-text-muted);
}

.presets {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.preset {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 14px;
  border: 2px solid var(--c-border);
  border-radius: 12px;
  background: var(--c-surface);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}

.preset--active {
  border-color: var(--c-primary);
  background: rgba(59, 130, 246, 0.06);
}

.preset__title {
  font-size: 16px;
  font-weight: 700;
}

.preset__desc {
  font-size: 13px;
}

.preset__hint {
  font-size: 12px;
  color: var(--c-text-muted);
}

.footer {
  display: flex;
  align-items: center;
  gap: 16px;
}

.link {
  border: none;
  background: none;
  color: var(--c-primary);
  cursor: pointer;
  font-size: 13px;
  padding: 4px;
}

.result {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 24px;
}

.result__ratio {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  color: var(--c-primary);
}

.result__sizes {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--c-text-muted);
}

.result__after {
  font-weight: 700;
  color: var(--c-text);
}

.result__note {
  margin: 0;
  font-size: 12px;
  color: var(--c-text-muted);
}

.result__actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.result__saved {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-muted);
}

.tip {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--c-text-muted);
}

.error {
  margin: 0;
  color: var(--c-danger);
  font-size: 13px;
}
</style>
