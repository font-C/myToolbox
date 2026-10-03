//! `plugin://` 自定义协议：为每个插件窗口提供静态文件服务。
//!
//! - Windows 下地址形如 `http://plugin.localhost/<id>/<path>`，其余平台 `plugin://localhost/<id>/<path>`
//! - 防路径穿越：拒绝 `..` 段与绝对路径；仅服务插件目录内的文件
//! - HTML 响应带严格 CSP：插件默认离线（无网络权限），脚本仅限自身来源
//! - 开发模式（debug 构建）下，`plugin_dev_register` 注册的目录同样由此服务

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

use crate::plugin_registry::{DevPlugins, PluginRegistry};

/// 主窗口展示插件图标等资源时的基址（跨平台不同）。
pub fn asset_base() -> String {
    if cfg!(target_os = "windows") {
        "http://plugin.localhost".into()
    } else {
        "plugin://localhost".into()
    }
}

/// 插件页面的严格 CSP。connect-src 刻意不放行任何远程地址：
/// v1 插件无网络权限，必须离线自足。
const PLUGIN_HTML_CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; base-uri 'none'; form-action 'none'";

fn mime_for(path: &str) -> (&'static str, bool) {
    // (MIME, 是否文本)
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => ("text/html", true),
        "js" | "mjs" => ("text/javascript", true),
        "css" => ("text/css", true),
        "json" | "map" => ("application/json", true),
        "svg" => ("image/svg+xml", true),
        "txt" => ("text/plain", true),
        "xml" => ("application/xml", true),
        "png" => ("image/png", false),
        "jpg" | "jpeg" => ("image/jpeg", false),
        "gif" => ("image/gif", false),
        "webp" => ("image/webp", false),
        "ico" => ("image/x-icon", false),
        "woff" => ("font/woff", false),
        "woff2" => ("font/woff2", false),
        "ttf" => ("font/ttf", false),
        "otf" => ("font/otf", false),
        "wasm" => ("application/wasm", false),
        "pdf" => ("application/pdf", false),
        _ => ("application/octet-stream", false),
    }
}

/// 从 URI 提取 `<id>` 与 `<相对路径>`。兼容两种地址形态（path 恒为 /<id>/<rest>）。
fn parse_request_path(uri_path: &str) -> Option<(String, String)> {
    let decoded = percent_encoding::percent_decode_str(uri_path).decode_utf8().ok()?;
    let trimmed = decoded.trim_start_matches('/');
    let mut segs = trimmed.splitn(2, '/');
    let id = segs.next()?.to_string();
    let rest = segs.next().unwrap_or("").to_string();
    let id_ok = !id.is_empty()
        && id.len() <= 48
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !id_ok {
        return None;
    }
    if rest.split('/').any(|seg| seg == "..") {
        return None; // 路径穿越
    }
    Some((id, rest))
}

/// 解析插件 id 对应的静态目录（开发模式优先）。
fn resolve_dir_for(app: &AppHandle, id: &str) -> Option<std::path::PathBuf> {
    if cfg!(debug_assertions) {
        if let Some((_, dir)) = app
            .state::<DevPlugins>()
            .0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(id)
        {
            return Some(dir.clone());
        }
    }
    let registry = app.state::<PluginRegistry>();
    let inner = registry.0.lock().unwrap_or_else(|p| p.into_inner());
    let dir = inner.dir.as_ref()?;
    let plugin_dir = dir.join(id);
    plugin_dir.exists().then_some(plugin_dir)
}

fn not_found(msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

fn forbidden(msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::FORBIDDEN)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

/// 协议入口（lib.rs 中注册）。
pub fn handle(app: &AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri_path = request.uri().path().to_string();
    let response = handle_inner(app, &uri_path);
    if cfg!(debug_assertions) {
        eprintln!(
            "[plugin-protocol] {} {} -> {}",
            request.method(),
            uri_path,
            response.status()
        );
    }
    response
}

fn handle_inner(app: &AppHandle, uri_path: &str) -> Response<Vec<u8>> {
    let (id, rest) = match parse_request_path(uri_path) {
        Some(v) => v,
        None => return forbidden("非法的插件请求路径"),
    };

    // 调试端点：插件页 initialization_script 上报 JS 错误（仅 debug 构建编译进二进制）
    if id == "debuglog" && cfg!(debug_assertions) {
        let msg = percent_encoding::percent_decode_str(&rest)
            .decode_utf8()
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| rest.clone());
        eprintln!("[plugin-js] {msg}");
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Vec::new())
            .unwrap();
    }

    let base_dir = match resolve_dir_for(&app, &id) {
        Some(d) => d,
        None => return not_found(&format!("插件「{id}」不存在")),
    };

    // 相对路径：空 → manifest.entry
    let rel = if rest.is_empty() || rest.ends_with('/') {
        match read_manifest_entry(&base_dir) {
            Some(entry) => {
                if rest.is_empty() {
                    entry
                } else {
                    format!("{rest}{entry}")
                }
            }
            None => rest,
        }
    } else {
        rest
    };

    let file_path = base_dir.join(&rel);
    // 二次校验（fail-closed）：rel 里不允许残留 `.`/`..`/反斜杠成分，且
    // canonicalize 必须成功——失败（不存在/权限/长路径异常）一律按不存在处理，
    // 不再回退到未解析路径做 starts_with
    if rel.is_empty()
        || rel
            .split('/')
            .any(|seg| seg.is_empty() || seg == "." || seg == ".." || seg.contains('\\'))
    {
        return not_found(&format!("插件资源不存在: /{id}/{rel}"));
    }
    let Ok(file_path) = file_path.canonicalize() else {
        return not_found(&format!("插件资源不存在: /{id}/{rel}"));
    };
    let Ok(base_canonical) = base_dir.canonicalize() else {
        return not_found(&format!("插件目录不可用: /{id}"));
    };
    if !file_path.starts_with(&base_canonical) {
        return forbidden("路径越界");
    }
    if !file_path.is_file() {
        return not_found(&format!("插件资源不存在: /{id}/{rel}"));
    }

    let bytes = match std::fs::read(&file_path) {
        Ok(b) => b,
        Err(e) => return not_found(&format!("读取插件资源失败: {e}")),
    };
    let (mime, is_text) = mime_for(&rel);

    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, if is_text { format!("{mime}; charset=utf-8") } else { mime.to_string() })
        // 必须禁缓存：重装插件后文件 hash 变化，WKWebView 的持久缓存会拿旧 HTML
        // 引用已不存在的旧资源 → 白屏。no-store 保证永远读最新文件。
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff");
    if mime == "text/html" {
        builder = builder.header(header::CONTENT_SECURITY_POLICY, PLUGIN_HTML_CSP);
    }
    builder.body(bytes).unwrap()
}

fn read_manifest_entry(dir: &std::path::Path) -> Option<String> {
    let raw = std::fs::read_to_string(dir.join("manifest.json")).ok()?;
    let manifest: crate::plugin_manifest::PluginManifest = serde_json::from_str(&raw).ok()?;
    Some(manifest.entry)
}
