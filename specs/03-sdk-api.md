# SDK 参考 · @toolbox/plugin-sdk

> 安装：插件 package.json 中 `"@toolbox/plugin-sdk": "^1.0.0"`（workspace 内自动链接）。

## 一、引入

```js
// API
import { toolbox, useNativeFileDrop, isTauri } from '@toolbox/plugin-sdk'
// 主题（CSS 变量 + .btn/.btn--primary/.input 约定/.spinner + 全屏布局基座）
import '@toolbox/plugin-sdk/theme.css'
```

## 二、toolbox API

### `toolbox.getEnv(): Promise<Env>`

宿主环境信息（结果进程内缓存）。

```ts
interface Env {
  pluginId: string | null   // 当前插件 id（主窗口调用时为 null）
  platform: string          // 'macos' | 'windows' | 'linux'
  hostVersion: string       // 宿主版本，如 "0.3.0"
  apiVersion: number        // 宿主支持的 SDK 契约版本
  assetBase: string         // 插件资源基址（跨平台不同，一般不需要直接用）
}
```

### `toolbox.pickOpenFile(options?): Promise<PickedFile[]>`

打开系统文件选择对话框。**权限：`dialog:open`**。用户取消返回 `[]`。

```ts
interface PickedFile { path: string; name: string; bytes: Uint8Array }
// options
{ filters?: { name: string; extensions: string[] }[], multiple?: boolean }
```

```js
const [file] = await toolbox.pickOpenFile({
  filters: [{ name: '图片', extensions: ['png', 'jpg'] }],
  multiple: false,
})
```

### `toolbox.pickSaveFile(options): Promise<string | null>`

打开保存对话框并（可选）写盘。**权限：`dialog:save` + `fs:write`**。用户取消返回 `null`。

```ts
{
  defaultName?: string,                       // 建议文件名
  filters?: { name: string; extensions: string[] }[],
  bytes?: Uint8Array | ArrayBuffer | null,    // 提供则写盘成功后返回路径
}
```

### `toolbox.readGranted(path): Promise<Uint8Array>`

读取**已授权路径**。**权限：`fs:read`**。未授权或路径失效时抛错。
典型用途：拖拽 drop 事件拿到路径后读取内容。

### `toolbox.printPdf(bytes, options?): Promise<void>`

调起系统打印（PDF 字节）。**权限：`print`**。macOS 走 PDFKit，Windows 走 pdfium+GDI，
每页按比例缩放适配单张纸并居中；其它平台返回明确错误。

```ts
// options
{ name?: string } // 可选文档名：用于打印临时文件名与打印队列展示，
                  // 宿主清洗特殊字符（保留中英文/数字/-/_），缺省用插件 id
```

### `toolbox.readClipboardText(): Promise<string | null>`

读取系统剪贴板文本。**权限：`clipboard:read`**。剪贴板为空或不含文本时返回 `null`。

### `toolbox.writeClipboardText(text: string): Promise<void>`

写入系统剪贴板文本。**权限：`clipboard:write`**。

### `toolbox.compressPdf(bytes: Uint8Array, preset?: 'light'|'recommended'|'extreme'): Promise<Uint8Array>`

压缩 PDF。**权限：`pdf:optimize`**。宿主内置内核重编码内嵌图像（有损，三档
对应不同分辨率/质量组合）并重压缩未压缩的内容流；文字保持矢量可选中。
文档没有（或很少有）图像时收益有限。预设缺省 `recommended`。

### `toolbox.encryptPdf(bytes: Uint8Array, options): Promise<Uint8Array>`

为 PDF 设置打开密码。**权限：`pdf:crypt`**。AES-256（PDF 2.0 标准 V5/R6 安全处理器），
与 Adobe / Chrome / macOS 预览等互通。

```ts
{ userPassword: string, ownerPassword?: string } // ownerPassword 缺省与 userPassword 相同
```

### `toolbox.unlockPdf(bytes: Uint8Array, password: string): Promise<Uint8Array>`

去除 PDF 打开密码。**权限：`pdf:crypt`**。支持 RC4 / AES-128 / AES-256 标准加密；
密码错误或加密方式不支持时 rejected。

### `toolbox.onDragDrop(handlers): () => void`

监听原生文件拖拽（在 Tauri 容器内；纯浏览器返回空函数）。
drop 的文件路径已由宿主自动记入授权表，配合 `readGranted` 使用。

```ts
{
  onEnter?: (files: { path: string; name: string }[]) => void,
  onOver?: () => void,
  onLeave?: () => void,
  onDrop?: (files: { path: string; name: string }[]) => void,
}
```

### `toolbox.storageGet(key): Promise<any>`

读取本插件持久化 KV。**权限：`storage`**。键不存在返回 `null`。

### `toolbox.storageSet(key, value): Promise<void>`

写入键值并立即落盘（应用重启后仍在）。**权限：`storage`**。
值为可 JSON 序列化的任意数据；超出限额（单值 1MB / 每插件总量 10MB /
键数 1000 / 键长 256）时 rejected。数据按插件强隔离，卸载插件时一并删除。

### `toolbox.storageRemove(key): Promise<void>`

删除键。**权限：`storage`**。键不存在时静默成功。

### `toolbox.storageKeys(): Promise<string[]>`

列出本插件全部键（字典序）。**权限：`storage`**。

### `toolbox.storageClear(): Promise<void>`

清空本插件全部数据。**权限：`storage`**。

```js
// 典型用法：配置持久化（启动时恢复、变更时写回）
onMounted(async () => {
  const saved = await toolbox.storageGet('config')
  if (saved) Object.assign(config, saved)
})
watch(config, (v) => toolbox.storageSet('config', v).catch(() => {}), { deep: true })
```

### `toolbox.close(): Promise<void>`

关闭本插件窗口。

### `toolbox.pluginId: string | null`

当前插件 id（来自 URL 路径，与窗口 label 对应）。

## 三、组件级 composable

### `useNativeFileDrop({ onFiles, onDragState })`

封装 `toolbox.onDragDrop`：drop 的文件自动读取字节并还原为 `File` 对象回调 `onFiles`；
`onDragState(true/false)` 对应进入/离开。返回解绑函数（组件 `onUnmounted` 时调用）。

```js
onMounted(() => {
  stop = useNativeFileDrop({
    onFiles: (files) => handleFiles(files),
    onDragState: (v) => (dragging.value = v),
  })
})
onUnmounted(() => stop?.())
```

## 四、theme.css 提供的基座

- 设计变量：`--c-primary / --c-primary-hover / --c-text / --c-text-muted / --c-border /
  --c-bg / --c-surface / --c-danger / --radius / --shadow`
- 布局基座：`html, body, #app { height: 100% }`（插件页面直接铺满窗口）
- 通用控件：`.btn`、`.btn--primary`、`.btn:disabled`、`.spinner`（含旋转动画）
- 字体栈与背景色与宿主一致

约定：`<input class="input">` 样式由插件自带（各工具样式差异大，未纳入 SDK）。

## 五、错误处理约定

所有 API 失败都以 **rejected Promise** 表达，错误消息为面向开发者的中文字符串，
插件应 catch 并转成 UI 提示（toast/表单错误），不得静默吞掉。
