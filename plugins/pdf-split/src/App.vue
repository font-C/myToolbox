<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { toolbox } from '@toolbox/plugin-sdk'
import { useNativeFileDrop } from '@toolbox/plugin-sdk'
import { loadDoc, closeDoc, getPageInfos, renderPageToDataUrl } from './splitRenderer'
import { parseGroups, groupsEveryN, groupsPerPage, outputName } from './splitMath'
import { loadSource, exportPages, makeZip } from './splitExport'

const mode = ref('custom') // custom | everyN | perpage
const file = ref(null) // { name, bytes }
const pageCount = ref(0)
const thumbs = ref([]) // [{ index, url }]
const busy = ref(false)
const rendering = ref(false)
const rangeInput = ref('1-8；1,2,3；1-3,8,9')
const everyN = ref(2)
const results = ref([]) // [{ name, bytes }]
const error = ref('')
const savedPath = ref('')
const dragging = ref(false)

const THUMB_MAX = 100

let unlistenNativeDrop = () => {}
onMounted(() => {
  unlistenNativeDrop = useNativeFileDrop({
    onFiles: (files) => handleFiles(files),
    onDragState: (v) => {
      dragging.value = v
    },
  })
})
onUnmounted(() => {
  unlistenNativeDrop()
  closeDoc()
})

function fmtSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

async function handleFiles(list) {
  const f = list?.[0]
  if (!f) return
  if (!f.name.toLowerCase().endsWith('.pdf')) {
    error.value = '请选择 PDF 文件'
    return
  }
  await reset()
  const bytes = new Uint8Array(await f.arrayBuffer())
  file.value = { name: f.name, bytes }
  error.value = ''
  rendering.value = true
  try {
    const doc = await loadDoc(bytes)
    pageCount.value = doc.numPages
    if (doc.numPages <= THUMB_MAX) {
      const infos = await getPageInfos(doc)
      const scale = Math.min(0.5, 160 / Math.max(infos[0].width, infos[0].height, 1))
      for (const info of infos) {
        try {
          const url = await renderPageToDataUrl(doc, info.index, scale)
          thumbs.value.push({ index: info.index, url })
        } catch {
          thumbs.value.push({ index: info.index, url: null })
        }
      }
    }
  } catch (e) {
    const msg = String(e)
    error.value = msg.includes('assword') || msg.includes('加密')
      ? '无法打开：该 PDF 已加密，请先用「PDF 加密 / 解锁」移除密码'
      : `无法打开 PDF：${e}`
    file.value = null
    pageCount.value = 0
  } finally {
    rendering.value = false
  }
}

async function reset() {
  await closeDoc()
  file.value = null
  pageCount.value = 0
  thumbs.value = []
  results.value = []
  error.value = ''
  savedPath.value = ''
}

/** 当前自定义输入解析出的分组（实时预览，出错则返回错误） */
const parsed = computed(() => {
  if (mode.value !== 'custom' || !pageCount.value) return { groups: [], error: '' }
  try {
    return { groups: parseGroups(rangeInput.value, pageCount.value), error: '' }
  } catch (e) {
    return { groups: [], error: String(e.message || e) }
  }
})

const groups = computed(() => {
  if (!pageCount.value) return []
  if (mode.value === 'custom') return parsed.value.groups
  if (mode.value === 'everyN') {
    try {
      return groupsEveryN(everyN.value, pageCount.value)
    } catch {
      return []
    }
  }
  return groupsPerPage(pageCount.value)
})

const groupSummary = computed(() =>
  groups.value.map((g, i) => ({ index: i + 1, pages: g, label: outputName(file.value?.name || '拆分.pdf', i + 1, g, mode.value) })),
)

function switchMode(m) {
  mode.value = m
  results.value = []
  savedPath.value = ''
  if (m === 'custom' && pageCount.value > 1) {
    const half = Math.ceil(pageCount.value / 2)
    rangeInput.value = `1-${half}；${half + 1}-${pageCount.value}`
  }
}

async function run() {
  if (!file.value || busy.value) return
  const list = groups.value
  if (list.length === 0) {
    error.value = mode.value === 'custom' ? parsed.value.error || '请输入拆分范围' : '请检查拆分参数'
    return
  }
  busy.value = true
  error.value = ''
  results.value = []
  savedPath.value = ''
  try {
    const src = await loadSource(file.value.bytes)
    const out = []
    for (let i = 0; i < list.length; i++) {
      const pages0 = list[i].map((p) => p - 1)
      const bytes = await exportPages(src, pages0)
      out.push({ name: outputName(file.value.name, i + 1, list[i], mode.value), bytes })
    }
    results.value = out
  } catch (e) {
    const msg = String(e)
    error.value = msg.includes('ncrypted') || msg.includes('assword')
      ? '该 PDF 已加密，请先用「PDF 加密 / 解锁」移除密码'
      : `拆分失败：${e}`
  } finally {
    busy.value = false
  }
}

async function saveZip() {
  if (!results.value.length) return
  const base = file.value.name.replace(/\.pdf$/i, '')
  const zipBytes = makeZip(results.value)
  const path = await toolbox.pickSaveFile({
    defaultName: `${base}_拆分.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
    bytes: zipBytes,
  })
  if (path) savedPath.value = `${path}（${results.value.length} 个文件）`
}

async function saveOne(item) {
  const path = await toolbox.pickSaveFile({
    defaultName: item.name,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    bytes: item.bytes,
  })
  if (path) savedPath.value = path
}
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>PDF 拆分</h1>
      <p class="header__sub">按页码范围把一份 PDF 拆成多份 · 纯本地处理，文件不上传</p>
    </header>

    <main class="body">
      <template v-if="!file">
        <div
          class="uploader"
          :class="{ 'uploader--drag': dragging }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="((dragging = false), handleFiles($event.dataTransfer?.files))"
          @click="$refs.fileInput?.click()"
        >
          <input
            ref="fileInput"
            type="file"
            accept=".pdf"
            class="uploader__input"
            @change="handleFiles($event.target.files); $refs.fileInput.value = ''"
          />
          <div class="uploader__icon">✂️</div>
          <p class="uploader__title">拖拽 PDF 到此处，或点击选择文件</p>
          <p class="uploader__hint">纯本地处理，文件不会上传</p>
          <button type="button" class="btn btn--primary uploader__btn">选择 PDF 文件</button>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
      </template>

      <template v-else>
        <section class="filecard">
          <div class="filecard__icon">📄</div>
          <div class="filecard__meta">
            <p class="filecard__name">{{ file.name }}</p>
            <p class="filecard__size">共 {{ pageCount }} 页 · {{ fmtSize(file.bytes.length) }}</p>
          </div>
          <button type="button" class="btn filecard__reset" @click="reset">重新选择</button>
        </section>

        <section v-if="thumbs.length" class="thumbs">
          <div v-for="t in thumbs" :key="t.index" class="thumb">
            <img v-if="t.url" :src="t.url" alt="" />
            <div v-else class="thumb__placeholder">{{ t.index }}</div>
            <span class="thumb__num">{{ t.index }}</span>
          </div>
        </section>
        <p v-else-if="rendering" class="muted">正在生成页面预览…</p>
        <p v-else-if="pageCount > 100" class="muted">共 {{ pageCount }} 页，页数较多，已省略缩略图</p>

        <section v-if="!results.length" class="modes">
          <div class="tabs">
            <button type="button" class="tab" :class="{ 'tab--active': mode === 'custom' }" @click="switchMode('custom')">自定义范围</button>
            <button type="button" class="tab" :class="{ 'tab--active': mode === 'everyN' }" @click="switchMode('everyN')">每 N 页一份</button>
            <button type="button" class="tab" :class="{ 'tab--active': mode === 'perpage' }" @click="switchMode('perpage')">逐页拆分</button>
          </div>

          <div v-if="mode === 'custom'" class="field">
            <label class="field__label" for="rangeInput">范围分组（分号分隔各组，组内逗号或范围）</label>
            <textarea
              id="rangeInput"
              v-model="rangeInput"
              class="input textarea"
              rows="2"
              placeholder="例如：1-8；1,2,3；1-3,8,9"
              spellcheck="false"
            ></textarea>
            <p v-if="parsed.error" class="error">{{ parsed.error }}</p>
            <p v-else-if="groups.length" class="field__hint">
              将生成 {{ groups.length }} 个 PDF：
              {{ groupSummary.map((g) => `组${g.index}（${g.pages.length} 页）`).join('、') }}
            </p>
          </div>

          <div v-else-if="mode === 'everyN'" class="field field--row">
            <label class="field__label" for="everyN">每</label>
            <input id="everyN" v-model.number="everyN" type="number" min="1" class="input input--num" />
            <span class="field__label">页一份</span>
            <span v-if="groups.length" class="field__hint field__hint--inline">共 {{ groups.length }} 份</span>
          </div>

          <p v-else class="field__hint">每一页输出为一个独立的 PDF，共 {{ pageCount }} 份（建议打包 zip 下载）。</p>

          <p v-if="error" class="error">{{ error }}</p>

          <button
            type="button"
            class="btn btn--primary run"
            :disabled="busy || !groups.length || (mode === 'custom' && !!parsed.error)"
            @click="run"
          >
            <span v-if="busy" class="spinner" />
            {{ busy ? '拆分中…' : `拆分并生成 ${groups.length || ''} 个 PDF` }}
          </button>
        </section>

        <section v-if="results.length" class="result">
          <p class="result__title">已生成 {{ results.length }} 个 PDF</p>
          <ul class="result__list">
            <li v-for="r in results" :key="r.name" class="result__item">
              <span class="result__name">{{ r.name }}</span>
              <span class="result__size">{{ fmtSize(r.bytes.length) }}</span>
              <button type="button" class="link" @click="saveOne(r)">另存</button>
            </li>
          </ul>
          <div class="result__actions">
            <button v-if="results.length > 1" type="button" class="btn btn--primary" @click="saveZip">打包下载 zip</button>
            <button v-else type="button" class="btn btn--primary" @click="saveOne(results[0])">保存 PDF</button>
            <button type="button" class="btn" @click="((results = []), (savedPath = ''))">返回调整</button>
          </div>
          <p v-if="savedPath" class="result__saved">已保存到 {{ savedPath }}</p>
        </section>
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

.header { text-align: center; padding: 22px 16px 10px; }
.header h1 { margin: 0 0 6px; font-size: 22px; }
.header__sub { margin: 0; font-size: 13px; color: var(--c-text-muted); }

.body {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 8px 24px 32px;
}

.uploader {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 100%; max-width: 560px; min-height: 280px;
  border: 2px dashed var(--c-border); border-radius: 16px; background: var(--c-surface);
  cursor: pointer; transition: border-color 0.15s, background 0.15s; padding: 36px 24px;
}
.uploader:hover, .uploader--drag { border-color: var(--c-primary); background: rgba(59, 130, 246, 0.05); }
.uploader__input { display: none; }
.uploader__icon { font-size: 48px; line-height: 1; margin-bottom: 14px; }
.uploader__title { margin: 0 0 6px; font-size: 17px; font-weight: 600; }
.uploader__hint { margin: 0 0 18px; font-size: 13px; color: var(--c-text-muted); }

.filecard {
  width: 100%; display: flex; align-items: center; gap: 12px;
  background: var(--c-surface); border: 1px solid var(--c-border);
  border-radius: 12px; padding: 13px 16px;
}
.filecard__icon { font-size: 26px; }
.filecard__meta { flex: 1; min-width: 0; }
.filecard__name { margin: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.filecard__size { margin: 2px 0 0; font-size: 12px; color: var(--c-text-muted); }

.thumbs {
  width: 100%; display: flex; gap: 10px; overflow-x: auto;
  background: var(--c-surface); border: 1px solid var(--c-border);
  border-radius: 12px; padding: 12px;
}
.thumb { position: relative; flex: 0 0 auto; width: 84px; }
.thumb img { width: 84px; height: auto; border: 1px solid var(--c-border); border-radius: 6px; background: #fff; display: block; }
.thumb__placeholder { width: 84px; height: 110px; border: 1px solid var(--c-border); border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--c-text-muted); }
.thumb__num {
  position: absolute; top: 4px; left: 4px; min-width: 18px; height: 18px; padding: 0 4px;
  background: var(--c-primary); color: #fff; font-size: 11px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}

.modes { width: 100%; display: flex; flex-direction: column; gap: 14px; }
.tabs {
  width: 100%; display: grid; grid-template-columns: 1fr 1fr 1fr;
  background: var(--c-surface); border: 1px solid var(--c-border);
  border-radius: 12px; padding: 4px; gap: 4px;
}
.tab {
  border: none; background: transparent; padding: 9px 6px; font-size: 13.5px; font-weight: 600;
  border-radius: 8px; cursor: pointer; color: var(--c-text-muted);
}
.tab--active { background: var(--c-primary); color: #fff; }

.field { display: flex; flex-direction: column; gap: 6px; }
.field--row { flex-direction: row; align-items: center; gap: 8px; }
.field__label { font-size: 13px; font-weight: 600; }
.field__hint { margin: 0; font-size: 12px; color: var(--c-text-muted); }
.field__hint--inline { margin-left: auto; }
.input {
  padding: 10px 12px; border: 1px solid var(--c-border); border-radius: 8px;
  font-size: 14px; background: var(--c-bg); color: var(--c-text);
  font-family: inherit;
}
.input:focus { outline: 2px solid var(--c-primary); outline-offset: -1px; }
.textarea { resize: vertical; line-height: 1.6; }
.input--num { width: 90px; text-align: center; }

.run { align-self: stretch; justify-content: center; padding: 12px; }

.result {
  width: 100%; display: flex; flex-direction: column; gap: 10px;
  background: var(--c-surface); border: 1px solid var(--c-border);
  border-radius: 12px; padding: 20px;
}
.result__title { margin: 0; font-size: 16px; font-weight: 700; }
.result__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; }
.result__item { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 6px 8px; border-radius: 8px; background: var(--c-bg); }
.result__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result__size { color: var(--c-text-muted); font-size: 12px; }
.result__actions { display: flex; gap: 12px; margin-top: 4px; }
.result__saved { margin: 2px 0 0; font-size: 12px; color: var(--c-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }

.link { border: none; background: none; color: var(--c-primary); cursor: pointer; font-size: 12.5px; padding: 2px 4px; }
.muted { margin: 0; font-size: 13px; color: var(--c-text-muted); }
.error { margin: 0; color: var(--c-danger); font-size: 13px; }
</style>
