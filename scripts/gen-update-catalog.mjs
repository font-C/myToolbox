#!/usr/bin/env node
/**
 * 主程序更新目录生成脚本（specs/07，CI 在 release.yml 中调用）。
 *
 * 扫描构建产物目录（含 .sig 签名文件），按平台归类生成 Tauri updater
 * 端点格式的 app-update.json：
 *
 *   {
 *     "version":  "0.5.0",
 *     "notes":    "…（Release 说明）",
 *     "pub_date": "2026-09-29T00:00:00.000Z",
 *     "platforms": {
 *       "darwin-aarch64": { "signature": "<.sig 文件内容原样>", "url": "<下载地址>" },
 *       "windows-x86_64": { "signature": "…", "url": "…" }
 *     }
 *   }
 *
 * 产物 → 平台键的映射：
 *   - <name>_<version>_<arch>.app.tar.gz  → darwin-aarch64 / darwin-x86_64
 *     （bundler 产物原本不含架构，release.yml 收集时已重命名补上）
 *   - <name>_<version>_<arch>-setup.exe   → windows-x86_64
 *   - .dmg 等其余文件不是更新载体，跳过（macOS 更新走 .app.tar.gz）
 *
 * signature 字段 = .sig 文件内容**原样**——tauri 产出的 .sig 文件本身是
 * minisign 签名块的单行 base64（解码后才是 "untrusted comment: …" 四行格式），
 * updater 插件会自己做这一次 base64 解码再验签。切勿再对文件内容多编一层
 * base64（双重编码会让 updater 报 Invalid encoding in minisign data）。
 *
 * 用法：
 *   node scripts/gen-update-catalog.mjs --version 0.5.0 \
 *     --base-url "https://github.com/OWNER/REPO/releases/download/v0.5.0/" \
 *     --notes-file body.txt --dist dist --out dist/app-update.json
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (!flag.startsWith('--')) continue
    const key = flag.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i++
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const distDir = path.resolve(args.dist ?? 'dist')
const outFile = path.resolve(args.out ?? path.join(distDir, 'app-update.json'))
const baseUrl = args['base-url'] ?? ''
const version = args.version ?? ''

if (!version) {
  console.error('✗ 缺少 --version')
  process.exit(1)
}
if (!baseUrl || !baseUrl.startsWith('https://')) {
  console.error(`✗ 缺少 --base-url 或不是 https：${baseUrl || '(空)'}`)
  process.exit(1)
}
if (!fs.existsSync(distDir)) {
  console.error(`✗ 产物目录不存在：${distDir}`)
  process.exit(1)
}

/** 产物文件名 → updater 平台键（tauri-plugin-updater 的 target 命名：OS-ARCH） */
function platformKeyOf(artifact) {
  if (artifact.endsWith('.app.tar.gz')) {
    const m = artifact.match(/_(aarch64|x86_64)\.app\.tar\.gz$/)
    if (!m) {
      throw new Error(`macOS 更新包文件名缺少架构后缀（应由 CI 重命名补上）：${artifact}`)
    }
    return `darwin-${m[1]}`
  }
  if (artifact.endsWith('.exe')) {
    const m = artifact.match(/_(aarch64|x64|arm64)-/)
    const arch = m ? (m[1] === 'x64' || m[1] === 'arm64' ? (m[1] === 'x64' ? 'x86_64' : 'aarch64') : m[1]) : 'x86_64'
    return `windows-${arch}`
  }
  return null
}

const platforms = {}
for (const name of fs.readdirSync(distDir).sort()) {
  if (!name.endsWith('.sig')) continue
  const artifact = name.slice(0, -4) // 去掉 .sig
  const key = platformKeyOf(artifact)
  if (!key) {
    console.log(`· 跳过非更新载体 ${name}（安装包本体仍作为 Release 资产发布）`)
    continue
  }
  const sigPath = path.join(distDir, name)
  const artifactPath = path.join(distDir, artifact)
  if (!fs.existsSync(artifactPath)) {
    console.error(`✗ 签名缺少对应产物：${name} → ${artifact}`)
    process.exit(1)
  }
  const sigText = fs.readFileSync(sigPath, 'utf8').trim()
  // 结构自检：.sig 文件内容是 base64，解码后必须是 minisign 签名块
  const inner = Buffer.from(sigText, 'base64').toString('utf8')
  if (!inner.startsWith('untrusted comment:')) {
    console.error(`✗ ${name} 解码后不是 minisign 签名块（应以 "untrusted comment:" 开头）——确认取的是原始 .sig 文件且未二次编码`)
    process.exit(1)
  }
  platforms[key] = {
    signature: sigText,
    url: baseUrl + artifact,
  }
  console.log(`✓ ${key} ← ${artifact}（${fs.statSync(artifactPath).size} 字节）`)
}

if (Object.keys(platforms).length === 0) {
  console.error('✗ 未发现任何更新产物（*.app.tar.gz / *-setup.exe 及其 .sig）——检查收集步骤')
  process.exit(1)
}

const notes = args['notes-file'] ? fs.readFileSync(args['notes-file'], 'utf8').trim() : ''
const catalog = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
}

fs.writeFileSync(outFile, JSON.stringify(catalog, null, 2) + '\n')
console.log(`\n✓ 更新目录已生成：${outFile}`)
console.log(`  版本 v${version} · 平台 ${Object.keys(platforms).join(', ')}`)
