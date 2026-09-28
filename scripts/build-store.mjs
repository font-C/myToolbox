#!/usr/bin/env node
/**
 * 商店索引构建脚本：把构建好的插件包组织成可静态托管的商店站点目录 store/。
 *
 * 输入：src-tauri/builtin/*.tbox + manifests.json（npm run build:plugins 的产物）
 * 输出：
 *   store/index.json                 商店索引（契约见 specs/06-store-publish.md）
 *   store/packages/<id>-<ver>.tbox   插件包
 *   store/icons/<id>.png             插件图标
 *
 * 签名：若设置了环境变量 TOOLBOX_SIGNING_SK（Ed25519 私钥 hex，64 字符），
 * 则为每个插件包计算 sha256 并生成 Ed25519 签名写入索引；
 * 未设置时生成未签名索引（安装时宿主会拒绝 store 来源）。
 *
 * 用法：node scripts/build-store.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { sha256 } from '@noble/hashes/sha256'
import { signAsync } from '@noble/ed25519'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const builtinDir = path.join(root, 'src-tauri', 'builtin')
const storeDir = path.join(root, 'store')

const skHex = process.env.TOOLBOX_SIGNING_SK || null
if (!skHex) {
  console.warn('⚠ 未设置 TOOLBOX_SIGNING_SK，将生成未签名索引（宿主会拒绝商店安装）')
}

async function main() {
  const manifestsPath = path.join(builtinDir, 'manifests.json')
  if (!fs.existsSync(manifestsPath)) {
    console.error('✗ 缺少 src-tauri/builtin/manifests.json，请先运行 npm run build:plugins')
    process.exit(1)
  }
  const { plugins } = JSON.parse(fs.readFileSync(manifestsPath, 'utf8'))

  fs.mkdirSync(path.join(storeDir, 'packages'), { recursive: true })
  fs.mkdirSync(path.join(storeDir, 'icons'), { recursive: true })

  const sk = skHex ? Buffer.from(skHex, 'hex') : null
  const entries = []
  for (const p of plugins) {
    const tboxName = `${p.id}-${p.version}.tbox`
    const srcTbox = path.join(builtinDir, `${p.id}.tbox`)
    const bytes = fs.readFileSync(srcTbox)

    fs.writeFileSync(path.join(storeDir, 'packages', tboxName), bytes)

    const iconSrc = path.join(root, 'plugins', p.id, p.icon ?? 'icon.png')
    if (fs.existsSync(iconSrc)) {
      fs.writeFileSync(path.join(storeDir, 'icons', `${p.id}.png`), fs.readFileSync(iconSrc))
    }

    const actualSha = Buffer.from(sha256(bytes)).toString('hex')
    if (p.sha256 && p.sha256 !== actualSha) {
      throw new Error(`插件 ${p.id} 的 sha256 与构建清单不一致`)
    }

    const entry = {
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      author: p.author,
      apiVersion: p.apiVersion,
      minHostVersion: p.minHostVersion,
      permissions: p.permissions,
      sha256: actualSha,
      size: bytes.length,
      package: `packages/${tboxName}`,
      icon: `icons/${p.id}.png`,
    }

    if (sk) {
      const sig = await signAsync(Buffer.from(actualSha, 'utf8'), sk)
      entry.signature = Buffer.from(sig).toString('hex')
    }

    entries.push(entry)
    console.log(`  ✓ ${entry.id} v${entry.version}（sha256 ${entry.sha256.slice(0, 12)}…${sk ? '，已签名' : ''}）`)
  }

  const index = {
    storeVersion: 1,
    updatedAt: new Date().toISOString(),
    plugins: entries,
  }
  fs.writeFileSync(path.join(storeDir, 'index.json'), JSON.stringify(index, null, 2))
  console.log(`\n✓ 商店站点已生成于 store/（${entries.length} 个插件）`)
  console.log('  发布方式见 specs/06-store-publish.md（GitHub Pages + Gitee 镜像）')
}

main()
