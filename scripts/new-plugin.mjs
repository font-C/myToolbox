#!/usr/bin/env node
/**
 * 新插件脚手架：npm run new-plugin [-- --id=my-tool --name=我的工具]
 * 交互式（无参数时）或按参数在 plugins/ 下生成一个可构建的最小插件骨架，
 * 依赖 @toolbox/plugin-sdk，含 manifest、入口、构建配置与示例代码。
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = path.join(root, 'plugins')

const argOf = (key) => {
  const a = process.argv.find((x) => x.startsWith(`--${key}=`))
  return a ? a.split('=').slice(1).join('=') : null
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (ans) => {
    rl.close()
    resolve(ans.trim())
  }))
}

async function main() {
  const id = argOf('id') || (await ask('插件 id（小写字母/数字/连字符，如 my-tool）：'))
  const name = argOf('name') || (await ask('显示名称（如 我的工具）：')) || id

  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id)) {
    console.error('✗ id 非法：仅允许小写字母/数字/连字符')
    process.exit(1)
  }
  const dir = path.join(pluginsDir, id)
  if (fs.existsSync(dir)) {
    console.error(`✗ 插件已存在：${dir}`)
    process.exit(1)
  }

  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })

  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(
      {
        formatVersion: 1,
        id,
        name,
        description: '（一句话描述这个工具）',
        author: 'Font_C',
        version: '0.1.0',
        apiVersion: 1,
        entry: 'index.html',
        icon: 'icon.png',
        permissions: [],
        window: {
          title: `${name} · 工具箱`,
          width: 900,
          height: 700,
          minWidth: 480,
          minHeight: 480,
        },
      },
      null,
      2
    ) + '\n'
  )

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: `@toolbox/plugin-${id}`,
        private: true,
        version: '0.1.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build' },
        dependencies: { '@toolbox/plugin-sdk': '^1.0.0', vue: '^3.5.13' },
        devDependencies: { '@vitejs/plugin-vue': '^5.2.1', vite: '^6.0.5' },
      },
      null,
      2
    ) + '\n'
  )

  fs.writeFileSync(
    path.join(dir, 'vite.config.js'),
    `import { pluginPreset } from '@toolbox/plugin-sdk/preset'\n\nexport default pluginPreset({ id: '${id}' })\n`
  )

  fs.writeFileSync(
    path.join(dir, 'index.html'),
    `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name} · 工具箱</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`
  )

  fs.writeFileSync(
    path.join(dir, 'src/main.js'),
    `import { createApp } from 'vue'
import App from './App.vue'
import '@toolbox/plugin-sdk/theme.css'

createApp(App).mount('#app')
`
  )

  fs.writeFileSync(
    path.join(dir, 'src/App.vue'),
    `<script setup>
import { ref } from 'vue'
import { toolbox } from '@toolbox/plugin-sdk'

const host = ref('…')
toolbox.getEnv().then((env) => {
  host.value = \`工具箱 v\${env.hostVersion}（\${env.platform}）\`
})
</script>

<template>
  <div class="hello">
    <h1>${name}</h1>
    <p>这是一个插件骨架。宿主环境：{{ host }}</p>
    <p class="tip">开始编写你的工具吧 —— 参考 specs/05-dev-guide.md。</p>
  </div>
</template>

<style scoped>
.hello {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
h1 {
  margin: 0;
}
.tip {
  color: var(--c-text-muted);
  font-size: 13px;
}
</style>
`
  )

  console.log(`✓ 插件骨架已生成：plugins/${id}`)
  console.log('  下一步：')
  console.log(`    1. node scripts/gen-plugin-icons.mjs ${id}   # 生成占位图标`)
  console.log('    2. 编辑 manifest.json 的描述与权限')
  console.log(`    3. npm run build:plugins -- --only=${id}     # 打包为 .tbox`)
  console.log('    4. 调试构建中：插件管理 → 加载开发插件目录（选 plugins/' + id + '）')
}

main()
