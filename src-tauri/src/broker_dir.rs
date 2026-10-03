//! 目录级访问（broker 扩展）：选择目录入授权表 + 递归列出已授权目录下的文件。
//!
//! 安全模型与 broker 一致：
//! - 目录只能经用户「选择目录」对话框授权，或经拖拽入窗（grant_paths_for_drop 对目录同样生效）
//! - 列目录前校验授权：精确路径命中，或位于某个已授权目录之下（见 broker::is_granted）
//! - 遍历跳过符号链接（防环），限制最大深度与文件数（超出以 truncated 标记）

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::broker::{
    file_path_to_buf, grant_path, is_granted, normalize_path, plugin_ctx, require_perm, run_blocking,
};

const MAX_DEPTH: usize = 32;
const MAX_FILES: usize = 20_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedDir {
    pub path: String,
    pub name: String,
}

/// 选择目录（需 dialog:open）。目录路径记入授权表：其下所有文件随之可读（fs:read）。
/// 注意：必须为 async，理由同 broker_open_file（blocking 对话框不能占主线程）。
#[tauri::command]
pub async fn broker_pick_directory(window: WebviewWindow) -> Result<Option<PickedDir>, String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "dialog:open")?;
    let app: AppHandle = window.app_handle().clone();

    let picked = app.dialog().file().blocking_pick_folder();
    let Some(fp) = picked else {
        return Ok(None); // 用户取消
    };
    let path: PathBuf = file_path_to_buf(fp)?;
    if !path.is_dir() {
        return Err(format!("所选路径不是目录：{}", path.display()));
    }
    grant_path(&app, &ctx.id, &path);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(Some(PickedDir {
        path: path.to_string_lossy().to_string(),
        name,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    /// 相对根目录的路径（正斜杠分隔）
    pub path: String,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub entries: Vec<DirEntryInfo>,
    /// 文件数超出上限被截断
    pub truncated: bool,
}

/// 递归列出已授权目录下的全部文件（需 fs:read）。跳过符号链接；按相对路径排序。
#[tauri::command]
pub async fn broker_list_dir(window: WebviewWindow, path: String) -> Result<DirListing, String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "fs:read")?;
    let app = window.app_handle().clone();

    let normalized = normalize_path(&PathBuf::from(&path));
    if !is_granted(&app, &ctx.id, &normalized) {
        return Err(format!("路径未授权：{path}。请先通过「选择目录」或拖拽导入"));
    }
    run_blocking(move || list_dir_impl(&normalized)).await
}

fn list_dir_impl(root: &Path) -> Result<DirListing, String> {
    if !root.is_dir() {
        return Err(format!("不是目录：{}", root.display()));
    }
    let mut entries = Vec::new();
    let mut truncated = false;
    walk_dir(root, root, &mut entries, &mut truncated, 0);
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(DirListing { entries, truncated })
}

fn walk_dir(root: &Path, dir: &Path, out: &mut Vec<DirEntryInfo>, truncated: &mut bool, depth: usize) {
    if *truncated || depth > MAX_DEPTH {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return; // 无权限/已消失的子目录：静默跳过
    };
    for entry in rd.flatten() {
        if *truncated {
            return;
        }
        let Ok(ft) = entry.file_type() else { continue }; // 不跟随符号链接
        let p = entry.path();
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            walk_dir(root, &p, out, truncated, depth + 1);
        } else if ft.is_file() {
            if out.len() >= MAX_FILES {
                *truncated = true;
                return;
            }
            let rel = p
                .strip_prefix(root)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/");
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(DirEntryInfo { path: rel, size });
        }
    }
}

/// 供插件在拖拽后判断拖入的是否为目录（已授权目录才可列取）。
#[tauri::command]
pub async fn broker_dir_info(window: WebviewWindow, path: String) -> Result<Option<DirListing>, String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "fs:read")?;
    let app = window.app_handle().clone();

    let normalized = normalize_path(&PathBuf::from(&path));
    if !is_granted(&app, &ctx.id, &normalized) || !normalized.is_dir() {
        return Ok(None);
    }
    run_blocking(move || list_dir_impl(&normalized).map(Some)).await
}
