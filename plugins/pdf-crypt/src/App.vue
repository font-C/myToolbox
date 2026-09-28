<script setup>
import { ref, computed } from 'vue'
import { toolbox } from '@toolbox/plugin-sdk'
import PdfUploader from './PdfUploader.vue'

const mode = ref('encrypt') // encrypt | unlock
const file = ref(null) // { name, bytes }
const password = ref('')
const password2 = ref('')
const busy = ref(false)
const result = ref(null) // { bytes, kind }
const error = ref('')
const savedPath = ref('')

const isEncrypt = computed(() => mode.value === 'encrypt')

function switchMode(m) {
  mode.value = m
  error.value = ''
  result.value = null
  savedPath.value = ''
  password.value = ''
  password2.value = ''
}

async function onSelect(f) {
  error.value = ''
  result.value = null
  savedPath.value = ''
  password.value = ''
  password2.value = ''
  const bytes = new Uint8Array(await f.arrayBuffer())
  file.value = { name: f.name, bytes }
}

function reset() {
  file.value = null
  result.value = null
  error.value = ''
  savedPath.value = ''
  password.value = ''
  password2.value = ''
}

function validate() {
  if (isEncrypt.value) {
    if (!password.value) return '请输入打开密码'
    if (password.value.length < 4) return '密码至少 4 位'
    if (password.value !== password2.value) return '两次输入的密码不一致'
  } else if (!password.value) {
    return '请输入该文档的密码（若无密码限制可直接点击处理）'
  }
  return ''
}

async function run() {
  if (!file.value || busy.value) return
  const invalid = validate()
  if (invalid) {
    error.value = invalid
    return
  }
  busy.value = true
  error.value = ''
  result.value = null
  savedPath.value = ''
  try {
    const kind = isEncrypt.value ? 'encrypt' : 'unlock'
    const bytes = isEncrypt.value
      ? await toolbox.encryptPdf(file.value.bytes, { userPassword: password.value })
      : await toolbox.unlockPdf(file.value.bytes, password.value)
    result.value = { bytes, kind }
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}

async function save() {
  if (!result.value) return
  const base = file.value.name.replace(/\.pdf$/i, '')
  const suffix = result.value.kind === 'encrypt' ? '_已加密' : '_已解锁'
  const path = await toolbox.pickSaveFile({
    defaultName: `${base}${suffix}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    bytes: result.value.bytes,
  })
  if (path) savedPath.value = path
}
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>PDF 加密 / 解锁</h1>
      <p class="header__sub">AES-256 标准加密，与主流阅读器互通 · 全程本地处理，密码不保存</p>
    </header>

    <main class="body">
      <PdfUploader v-if="!file" @select="onSelect" @invalid="error = '请选择 PDF 文件'" />

      <template v-else>
        <section class="filecard">
          <div class="filecard__icon">📄</div>
          <div class="filecard__meta">
            <p class="filecard__name">{{ file.name }}</p>
            <p class="filecard__size">{{ file.bytes.length }} 字节</p>
          </div>
          <button type="button" class="btn filecard__reset" @click="reset">重新选择</button>
        </section>

        <section v-if="!result" class="tabs">
          <button
            type="button"
            class="tab"
            :class="{ 'tab--active': isEncrypt }"
            @click="switchMode('encrypt')"
          >
            设置密码
          </button>
          <button
            type="button"
            class="tab"
            :class="{ 'tab--active': !isEncrypt }"
            @click="switchMode('unlock')"
          >
            移除密码
          </button>
        </section>

        <section v-if="!result" class="form">
          <template v-if="isEncrypt">
            <label class="field">
              <span class="field__label">打开密码</span>
              <input v-model="password" type="password" class="input" placeholder="打开此 PDF 时需要输入" autocomplete="new-password" />
            </label>
            <label class="field">
              <span class="field__label">确认密码</span>
              <input v-model="password2" type="password" class="input" placeholder="再输入一次" autocomplete="new-password" @keydown.enter="run" />
            </label>
            <p class="form__note">加密采用 AES-256（PDF 2.0 标准）。请务必记牢密码——忘记后无法找回。</p>
          </template>
          <template v-else>
            <label class="field">
              <span class="field__label">当前密码</span>
              <input v-model="password" type="password" class="input" placeholder="输入打开此 PDF 的密码" @keydown.enter="run" />
            </label>
            <p class="form__note">支持 RC4 / AES-128 / AES-256 标准加密；密码错误会明确提示。</p>
          </template>

          <p v-if="error" class="error">{{ error }}</p>

          <button type="button" class="btn btn--primary run" :disabled="busy" @click="run">
            <span v-if="busy" class="spinner" />
            {{ busy ? '处理中…' : isEncrypt ? '加密并导出' : '移除密码并导出' }}
          </button>
        </section>

        <section v-if="result" class="result">
          <p class="result__icon">{{ result.kind === 'encrypt' ? '🔐' : '🔓' }}</p>
          <p class="result__title">
            {{ result.kind === 'encrypt' ? '已设置打开密码' : '已移除打开密码' }}
          </p>
          <p class="result__desc">
            {{ result.kind === 'encrypt' ? '导出后用任意阅读器打开都需要输入密码' : '导出后打开不再需要密码' }}
          </p>
          <div class="result__actions">
            <button type="button" class="btn btn--primary" @click="save">保存 PDF</button>
            <button type="button" class="btn" @click="result = null">返回修改</button>
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
  max-width: 560px;
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

.filecard__reset {
  flex-shrink: 0;
}

.tabs {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 4px;
  gap: 4px;
}

.tab {
  border: none;
  background: transparent;
  padding: 10px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  color: var(--c-text-muted);
}

.tab--active {
  background: var(--c-primary);
  color: #fff;
}

.form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field__label {
  font-size: 13px;
  font-weight: 600;
}

.input {
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  font-size: 14px;
  background: var(--c-bg);
  color: var(--c-text);
}

.input:focus {
  outline: 2px solid var(--c-primary);
  outline-offset: -1px;
}

.form__note {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--c-text-muted);
}

.run {
  align-self: stretch;
  justify-content: center;
  padding: 12px;
}

.result {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 28px;
  text-align: center;
}

.result__icon {
  margin: 0;
  font-size: 44px;
  line-height: 1;
}

.result__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.result__desc {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--c-text-muted);
}

.result__actions {
  display: flex;
  gap: 12px;
}

.result__saved {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.error {
  margin: 0;
  color: var(--c-danger);
  font-size: 13px;
}
</style>
