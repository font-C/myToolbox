# manifest 规范 · 插件清单

> 每个插件包根目录必须有 `manifest.json`，受 [manifest.schema.json](./manifest.schema.json) 约束。

## 一、完整示例

```json
{
  "formatVersion": 1,
  "id": "pdf-crop",
  "name": "PDF 裁剪",
  "description": "框选裁剪 PDF 页面",
  "author": "Font_C",
  "version": "0.3.0",
  "apiVersion": 1,
  "entry": "index.html",
  "icon": "icon.png",
  "permissions": ["dialog:save", "fs:write", "fs:read", "print"],
  "window": {
    "title": "PDF 裁剪 · 工具箱",
    "width": 1100,
    "height": 800,
    "minWidth": 760,
    "minHeight": 600,
    "resizable": true
  },
  "minHostVersion": "0.3.0"
}
```

## 二、字段说明

### 必填字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `formatVersion` | number | 包格式版本，当前恒为 `1` |
| `id` | string | 插件唯一标识。`/^[a-z0-9][a-z0-9-]{1,47}$/`（小写字母/数字/连字符）。上架后不可更改 |
| `name` | string | 显示名称（中文 UI 建议 ≤ 8 字，启动台网格空间有限） |
| `version` | string | 插件版本，`x.y.z` 数字格式（忽略预发布后缀）。升级判断依据 |
| `apiVersion` | number | 依赖的 SDK 契约版本。宿主只加载 `apiVersion ≤ 自身支持值` 的插件 |

### 推荐字段

| 字段 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `description` | string | `""` | 一句话描述，显示在启动台/商店 |
| `author` | string | `""` | 作者/出品方 |
| `entry` | string | `"index.html"` | 入口 HTML，包内相对路径，禁止 `..` 与绝对路径 |
| `icon` | string | `"icon.png"` | 图标文件路径。要求 256×256 PNG |
| `permissions` | string[] | `[]` | 声明需要的能力，见 [02-permissions.md](./02-permissions.md)。**只声明实际用到的** |
| `window` | object | 见下 | 插件窗口外观 |

### `window` 子字段（全部可选）

| 字段 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `title` | string | name | 窗口标题 |
| `width` / `height` | number | 1100 / 800 | 初始窗口尺寸（逻辑像素） |
| `minWidth` / `minHeight` | number | 480 / 480 | 最小尺寸 |
| `resizable` | boolean | true | 是否允许缩放 |

### 其它

| 字段 | 类型 | 说明 |
|---|---|---|
| `minHostVersion` | string | 要求的宿主最低版本。低于此版本时宿主拒绝加载并提示升级 |

## 三、校验规则（宿主强制）

1. `formatVersion ≠ 1` → 拒绝安装
2. `apiVersion > HOST_API_VERSION` → 拒绝安装
3. `id` 不符合正则、`version`/`minHostVersion` 非 `x.y.z`、未知权限、`entry`/`icon` 含 `..` 或绝对路径 → 拒绝安装
4. 包内缺少 `manifest.json` / `entry` / `icon` 对应文件 → 拒绝安装
5. 开发模式（`plugin_dev_register`）同样走字段校验，但不检查 icon 存在性（本地迭代友好）

## 四、命名建议

- `id` 用工具的英文语义名：`pdf-merge`、`qr-gen`、`unit-convert`
- 面向商店展示时 `name` 用中文、`description` 一句话讲清用途
- 同一作者系列的插件保持前缀一致（如 `font-*`）便于在商店聚合
