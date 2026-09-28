# 权限规范 · 权限目录与授权模型

> 插件在 manifest 的 `permissions` 中声明能力，宿主 broker 在运行时逐命令校验。
> 原则：**只声明实际用到的**。商店页会把权限原样展示给用户。

## 一、权限目录（v1）

| 权限 | 说明 | 关联的 broker 命令 |
|---|---|---|
| `dialog:open` | 打开系统文件选择对话框 | `broker_open_file` |
| `dialog:save` | 打开系统保存对话框 | `broker_save_file` |
| `fs:read` | 读取**已授权路径**的文件内容 | `broker_read_granted` |
| `fs:write` | 向**保存对话框选定的路径**写文件 | `broker_save_file`（写盘部分） |
| `print` | 调起系统打印（当前支持 PDF 字节） | `broker_print` |
| `pdf:optimize` | 调用宿主内置 PDF 压缩内核（图像重编码） | `broker_compress_pdf` |
| `pdf:crypt` | 调用宿主内置 PDF 加密/解锁内核（标准安全处理器） | `broker_encrypt_pdf`、`broker_unlock_pdf` |
| `clipboard:read` | 读取系统剪贴板文本（空/非文本返回 null） | `broker_clipboard_read_text` |
| `clipboard:write` | 写入系统剪贴板文本 | `broker_clipboard_write_text` |

> `pdf:*` 权限只作用于**以字节传入的 PDF 数据**（来源仍须是用户授权的文件），
> 不涉及任何路径访问；宿主处理在本地线程池完成，数据不落盘、不出网。

> `dialog:open` 返回的文件**直接带出字节**，无需再申请 `fs:read`；
> `fs:read` 用于「稍后重新读取之前授权过的路径」（例如拖拽文件先记路径、点导出时再读）。

### 明确不存在的权限（v1）

- **网络**（`net:*`）：插件页 CSP 禁止一切远程请求，插件必须离线自足
- **剪贴板 / 通知 / 系统设置 / 进程**：无
- **任意路径读写**：设计上不存在。文件访问永远经由用户动作授权

## 二、授权模型（fs:read / fs:write 的边界）

「已授权路径」在会话内由三种**用户动作**产生：

| 动作 | 授权内容 |
|---|---|
| `toolbox.pickOpenFile(...)` 用户选中文件 | 选中路径（返回值直接含字节，且路径入授权表） |
| `toolbox.pickSaveFile(...)` 用户确认保存位置 | 目标路径（可用 `fs:write` 覆写、`fs:read` 回读） |
| 用户把文件**拖入插件窗口** | 被拖入的路径（宿主 Rust 侧自动记录，JS 无法伪造） |

授权表按插件隔离、窗口关闭即清空；重启后需要重新授权。
路径比较在 Rust 侧做词法规范化（处理 `.`/`..`），并拒绝越界访问。

## 三、申请建议

- 纯界面工具（计算器、生成器）：`permissions: []`
- 需要导入文件：一般 `["fs:read"]`（配合拖拽/文件输入）；不需要打开对话框时不要申请 `dialog:open`
- 需要导出/保存：`["dialog:save", "fs:write"]`
- 需要打印：`["print"]`
- 调用宿主 PDF 处理内核：`["pdf:optimize"]`（压缩）/ `["pdf:crypt"]`（加密、解锁）
- 读写系统剪贴板：`["clipboard:read"]` / `["clipboard:write"]`（剪贴板历史等工具）

## 四、运行时违规的表现

- 未声明权限即调用对应 API：invoke 返回错误
  `权限不足：插件「<id>」未声明「<perm>」。请在 manifest.json 的 permissions 中声明后重新安装`
- 读取未授权路径：`路径未授权：<path>。请通过文件对话框或拖拽导入`
