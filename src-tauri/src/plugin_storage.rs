//! 插件持久化 KV 存储（specs/02/03）。
//!
//! 动机：插件窗口跑在自定义协议（plugin://）下，webview 的
//! localStorage/sessionStorage 不可靠（macOS WKWebView 对自定义协议不保证
//! 持久化，插件代码里已多处注释确认），插件数据随窗口销毁而丢失。
//! 宿主在此提供按插件隔离的持久化 KV：数据落 `appData/plugin-data/<id>.json`。
//!
//! 安全模型（与 broker 一致）：
//! 1. 插件身份取自调用窗口 label（`plugin-<id>`），不由参数声明——无法冒充他人
//! 2. manifest 必须声明 `storage` 权限，否则拒绝
//! 3. id 复用 manifest 白名单校验，杜绝路径注入
//!
//! 实现策略：内存缓存 + 写穿透（每次写操作原子落盘）。写频率低（表单/配置/
//! 项目数据级），无需防抖合并；限额防滥用（单值 1MB / 每插件总量 10MB /
//! 键数 1000 / 键长 256）。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::broker::{plugin_ctx, require_perm};

const MAX_VALUE_BYTES: usize = 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 10 * 1024 * 1024;
const MAX_KEYS: usize = 1000;
const MAX_KEY_BYTES: usize = 256;

/// 某插件的存储数据：键值表 + 数据文件路径
struct PluginStoreData {
    map: HashMap<String, Value>,
    path: PathBuf,
}

/// 全局存储状态：plugin_id → 数据（setup 前由 lib.rs manage 默认值）
#[derive(Default)]
pub struct PluginStorage(Mutex<HashMap<String, PluginStoreData>>);

/// manifest 白名单口径的 id 校验（防路径注入的第二道闸）
fn id_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 48
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn data_file(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?
        .join("plugin-data");
    Ok(dir.join(format!("{id}.json")))
}

/// 从磁盘加载（文件缺失 = 空表；损坏则重置为空——插件数据可容忍重建，
/// 但不能让整个存储子系统不可用）。
fn load_from_disk(id: &str, path: &std::path::Path) -> HashMap<String, Value> {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|e| {
            crate::plugin_installer::log::err(&format!(
                "plugin-data/{id}.json 解析失败（{e}），已重置为空"
            ));
            HashMap::new()
        }),
        Err(_) => HashMap::new(),
    }
}

fn value_size(v: &Value) -> usize {
    serde_json::to_string(v).map(|s| s.len()).unwrap_or(0)
}

fn atomic_write(path: &std::path::Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, contents).map_err(|e| format!("写入 {} 失败: {e}", path.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("替换 {} 失败: {e}", path.display()))?;
    Ok(())
}

/// 取该插件的键值表（懒加载：首次访问时读盘），执行 `f`。
/// `f` 返回 Ok 后写穿透落盘（保证缓存与磁盘一致）。
fn with_store<T, F>(app: &AppHandle, id: &str, persist: bool, f: F) -> Result<T, String>
where
    F: FnOnce(&mut HashMap<String, Value>) -> Result<T, String>,
{
    if !id_ok(id) {
        return Err("非法插件标识".into());
    }
    let path = data_file(app, id)?;
    let state = app.state::<PluginStorage>();
    let mut table = state.0.lock().unwrap_or_else(|p| p.into_inner());
    let entry = table.entry(id.to_string()).or_insert_with(|| PluginStoreData {
        map: load_from_disk(id, &path),
        path,
    });
    let result = f(&mut entry.map)?;
    if persist {
        let json =
            serde_json::to_string_pretty(&entry.map).map_err(|e| format!("序列化失败: {e}"))?;
        atomic_write(&entry.path, &json)?;
    }
    Ok(result)
}

/// 校验键约束（长度 + 非空）
fn check_key(key: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("键不能为空".into());
    }
    if key.len() > MAX_KEY_BYTES {
        return Err(format!("键长度超过 {MAX_KEY_BYTES} 字节上限"));
    }
    Ok(())
}

// ---------- 命令（插件窗口调用） ----------

/// 读取键值（不存在返回 null）
#[tauri::command]
pub fn broker_storage_get(window: WebviewWindow, key: String) -> Result<Value, String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "storage")?;
    check_key(&key)?;
    let app = window.app_handle().clone();
    with_store(&app, &ctx.id, false, |map| {
        Ok(map.get(&key).cloned().unwrap_or(Value::Null))
    })
}

/// 写入键值（值为任意 JSON）。受单值/总量/键数限额约束。
#[tauri::command]
pub fn broker_storage_set(window: WebviewWindow, key: String, value: Value) -> Result<(), String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "storage")?;
    check_key(&key)?;
    let app = window.app_handle().clone();
    with_store(&app, &ctx.id, true, |map| {
        let new_size = value_size(&value);
        if new_size > MAX_VALUE_BYTES {
            return Err(format!("单值超过 {}MB 上限", MAX_VALUE_BYTES / 1024 / 1024));
        }
        let is_new = !map.contains_key(&key);
        if is_new && map.len() >= MAX_KEYS {
            return Err(format!("键数量超过 {MAX_KEYS} 上限"));
        }
        let old = map.insert(key.clone(), value.clone());
        // 总量超限则回滚插入，保持内存与磁盘一致
        let total: usize = map.values().map(value_size).sum();
        if total > MAX_TOTAL_BYTES {
            match old {
                Some(v) => {
                    map.insert(key, v);
                }
                None => {
                    map.remove(&key);
                }
            }
            return Err(format!("存储总量超过 {}MB 上限", MAX_TOTAL_BYTES / 1024 / 1024));
        }
        Ok(())
    })
}

/// 删除键（键不存在时静默成功）
#[tauri::command]
pub fn broker_storage_remove(window: WebviewWindow, key: String) -> Result<(), String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "storage")?;
    check_key(&key)?;
    let app = window.app_handle().clone();
    with_store(&app, &ctx.id, true, |map| {
        map.remove(&key);
        Ok(())
    })
}

/// 列出全部键（按字典序）
#[tauri::command]
pub fn broker_storage_keys(window: WebviewWindow) -> Result<Vec<String>, String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "storage")?;
    let app = window.app_handle().clone();
    with_store(&app, &ctx.id, false, |map| {
        let mut keys: Vec<String> = map.keys().cloned().collect();
        keys.sort();
        Ok(keys)
    })
}

/// 清空本插件全部数据
#[tauri::command]
pub fn broker_storage_clear(window: WebviewWindow) -> Result<(), String> {
    let ctx = plugin_ctx(&window)?;
    require_perm(&ctx, "storage")?;
    let app = window.app_handle().clone();
    with_store(&app, &ctx.id, true, |map| {
        map.clear();
        Ok(())
    })
}

/// 卸载插件时清除其持久化数据（plugin_installer 调用）。
pub fn delete_plugin_data(app: &AppHandle, id: &str) {
    if let Ok(path) = data_file(app, id) {
        if let Err(e) = std::fs::remove_file(&path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                crate::plugin_installer::log::err(&format!(
                    "删除插件数据 {} 失败: {e}",
                    path.display()
                ));
            }
        }
    }
    if let Some(state) = app.try_state::<PluginStorage>() {
        state.0.lock().unwrap_or_else(|p| p.into_inner()).remove(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_validation() {
        assert!(id_ok("course-scheduler"));
        assert!(id_ok("pdf-crop"));
        assert!(!id_ok(""));
        assert!(!id_ok("../evil"));
        assert!(!id_ok("Foo"));
        assert!(!id_ok("a b"));
        assert!(!id_ok(&"a".repeat(49)));
    }
}
