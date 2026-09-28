#!/usr/bin/env node
/**
 * 商店增量构建基线回填：从现有商店下载未变更插件的 .tbox 到 src-tauri/builtin/，
 * 并用商店索引重建 manifests.json 基线（不含变更插件，由 build:plugins --only 补齐）。
 *
 * CI 中 builtin/ 不入库，增量构建前需要未变更插件的包文件与清单；
 * 任一环节失败即退出 1，调用方（store.yml）回退全量构建。
 *
 * 用法：node scripts/fetch-store-baseline.mjs <storeUrl> <changedIds逗号分隔>
 */
import fs from 'node:fs'
import path from 'node:path'
import { sha256 } from '@noble/hashes/sha256'
import { fileURLToPath } from 'node:url'

const [storeUrl, changedArg] = process.argv.slice(2)
if (!storeUrl || !changedArg) {
  console.error('用法: fetch-store-baseline.mjs <storeUrl> <changedIds逗号分隔>')
  process.exit(1)
}
const changed = new Set(changedArg.split(',').map((s) => s.trim()).filter(Boolean))
const builtinDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'builtin')
fs.mkdirSync(builtinDir, { recursive: true })

const res = await fetch(new URL('index.json', storeUrl).href)
if (!res.ok) throw new Error(`商店返回 ${res.status}`)
const idx = await res.json()
if (idx.storeVersion !== 1) throw new Error(`未知商店索引版本 ${idx.storeVersion}`)

const keep = idx.plugins.filter((p) => !changed.has(p.id))
if (!keep.length) {
  console.log('所有插件均在变更集内，无需回填基线')
  process.exit(0)
}

for (const p of keep) {
  const r = await fetch(new URL(p.package, storeUrl).href)
  if (!r.ok) throw new Error(`下载 ${p.package} 失败：HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  const sha = Buffer.from(sha256(buf)).toString('hex')
  if (sha !== p.sha256) throw new Error(`${p.id} 的 sha256 与索引不符（下载源可能被篡改）`)
  fs.writeFileSync(path.join(builtinDir, `${p.id}.tbox`), buf)
  console.log(`  ✓ 回填 ${p.id} v${p.version}（${(buf.length / 1024).toFixed(0)} KB）`)
}

// 商店索引的元数据字段与 manifests.json 条目一致，去掉商店专属字段即为清单
const plugins = keep.map(({ signature, package: pkg, icon, ...meta }) => meta)
fs.writeFileSync(
  path.join(builtinDir, 'manifests.json'),
  JSON.stringify({ builtAt: new Date().toISOString(), plugins }, null, 2),
)
console.log(`✓ 基线就绪：${plugins.length} 个未变更插件（变更集：${[...changed].join(', ') || '无'}）`)
