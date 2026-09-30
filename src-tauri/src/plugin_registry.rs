//! 已安装插件注册表：appData/plugins/installed.json 的加载/持久化与查询。
//! 同时维护开发模式插件表（仅 debug 构建）与插件窗口的打开逻辑。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

use crate::plugin_manifest::{PluginManifest, HOST_API_VERSION};

pub const PLUGIN_LABEL_PREFIX: &str = "plugin-";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub manifest: PluginManifest,
    /// builtin | store | local | dev
    pub source: String,
    pub enabled: bool,
    pub installed_at: u64,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Default)]
pub struct RegistryInner {
    pub plugins: HashMap<String, InstalledPlugin>,
    pub dir: Option<PathBuf>,
    /// 用户显式卸载的内置插件 id：启动/升级不再自动装回，恢复走插件管理页。
    pub uninstalled_builtins: HashSet<String>,
}

/// 全局注册表状态（setup 阶段初始化）
pub struct PluginRegistry(pub Mutex<RegistryInner>);

/// 开发模式插件表：id → (manifest, 静态文件目录)。仅 debug 构建可用。
#[derive(Default)]
pub struct DevPlugins(pub Mutex<HashMap<String, (PluginManifest, PathBuf)>>);

/// setup 阶段调用：定位插件目录并加载 installed.json（缺失视为空表）。
pub fn init(app: &AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?;
    let plugins_dir = data_dir.join("plugins");
    fs::create_dir_all(&plugins_dir).map_err(|e| format!("无法创建插件目录: {e}"))?;

    let registry_path = plugins_dir.join("installed.json");
    let plugins = if registry_path.exists() {
        let raw = fs::read_to_string(&registry_path)
            .map_err(|e| format!("读取 installed.json 失败: {e}"))?;
        serde_json::from_str::<HashMap<String, InstalledPlugin>>(&raw)
            .map_err(|e| format!("解析 installed.json 失败: {e}"))?
    } else {
        HashMap::new()
    };

    // 已卸载内置清单：损坏时容忍并重置为空（代价只是内置插件被重新装回）
    let uninstalled_path = plugins_dir.join("uninstalled-builtins.json");
    let uninstalled_builtins = if uninstalled_path.exists() {
        fs::read_to_string(&uninstalled_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<HashSet<String>>(&raw).ok())
            .unwrap_or_else(|| {
                crate::plugin_installer::log::err("uninstalled-builtins.json 解析失败，已重置为空");
                HashSet::new()
            })
    } else {
        HashSet::new()
    };

    app.manage(PluginRegistry(Mutex::new(RegistryInner {
        plugins,
        dir: Some(plugins_dir),
        uninstalled_builtins,
    })));
    app.manage(DevPlugins(Mutex::new(HashMap::new())));
    Ok(())
}

/// 持久化注册表与已卸载内置清单（原子写）
pub fn persist(state: &RegistryInner) -> Result<(), String> {
    let dir = state.dir.as_ref().ok_or("插件目录未初始化")?;
    let json = serde_json::to_string_pretty(&state.plugins).map_err(|e| e.to_string())?;
    atomic_write(&dir.join("installed.json"), &json)?;

    let uninstalled =
        serde_json::to_string_pretty(&state.uninstalled_builtins).map_err(|e| e.to_string())?;
    atomic_write(&dir.join("uninstalled-builtins.json"), &uninstalled)?;
    Ok(())
}

fn atomic_write(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents).map_err(|e| format!("写入 {} 失败: {e}", path.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("替换 {} 失败: {e}", path.display()))?;
    Ok(())
}

/// 按插件 id 解析 manifest：优先开发模式（debug），否则读已安装表。
pub fn resolve_manifest(app: &AppHandle, id: &str) -> Result<PluginManifest, String> {
    if cfg!(debug_assertions) {
        let devs = app.state::<DevPlugins>();
        let table = devs.0.lock().unwrap();
        if let Some((manifest, _)) = table.get(id) {
            return Ok(manifest.clone());
        }
    }
    let registry = app.state::<PluginRegistry>();
    let inner = registry.0.lock().unwrap();
    inner
        .plugins
        .get(id)
        .filter(|p| p.enabled)
        .map(|p| p.manifest.clone())
        .ok_or_else(|| format!("插件「{id}」未安装或已停用"))
}

// ---------- 窗口 URL ----------

/// 插件窗口地址。Windows 走 http://plugin.localhost，其余平台 plugin://。
pub fn window_url(id: &str, entry: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("http://plugin.localhost/{id}/{entry}")
    } else {
        format!("plugin://localhost/{id}/{entry}")
    }
}

// ---------- 命令 ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub manifest: PluginManifest,
    pub source: String,
    pub enabled: bool,
    pub installed_at: u64,
    pub sha256: Option<String>,
    pub running: bool,
    pub icon_url: String,
}

/// 列出全部可用插件（已安装含停用 + 开发模式），按 id 排序。
#[tauri::command]
pub fn plugin_list(app: AppHandle) -> Result<Vec<PluginInfo>, String> {
    let icon_of = |id: &str, icon: &str| {
        format!(
            "{}/{}",
            crate::plugin_protocol::asset_base(),
            format_args!("{id}/{icon}")
        )
    };
    let registry = app.state::<PluginRegistry>();
    let inner = registry.0.lock().unwrap();
    let mut list: Vec<PluginInfo> = inner
        .plugins
        .values()
        .map(|p| PluginInfo {
            running: app
                .get_webview_window(&format!("{PLUGIN_LABEL_PREFIX}{}", p.manifest.id))
                .is_some(),
            icon_url: icon_of(&p.manifest.id, &p.manifest.icon),
            id: p.manifest.id.clone(),
            manifest: p.manifest.clone(),
            source: p.source.clone(),
            enabled: p.enabled,
            installed_at: p.installed_at,
            sha256: p.sha256.clone(),
        })
        .collect();

    // 开发模式插件（debug 构建）合并展示
    if cfg!(debug_assertions) {
        let devs = app.state::<DevPlugins>();
        let table = devs.0.lock().unwrap();
        for (id, (manifest, _)) in table.iter() {
            if inner.plugins.contains_key(id) {
                continue; // 已安装版本优先展示
            }
            list.push(PluginInfo {
                running: app
                    .get_webview_window(&format!("{PLUGIN_LABEL_PREFIX}{id}"))
                    .is_some(),
                icon_url: icon_of(id, &manifest.icon),
                id: id.clone(),
                manifest: manifest.clone(),
                source: "dev".into(),
                enabled: true,
                installed_at: 0,
                sha256: None,
            });
        }
    }

    list.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(list)
}

/// 打开（或聚焦）插件窗口。
/// 注意：必须为 async——同步命令在主线程执行，build() 会等待主线程事件循环，
/// 在 Windows 上直接死锁（窗口永远不出现）。
#[tauri::command]
pub async fn plugin_open(app: AppHandle, id: String) -> Result<(), String> {
    let manifest = resolve_manifest(&app, &id)?;
    let label = format!("{PLUGIN_LABEL_PREFIX}{id}");

    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let url: tauri::Url = window_url(&id, &manifest.entry)
        .parse()
        .map_err(|e| format!("插件地址非法: {e}"))?;
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .title(manifest.window.as_ref().and_then(|w| w.title.clone()).unwrap_or_else(|| manifest.name.clone()))
        .inner_size(1100.0, 800.0)
        .min_inner_size(480.0, 480.0)
        .resizable(true)
        // 调试：插件页 JS 错误经 plugin://localhost/debuglog/ 上报到宿主 stderr
        .initialization_script(
            "const __rep = (m) => { try { fetch('plugin://localhost/debuglog/' + encodeURIComponent(String(m).slice(0, 400))).catch(() => {}); } catch (e) {} };\
             __rep('INIT ' + location.href);\
             window.addEventListener('error', (e) => { __rep('ERR ' + ((e.target && e.target !== window && (e.target.src || e.target.href)) ? (e.target.src || e.target.href) : (e.message || e.error))); }, true);\
             window.addEventListener('unhandledrejection', (e) => { __rep('REJ ' + (e.reason && e.reason.message || e.reason)); });",
        );

    if let Some(w) = &manifest.window {
        if let Some(t) = &w.title {
            builder = builder.title(t.clone());
        }
        if let Some(wd) = w.width {
            builder = builder.inner_size(wd, w.height.unwrap_or(800.0));
        } else if let Some(ht) = w.height {
            builder = builder.inner_size(1100.0, ht);
        }
        if w.min_width.is_some() || w.min_height.is_some() {
            builder =
                builder.min_inner_size(w.min_width.unwrap_or(480.0), w.min_height.unwrap_or(480.0));
        }
        if let Some(r) = w.resizable {
            builder = builder.resizable(r);
        }
    }

    builder
        .build()
        .map_err(|e| format!("打开插件窗口失败: {e}"))?;
    Ok(())
}

/// 启用/停用插件。停用后不出现在启动台；已开窗口不强制关闭。
#[tauri::command]
pub fn plugin_set_enabled(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    let registry = app.state::<PluginRegistry>();
    let mut inner = registry.0.lock().unwrap();
    let entry = inner.plugins.get_mut(&id).ok_or("插件不存在")?;
    entry.enabled = enabled;
    persist(&inner)?;
    drop(inner);
    let _ = app.emit("toolbox://plugins-changed", ());
    Ok(())
}

/// 注册开发模式插件：选择包含 manifest.json 与构建产物的目录（仅 debug 构建）。
/// 注意：必须为 async——同步命令在主线程执行，blocking 对话框会把主线程饿死（窗口卡死）。
#[tauri::command]
pub async fn plugin_dev_register(app: AppHandle) -> Result<String, String> {
    if !cfg!(debug_assertions) {
        return Err("开发模式插件加载仅在 debug 构建中可用".into());
    }
    let dir = app
        .dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.simplified().into_path().ok())
        .ok_or("未选择目录")?;

    let raw = fs::read_to_string(dir.join("manifest.json"))
        .map_err(|e| format!("读取 manifest.json 失败: {e}"))?;
    let manifest: PluginManifest =
        serde_json::from_str(&raw).map_err(|e| format!("解析 manifest.json 失败: {e}"))?;
    crate::plugin_manifest::validate(&manifest, None)?;
    if manifest.api_version > HOST_API_VERSION {
        return Err("apiVersion 高于宿主支持".into());
    }
    let entry_path = dir.join(&manifest.entry);
    if !entry_path.exists() {
        return Err(format!("入口文件不存在：{}", manifest.entry));
    }

    let id = manifest.id.clone();
    app.state::<DevPlugins>()
        .0
        .lock()
        .unwrap()
        .insert(id.clone(), (manifest, dir));
    let _ = app.emit("toolbox://plugins-changed", ());
    Ok(id)
}

/// 移除开发模式插件注册。
#[tauri::command]
pub fn plugin_dev_unregister(app: AppHandle, id: String) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("开发模式插件管理仅在 debug 构建中可用".into());
    }
    app.state::<DevPlugins>().0.lock().unwrap().remove(&id);
    let label = format!("{PLUGIN_LABEL_PREFIX}{id}");
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.close();
    }
    let _ = app.emit("toolbox://plugins-changed", ());
    Ok(())
}

/// 开发模式插件列表（前端据此标注来源）。
#[tauri::command]
pub fn plugin_dev_list(app: AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<DevPlugins>();
    let devs = state.0.lock().unwrap();
    let mut ids: Vec<String> = devs.keys().cloned().collect();
    ids.sort();
    Ok(ids)
}
