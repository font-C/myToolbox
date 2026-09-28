#!/usr/bin/env node
/**
 * 插件打包脚本：把 plugins/ 下的每个插件构建为 .tbox 包。
 *
 * 流程（每个插件）：
 *   1. vite build（使用插件自己的 vite.config.js / SDK 预设）
 *   2. 把 manifest.json、icon.png 复制进 dist
 *   3. dist 内容打包为 zip → src-tauri/builtin/<id>.tbox
 *   4. 计算 sha256，写入构建清单 src-tauri/builtin/manifests.json
 *
 * manifests.json 同时是商店索引生成（scripts/build-store-index.mjs）的输入。
 *
 * 用法：npm run build:plugins [-- --only=<id>[,<id>...]]
 *
 * --only 指定逗号分隔的插件 id 时只构建这些插件；manifests.json 采用合并策略
 * （保留未构建插件的既有清单），供商店索引增量生成使用。
 */
import { build } from 'vite'
import { zipSync } from 'fflate'
import { sha256 } from '@noble/hashes/sha256'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = path.join(root, 'plugins')
const builtinDir = path.join(root, 'src-tauri', 'builtin')

const onlyArg = process.argv.find((a) => a.startsWith('--only='))
// 逗号分隔多个插件 id；为空 = 全量构建
const onlyIds = onlyArg
  ? onlyArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
  : null

/** 递归收集目录内文件，返回 { 相对路径(正斜杠): Uint8Array } */
function collectFiles(dir, base = dir, acc = {}) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (full === base && dir === base) continue
    const rel = path.relative(base, full).split(path.sep).join('/')
    if (fs.statSync(full).isDirectory()) {
      collectFiles(full, base, acc)
    } else {
      acc[rel] = new Uint8Array(fs.readFileSync(full))
    }
  }
  return acc
}

async function buildOne(pluginDir) {
  const manifestPath = path.join(pluginDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return null
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const { id, version, entry = 'index.html', icon = 'icon.png' } = manifest
  if (onlyIds && !onlyIds.includes(id)) return null

  console.log(`\n▸ 构建插件 ${id} v${version}`)
  await build({ root: pluginDir, logLevel: 'warn' })

  const dist = path.join(pluginDir, 'dist')
  fs.copyFileSync(manifestPath, path.join(dist, 'manifest.json'))
  const iconSrc = path.join(pluginDir, icon)
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, path.join(dist, icon))
  } else {
    console.warn(`  ⚠ 缺少图标文件 ${icon}`)
  }

  if (!fs.existsSync(path.join(dist, entry))) {
    throw new Error(`插件 ${id} 构建产物缺少入口 ${entry}`)
  }

  const files = collectFiles(dist)
  if (!files[icon]) throw new Error(`插件 ${id} 打包缺少图标 ${icon}`)
  const tbox = zipSync(files, { level: 6 })
  const sha = Buffer.from(sha256(tbox)).toString('hex')

  fs.mkdirSync(builtinDir, { recursive: true })
  const outPath = path.join(builtinDir, `${id}.tbox`)
  fs.writeFileSync(outPath, tbox)
  console.log(`  ✓ ${path.relative(root, outPath)}（${(tbox.length / 1024).toFixed(0)} KB）`)

  return {
    id,
    name: manifest.name,
    version,
    description: manifest.description,
    author: manifest.author,
    apiVersion: manifest.apiVersion,
    minHostVersion: manifest.minHostVersion ?? null,
    permissions: manifest.permissions ?? [],
    sha256: sha,
    size: tbox.length,
  }
}

const built = []
for (const name of fs.readdirSync(pluginsDir).sort()) {
  const dir = path.join(pluginsDir, name)
  if (!fs.statSync(dir).isDirectory()) continue
  const result = await buildOne(dir)
  if (result) built.push(result)
}

if (built.length === 0) {
  console.log('没有可打包的插件。')
  process.exit(0)
}

const manifestsPath = path.join(builtinDir, 'manifests.json')
// 增量构建（--only）：与既有清单合并，未构建插件保留原条目（其 .tbox 未变，sha256 仍一致）；
// 全量构建：整体覆盖。合并要求 builtin/ 下已有未变更插件的 .tbox 与清单。
let finalPlugins = built
if (onlyIds) {
  let prevList = []
  try {
    const existing = JSON.parse(fs.readFileSync(manifestsPath, 'utf8'))
    if (Array.isArray(existing.plugins)) prevList = existing.plugins
  } catch {
    console.error('✗ 增量构建需要既有 manifests.json（不存在或不可解析），请先全量构建一次。')
    process.exit(1)
  }
  const builtIds = new Set(built.map((p) => p.id))
  const kept = prevList.filter((p) => !builtIds.has(p.id))
  finalPlugins = [...kept, ...built].sort((a, b) => a.id.localeCompare(b.id))
  const missing = kept.filter((p) => !fs.existsSync(path.join(builtinDir, `${p.id}.tbox`)))
  if (missing.length) {
    console.error(`✗ 增量构建缺少未变更插件的 .tbox：${missing.map((p) => p.id).join(', ')}`)
    console.error('  请先全量构建一次（npm run build:plugins）或从商店回填包文件。')
    process.exit(1)
  }
}
fs.writeFileSync(manifestsPath, JSON.stringify({ builtAt: new Date().toISOString(), plugins: finalPlugins }, null, 2))
console.log(`\n✓ 共 ${finalPlugins.length} 个插件，构建清单 → ${path.relative(root, manifestsPath)}`)
