//! 权限代理（broker）：插件窗口访问系统能力的唯一通道。
//!
//! 安全模型：
//! 1. 插件身份取自调用窗口 label（`plugin-<id>`），不由参数声明——插件无法冒充他人
//! 2. 每个命令先校验插件 manifest 声明的权限，再校验路径授权
//! 3. 路径授权来源只有三种用户动作：打开对话框选中、保存对话框目标、向窗口拖入文件
//!    （拖拽路径由宿主在 Rust 侧的窗口事件中记录，插件 JS 无法伪造）。
//!    授权对象可以是目录（见 broker_dir）：目录之下的文件随目录一并放行
//! 4. 插件窗口关闭时清空其全部授权

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, DragDropEvent, Manager, WebviewWindow, WindowEvent};
use tauri_plugin_dialog::DialogExt;

use crate::plugin_manifest::PluginManifest;
use crate::plugin_registry::{resolve_manifest, PLUGIN_LABEL_PREFIX};

/// 词法路径规范化（处理 . / ..，不触碰文件系统）
pub fn normalize_path(p: &std::path::Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// 会话授权表：plugin_id → 已授权路径集合
#[derive(Default)]
pub struct GrantState(pub Mutex<HashMap<String, HashSet<PathBuf>>>);

pub fn grant_paths_for_drop(window_label: &str, paths: &[PathBuf], grants: &GrantState) {
    if let Some(id) = window_label.strip_prefix(PLUGIN_LABEL_PREFIX) {
        let mut table = grants.0.lock().unwrap_or_else(|p| p.into_inner());
        let set = table.entry(id.to_string()).or_default();
        for p in paths {
            set.insert(normalize_path(p));
        }
    }
}

pub fn clear_grants_for(window_label: &str, grants: &GrantState) {
    if let Some(id) = window_label.strip_prefix(PLUGIN_LABEL_PREFIX) {
        grants.0.lock().unwrap_or_else(|p| p.into_inner()).remove(id);
    }
}

/// 主窗口全局窗口事件钩子（lib.rs 注册）：记录拖拽授权、清理关闭窗口的授权。
pub fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    let label = window.label().to_string();
    if !label.starts_with(PLUGIN_LABEL_PREFIX) {
        return;
    }
    match event {
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
            let app: AppHandle = window.app_handle().clone();
            if let Some(grants) = app.try_state::<GrantState>() {
                grant_paths_for_drop(&label, paths, &grants);
            }
        }
        WindowEvent::Destroyed => {
            let app: AppHandle = window.app_handle().clone();
            if let Some(grants) = app.try_state::<GrantState>() {
                clear_grants_for(&label, &grants);
            }
        }
        _ => {}
    }
}

// ---------- 内部工具 ----------

pub(crate) struct PluginCtx {
    pub id: String,
    pub manifest: PluginManifest,
}

/// 从调用窗口解析插件身份。非插件窗口调用 broker 命令一律拒绝。
pub(crate) fn plugin_ctx(window: &WebviewWindow) -> Result<PluginCtx, String> {
    let id = window
        .label()
        .strip_prefix(PLUGIN_LABEL_PREFIX)
        .ok_or("broker 命令仅限插件窗口调用")?
        .to_string();
    let manifest = resolve_manifest(&window.app_handle(), &id)?;
    Ok(PluginCtx { id, manifest })
}

pub(crate) fn require_perm(ctx: &PluginCtx, perm: &str) -> Result<(), String> {
    if ctx.manifest.permissions.iter().any(|p| p == perm) {
        Ok(())
    } else {
        Err(format!(
            "权限不足：插件「{}」未声明「{perm}」。请在 manifest.json 的 permissions 中声明后重新安装",
            ctx.id
        ))
    }
}

pub(crate) fn is_granted(app: &AppHandle, id: &str, path: &std::path::Path) -> bool {
    let grants = app.state::<GrantState>();
    let table = grants.0.lock().unwrap_or_else(|p| p.into_inner());
    let Some(set) = table.get(id) else { return false };
    if set.contains(path) {
        return true;
    }
    // 目录授权：目标路径位于某个已授权目录之下时同样放行（目录经用户对话框/拖拽授权）
    set.iter().any(|g| g != path && g.is_dir() && path.starts_with(g))
}

pub(crate) fn grant_path(app: &AppHandle, id: &str, path: &std::path::Path) {
    let grants = app.state::<GrantState>();
    grants
        .0
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .entry(id.to_string())
        .or_default()
        .insert(normalize_path(path));
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    pub path: String,
    pub name: String,
    pub bytes: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// 把 JS 传来的 filters 应用到对话框构建器
fn apply_filters<R: tauri::Runtime>(
    builder: tauri_plugin_dialog::FileDialogBuilder<R>,
    filters: &Option<Vec<DialogFilter>>,
) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    let mut builder = builder;
    if let Some(list) = filters {
        for f in list {
            let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            builder = builder.add_filter(f.name.clone(), &exts);
        }
    }
    builder
}

pub(crate) fn file_path_to_buf(p: tauri_plugin_dialog::FilePath) -> Result<PathBuf, String> {
    match p {
        tauri_plugin_dialog::FilePath::Url(url) => url
            .to_file_path()
            .map_err(|_| format!("文件地址无法转换为路径: {url}")),
        tauri_plugin_dialog::FilePath::Path(p) => Ok(p),
    }
}

// ---------- 命令 ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvInfo {
    pub plugin_id: Option<String>,
    pub platform: String,
    pub host_version: String,
    pub api_version: u32,
    /// 主窗口展示插件资源用的基址（plugin://localhost 或 http://plugin.localhost）
    pub asset_base: String,
}

/// 宿主环境信息（主窗口与插件窗口均可调用）。
#[tauri::command]
pub fn broker_env(window: WebviewWindow) -> EnvInfo {
    let plugin_id = window.label().strip_prefix(PLUGIN_LABEL_PREFIX).map(|s| s.to_string());
    EnvInfo {
        plugin_id,
        platform: std::env::consts::OS.into(),
        host_version: env!("CARGO_PKG_VERSION").into(),
        api_version: crate::plugin_manifest::HOST_API_VERSION,
        asset_base: crate::plugin_protocol::asset_base(),
    }
}

/// 打开文件对话框（需 dialog:open）。返回选中文件（含字节），路径记入授权表。
/// 注意：必须为 async——同步命令在主线程执行，blocking_* 对话框会把主线程饿死（面板假死）。
#[tauri::command]
pub async fn broker_open_file(
    window: WebviewWindow,
    filters: Option<Vec<DialogFilter>>,
    multiple: Option<bool>,
) -> Result<Vec<PickedFile>, String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "dialog:open")?;
    let app = window.app_handle().clone();

    let builder = apply_filters(app.dialog().file(), &filters);
    let picked = if multiple.unwrap_or(false) {
        builder.blocking_pick_files().unwrap_or_default()
    } else {
        builder.blocking_pick_file().into_iter().collect()
    };

    let mut out = Vec::new();
    for fp in picked {
        let path = file_path_to_buf(fp)?;
        grant_path(&app, &ctx.id, &path);
        let bytes = std::fs::read(&path).map_err(|e| format!("读取 {} 失败: {}", path.display(), e))?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        out.push(PickedFile { path: path.to_string_lossy().to_string(), name, bytes });
    }
    Ok(out)
}

/// 保存文件对话框（需 dialog:save 与 fs:write）。提供 bytes 时写盘成功后返回路径。
/// 注意：必须为 async，理由同 broker_open_file。
#[tauri::command]
pub async fn broker_save_file(
    window: WebviewWindow,
    default_name: Option<String>,
    filters: Option<Vec<DialogFilter>>,
    bytes: Option<Vec<u8>>,
) -> Result<Option<String>, String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "dialog:save")?;
    require_perm(&ctx, "fs:write")?;
    let app = window.app_handle().clone();

    let mut builder = apply_filters(app.dialog().file(), &filters);
    if let Some(name) = default_name {
        builder = builder.set_file_name(name);
    }
    let picked = builder.blocking_save_file();
    let Some(fp) = picked else {
        return Ok(None); // 用户取消
    };
    let path = file_path_to_buf(fp)?;
    grant_path(&app, &ctx.id, &path);

    if let Some(bytes) = bytes {
        std::fs::write(&path, &bytes)
            .map_err(|e| format!("写入 {} 失败: {}", path.display(), e))?;
    }
    Ok(Some(path.to_string_lossy().to_string()))
}

/// 读取已授权路径（需 fs:read）。路径必须在本插件的会话授权表中。
/// 注意：必须为 async——大文件读取在同步命令里会阻塞主线程，冻结全部窗口。
#[tauri::command]
pub async fn broker_read_granted(window: WebviewWindow, path: String) -> Result<Vec<u8>, String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "fs:read")?;
    let app = window.app_handle().clone();

    let normalized = normalize_path(&PathBuf::from(&path));
    if !is_granted(&app, &ctx.id, &normalized) {
        return Err(format!("路径未授权：{path}。请通过文件对话框或拖拽导入"));
    }
    run_blocking(move || std::fs::read(&normalized).map_err(|e| format!("读取 {path} 失败: {e}"))).await
}

/// 打印（需 print）。当前支持 PDF 字节；`name` 为可选文档名（用于临时文件名
/// 与打印队列展示），缺省用插件 id。
/// 注意：必须为 async——打印会阻塞到用户处理完打印对话框，不能占住主线程。
#[tauri::command]
pub async fn broker_print(
    window: WebviewWindow,
    bytes: Vec<u8>,
    name: Option<String>,
) -> Result<(), String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "print")?;
    let app = window.app_handle().clone();
    let doc_name = name.unwrap_or(ctx.id.clone());
    run_blocking(move || crate::print::print_pdf_impl(&app, bytes, &doc_name)).await
}

// ---------- PDF 处理（CPU 密集，统一放线程池执行，避免卡 UI） ----------

/// 把 CPU 密集任务放到阻塞线程池，结果以 rejected Promise 形式返回错误。
pub(crate) async fn run_blocking<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| format!("后台任务执行失败: {e}"))?
}

/// 压缩 PDF（需 pdf:optimize）。preset: light / recommended / extreme。
#[tauri::command]
pub async fn broker_compress_pdf(
    window: WebviewWindow,
    bytes: Vec<u8>,
    preset: Option<String>,
) -> Result<Vec<u8>, String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "pdf:optimize")?;
    let preset = crate::pdfops::CompressPreset::parse(preset.as_deref())?;
    run_blocking(move || crate::pdfops::compress_pdf(&bytes, preset)).await
}

/// 加密 PDF（需 pdf:crypt）。设置打开密码（AES-256），ownerPassword 缺省与打开密码相同。
#[tauri::command]
pub async fn broker_encrypt_pdf(
    window: WebviewWindow,
    bytes: Vec<u8>,
    user_password: String,
    owner_password: Option<String>,
) -> Result<Vec<u8>, String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "pdf:crypt")?;
    run_blocking(move || crate::pdfops::encrypt_pdf(&bytes, &user_password, owner_password.as_deref())).await
}

/// 解锁 PDF（需 pdf:crypt）。去除打开密码（支持 RC4 / AES-128 / AES-256）。
#[tauri::command]
pub async fn broker_unlock_pdf(window: WebviewWindow, bytes: Vec<u8>, password: String) -> Result<Vec<u8>, String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "pdf:crypt")?;
    run_blocking(move || crate::pdfops::unlock_pdf(&bytes, &password)).await
}

// ---------- 剪贴板 ----------

/// 读取系统剪贴板文本（需 clipboard:read）。剪贴板为空或不含文本时返回 None。
#[tauri::command]
pub async fn broker_clipboard_read_text(window: WebviewWindow) -> Result<Option<String>, String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "clipboard:read")?;
    run_blocking(move || {
        let mut cb = arboard::Clipboard::new().map_err(|e| format!("打开系统剪贴板失败: {e}"))?;
        match cb.get_text() {
            Ok(t) => Ok(Some(t)),
            Err(arboard::Error::ContentNotAvailable) => Ok(None),
            Err(e) => Err(format!("读取剪贴板失败: {e}")),
        }
    })
    .await
}

/// 写入系统剪贴板文本（需 clipboard:write）。
#[tauri::command]
pub async fn broker_clipboard_write_text(window: WebviewWindow, text: String) -> Result<(), String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "clipboard:write")?;
    run_blocking(move || {
        let mut cb = arboard::Clipboard::new().map_err(|e| format!("打开系统剪贴板失败: {e}"))?;
        cb.set_text(text).map_err(|e| format!("写入剪贴板失败: {e}"))
    })
    .await
}
