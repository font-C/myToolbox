//! 插件清单（manifest.json）类型、解析与校验。
//!
//! 契约详见 specs/01-manifest.md。宿主支持的 SDK 契约版本见 [`HOST_API_VERSION`]。

use serde::{Deserialize, Serialize};

/// 宿主支持的插件 SDK 契约版本（apiVersion）。升级 SDK 契约时 +1。
pub const HOST_API_VERSION: u32 = 1;

pub const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WindowConfig {
    pub title: Option<String>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub min_width: Option<f64>,
    pub min_height: Option<f64>,
    pub resizable: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub format_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    pub version: String,
    #[serde(default = "default_api_version")]
    pub api_version: u32,
    #[serde(default = "default_entry")]
    pub entry: String,
    #[serde(default = "default_icon")]
    pub icon: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub window: Option<WindowConfig>,
    #[serde(default)]
    pub min_host_version: Option<String>,
}

fn default_api_version() -> u32 {
    1
}
fn default_entry() -> String {
    "index.html".into()
}
fn default_icon() -> String {
    "icon.png".into()
}

/// 校验 manifest 基本契约。`files` 为包内文件集合（用于确认 entry/icon 存在）；
/// 传入 None 表示仅做字段校验（如本地目录开发模式）。
pub fn validate(manifest: &PluginManifest, files: Option<&std::collections::HashSet<String>>) -> Result<(), String> {
    if manifest.format_version != FORMAT_VERSION {
        return Err(format!(
            "不支持的包格式 formatVersion={}（宿主支持 {}）",
            manifest.format_version, FORMAT_VERSION
        ));
    }
    if manifest.api_version > HOST_API_VERSION {
        return Err(format!(
            "插件 apiVersion={} 高于宿主支持的 {}，请升级宿主",
            manifest.api_version, HOST_API_VERSION
        ));
    }
    let id_ok = {
        let mut chars = manifest.id.chars();
        let first_ok = chars.next().map(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) == Some(true);
        first_ok
            && manifest.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            && manifest.id.len() >= 2
            && manifest.id.len() <= 48
    };
    if !id_ok {
        return Err(format!("非法插件 id「{}」：仅允许小写字母/数字/连字符，2~48 位", manifest.id));
    }
    if manifest.name.trim().is_empty() {
        return Err("name 不能为空".into());
    }
    if !valid_version(&manifest.version) {
        return Err(format!("非法版本号「{}」：应为 x.y.z 数字", manifest.version));
    }
    if let Some(min) = &manifest.min_host_version {
        if !valid_version(min) {
            return Err(format!("非法 minHostVersion「{min}」"));
        }
    }
    for perm in &manifest.permissions {
        if !KNOWN_PERMISSIONS.contains(&perm.as_str()) {
            return Err(format!("未知权限「{perm}」"));
        }
    }
    if manifest.entry.is_empty() || manifest.entry.contains("..") || manifest.entry.starts_with('/') {
        return Err(format!("非法入口「{}」", manifest.entry));
    }
    if manifest.icon.contains("..") || manifest.icon.starts_with('/') {
        return Err(format!("非法图标路径「{}」", manifest.icon));
    }
    if let Some(files) = files {
        for required in [&manifest.entry, &manifest.icon] {
            if !files.contains(required) {
                return Err(format!("包内缺少文件「{required}」"));
            }
        }
    }
    Ok(())
}

/// 已知的权限目录（v1）。插件必须显式声明，broker 在运行时逐项校验。
pub const KNOWN_PERMISSIONS: &[&str] = &[
    "dialog:open",
    "dialog:save",
    "fs:read",
    "fs:write",
    "print",
    "pdf:optimize",
    "pdf:crypt",
    "clipboard:read",
    "clipboard:write",
];

/// 宽松 semver：x.y.z（数字段），忽略预发布后缀（按相等处理）。
fn parse_version(v: &str) -> Option<[u64; 3]> {
    let core = v.split(['-', '+']).next().unwrap_or(v);
    let mut out = [0u64; 3];
    for (i, seg) in core.split('.').enumerate() {
        if i >= 3 {
            return None;
        }
        out[i] = seg.parse().ok()?;
    }
    Some(out)
}

pub fn valid_version(v: &str) -> bool {
    parse_version(v).is_some()
}

/// a >= b？
pub fn version_ge(a: &str, b: &str) -> bool {
    match (parse_version(a), parse_version(b)) {
        (Some(a), Some(b)) => a >= b,
        _ => false,
    }
}
