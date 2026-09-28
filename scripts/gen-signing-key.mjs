#!/usr/bin/env node
/**
 * 商店签名密钥生成脚本（只需运行一次）。
 *
 * 产出：
 *  - .secrets/store-signing-key.hex   私钥（绝不入库、不上传；CI 中放入 secret ED25519_SIGNING_SK）
 *  - stdout 打印公钥 hex（更新到 src-tauri/src/plugin_installer.rs 的 STORE_PUBKEY_HEX）
 *
 * 轮换：重新生成本地密钥 → 应用侧发版更新公钥 → 商店索引用新钥签名。
 */
import fs from 'node:fs'
import path from 'node:path'
import { getPublicKeyAsync, utils } from '@noble/ed25519'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const secretsDir = path.join(root, '.secrets')

fs.mkdirSync(secretsDir, { recursive: true })
const keyPath = path.join(secretsDir, 'store-signing-key.hex')
if (fs.existsSync(keyPath)) {
  console.error('✗ 私钥已存在：.secrets/store-signing-key.hex（如需轮换请先手动删除）')
  process.exit(1)
}

const sk = utils.randomPrivateKey()
const pk = await getPublicKeyAsync(sk)

fs.writeFileSync(keyPath, Buffer.from(sk).toString('hex') + '\n', { mode: 0o600 })

console.log('✓ 私钥已写入 .secrets/store-signing-key.hex（已 gitignore，勿外传）')
console.log('')
console.log('公钥 hex（更新到 src-tauri/src/plugin_installer.rs 的 STORE_PUBKEY_HEX）：')
console.log(Buffer.from(pk).toString('hex'))
