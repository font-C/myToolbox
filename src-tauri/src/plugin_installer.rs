//! .tbox 包安装器：解包、完整性校验（sha256）、商店包验签（Ed25519）、原子落盘。
//!
//! 签名模型：签名对象是 .tbox 包的 sha256（hex 编码字符串的 UTF-8 字节），
//! 由商店索引（index.json）携带 sha256 + signature。本地导入的包没有索引，
//! 允许未签名安装（前端需向用户明示来源）。

use std::collections::HashSet;
use std::io::Read;

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::plugin_manifest::{self, PluginManifest};
use crate::plugin_registry::{InstalledPlugin, PluginRegistry};

/// 商店签名公钥（Ed25519，32 字节 hex）。全零表示未配置——此时拒绝商店安装。
/// 生成/轮换方式见 specs/04-packaging-signing.md。
pub const STORE_PUBKEY_HEX: &str = "4f5695564fb3004ddf88c9a430f9f014655f59a13e5d9ee5e40cd99c14d8da50";

/// 内置插件（编译期嵌入）。构建流程：npm run build:plugins → src-tauri/builtin/*.tbox。
/// 内置仅保留 PDF 系工具；其余工具从商店安装（specs/00-overview.md）。
pub const BUILTIN_PLUGINS: &[(&str, &[u8])] = &[
    ("pdf-crop", include_bytes!("../builtin/pdf-crop.tbox")),
    ("pdf-compose", include_bytes!("../builtin/pdf-compose.tbox")),
    ("pdf-split", include_bytes!("../builtin/pdf-split.tbox")),
    ("pdf-compress", include_bytes!("../builtin/pdf-compress.tbox")),
    ("pdf-crypt", include_bytes!("../builtin/pdf-crypt.tbox")),
];

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(digest)
}

/// 单条目解压上限（zip 条目声明的 uncompressed size 可被伪造，不能直接信任）
const MAX_ENTRY_BYTES: u64 = 256 * 1024 * 1024;
/// 全包解压总量上限（防解压炸弹）
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

/// 校验 zip 条目名。必须先把 `\\` 统一成 `/` 再校验：在 Unix 解析下
/// `..\evil` 是单一合法组件，`enclosed_name` 会放行，转换后才暴露 `../evil`
/// 逃逸（zip-slip）。这里不用 enclosed_name，改为对转换后的名字做白名单校验。
fn sanitize_entry_name(raw: &str, index: usize) -> Result<String, String> {
    let reject = |why: &str| format!("插件包内含{why}路径条目（第 {} 项）", index + 1);
    let name = raw.replace('\\', "/");
    if name.starts_with('/') || name.contains('\0') {
        return Err(reject("非法"));
    }
    let mut comps: Vec<&str> = Vec::new();
    for seg in name.split('/') {
        match seg {
            "" | "." => continue,
            ".." => return Err(reject("非法")),
            s => {
                if s.contains(':') {
                    return Err(reject("非法")); // Windows 盘符等
                }
                comps.push(s);
            }
        }
    }
    if comps.is_empty() {
        return Err(reject("非法"));
    }
    Ok(comps.join("/"))
}

/// 解压 .tbox（zip）到内存。返回 {相对路径: 字节}。
fn unzip_to_memory(bytes: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("无法读取插件包: {e}"))?;
    let mut files = Vec::with_capacity(archive.len());
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("插件包损坏: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        let name = sanitize_entry_name(entry.name(), i)?;
        // 只按实际读到的字节计数，预分配不信任声明值；超限立即报错
        let mut buf = Vec::new();
        entry
            .by_ref()
            .take(MAX_ENTRY_BYTES + 1)
            .read_to_end(&mut buf)
            .map_err(|e| format!("读取包内文件失败: {e}"))?;
        if buf.len() as u64 > MAX_ENTRY_BYTES {
            return Err(format!("包内单个文件超过 {}MB 上限", MAX_ENTRY_BYTES / 1024 / 1024));
        }
        total += buf.len() as u64;
        if total > MAX_TOTAL_BYTES {
            return Err(format!("插件包解压后超过 {}MB 上限", MAX_TOTAL_BYTES / 1024 / 1024));
        }
        files.push((name, buf));
    }
    Ok(files)
}

fn verify_signature(tbox_sha256: &str, signature_hex: &str) -> Result<(), String> {
    let pubkey_bytes = hex::decode(STORE_PUBKEY_HEX).map_err(|e| format!("内置公钥非法: {e}"))?;
    if pubkey_bytes.iter().all(|&b| b == 0) {
        return Err("宿主未配置商店签名公钥，无法安装商店插件".into());
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&pubkey_bytes);
    let verifying_key = ed25519_dalek::VerifyingKey::from_bytes(&key)
        .map_err(|e| format!("内置公钥非法: {e}"))?;
    let sig_bytes = hex::decode(signature_hex).map_err(|_| "签名格式非法（应为 hex）")?;
    let signature = ed25519_dalek::Signature::from_slice(&sig_bytes)
        .map_err(|_| format!("签名长度非法（{} 字节）", sig_bytes.len()))?;
    verifying_key
        .verify_strict(tbox_sha256.as_bytes(), &signature)
        .map_err(|_| "签名校验失败：插件包与商店签名不匹配".into())
}

/// 安装一个 .tbox 包。
/// - `source`: builtin | store | local
/// - `expected_sha256` / `signature`: 商店安装时必填（索引下发）；本地导入可为空
/// 返回安装后的 manifest。
pub fn install_tbox(
    app: &AppHandle,
    tbox: &[u8],
    source: &str,
    expected_sha256: Option<&str>,
    signature: Option<&str>,
) -> Result<PluginManifest, String> {
    if tbox.is_empty() {
        return Err("插件包为空".into());
    }
    if tbox.len() > 256 * 1024 * 1024 {
        return Err("插件包超过 256MB 上限".into());
    }

    // 完整性：sha256
    let actual_sha = sha256_hex(tbox);
    if let Some(expected) = expected_sha256 {
        if !expected.eq_ignore_ascii_case(&actual_sha) {
            return Err(format!(
                "sha256 校验失败：期望 {expected}，实际 {actual_sha}，包可能被篡改或下载不完整"
            ));
        }
    }

    // 来源校验：商店包必须带有效签名
    match source {
        "store" => {
            let sig = signature.ok_or("商店插件缺少签名")?;
            verify_signature(&actual_sha, sig)?;
        }
        "local" | "builtin" => {}
        other => return Err(format!("未知安装来源: {other}")),
    }

    // 解包与 manifest 校验
    let files = unzip_to_memory(tbox)?;
    let names: HashSet<String> = files.iter().map(|(n, _)| n.clone()).collect();
    let manifest_raw = files
        .iter()
        .find(|(n, _)| n == "manifest.json")
        .map(|(_, b)| b)
        .ok_or("插件包缺少 manifest.json")?;
    let manifest: PluginManifest = serde_json::from_slice(manifest_raw)
        .map_err(|e| format!("解析 manifest.json 失败: {e}"))?;
    plugin_manifest::validate(&manifest, Some(&names))?;

    // 商店来源拒绝降级：签名只覆盖包内容不含版本，被替换的旧索引可能把
    // 合法签名的旧版本包伪装成"更新"下发
    if source == "store" {
        let registry = app.state::<PluginRegistry>();
        let inner = registry.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(existing) = inner.plugins.get(&manifest.id) {
            if !plugin_manifest::version_ge(&manifest.version, &existing.manifest.version) {
                return Err(format!(
                    "拒绝降级安装：商店包版本 {} 低于已安装版本 {}",
                    manifest.version, existing.manifest.version
                ));
            }
        }
    }

    // 若插件窗口开着：先关闭并等待销毁，再落盘
    // （Windows 下运行中窗口的文件句柄会让目录替换失败）
    let label = format!("{}{}", crate::plugin_registry::PLUGIN_LABEL_PREFIX, manifest.id);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.close();
        for _ in 0..60 {
            if app.get_webview_window(&label).is_none() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    // 原子落盘：<id>.tmp → 替换 <id>
    let registry = app.state::<PluginRegistry>();
    let plugins_dir = {
        let inner = registry.0.lock().unwrap_or_else(|p| p.into_inner());
        inner.dir.clone().ok_or("插件目录未初始化")?
    };
    let target = plugins_dir.join(&manifest.id);
    let tmp = plugins_dir.join(format!(".tmp-{}", manifest.id));
    if tmp.exists() {
        std::fs::remove_dir_all(&tmp).map_err(|e| format!("清理临时目录失败: {e}"))?;
    }
    std::fs::create_dir_all(&tmp).map_err(|e| format!("创建临时目录失败: {e}"))?;
    for (name, bytes) in &files {
        let dest = tmp.join(name);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        std::fs::write(&dest, bytes).map_err(|e| format!("写入 {name} 失败: {e}"))?;
    }
    if target.exists() {
        std::fs::remove_dir_all(&target).map_err(|e| format!("移除旧版本失败: {e}"))?;
    }
    std::fs::rename(&tmp, &target).map_err(|e| format!("安装插件失败: {e}"))?;

    // 更新注册表（升级保留启用状态）；从商店重装会清除内置插件的卸载标记
    let mut inner = registry.0.lock().unwrap_or_else(|p| p.into_inner());
    let enabled = inner
        .plugins
        .get(&manifest.id)
        .map(|p| p.enabled)
        .unwrap_or(true);
    inner.uninstalled_builtins.remove(&manifest.id);
    inner.plugins.insert(
        manifest.id.clone(),
        InstalledPlugin {
            manifest: manifest.clone(),
            source: source.to_string(),
            enabled,
            installed_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            sha256: Some(actual_sha),
        },
    );
    crate::plugin_registry::persist(&inner)?;

    Ok(manifest)
}

/// 启动时确保内置插件就位：内置版本比已装版本新（或从未安装）时安装/升级；
/// 已装版本（含商店/本地来源）更新则保留用户的，不回退。
/// 已从内置清单移除的旧内置插件（老版本宿主装过的）一并清理。
pub fn ensure_builtins(app: &AppHandle) {
    retire_removed_builtins(app);
    for (id, tbox) in BUILTIN_PLUGINS {
        if tbox.is_empty() {
            continue; // 构建占位（插件尚未打包）
        }
        let builtin_version = match peek_version(tbox) {
            Some(v) => v,
            None => {
                log::err(&format!("内置插件 {id} 的 manifest 无法解析，跳过"));
                continue;
            }
        };
        let registry = app.state::<PluginRegistry>();
        let skip = {
            let inner = registry.0.lock().unwrap_or_else(|p| p.into_inner());
            let user_removed = inner.uninstalled_builtins.contains(*id);
            let outdated = inner
                .plugins
                .get(*id)
                .map(|existing| !plugin_manifest::version_ge(&builtin_version, &existing.manifest.version))
                .unwrap_or(false);
            user_removed || outdated
        };
        if skip {
            continue;
        }
        match install_tbox(app, tbox, "builtin", None, None) {
            Ok(m) => log::ok(&format!("内置插件 {} v{} 就绪", m.id, m.version)),
            Err(e) => log::err(&format!("内置插件 {id} 安装失败: {e}")),
        }
    }
}

/// 清理已不在内置清单里的旧内置插件：从注册表移除并删除其文件（商店版不受影响）；
/// 同时丢弃不再嵌入的卸载标记。有变化时通知前端刷新。
fn retire_removed_builtins(app: &AppHandle) {
    let embedded = |id: &str| BUILTIN_PLUGINS.iter().any(|(bid, _)| *bid == id);
    let registry = app.state::<PluginRegistry>();
    let mut inner = registry.0.lock().unwrap_or_else(|p| p.into_inner());

    let stale: Vec<String> = inner
        .plugins
        .iter()
        .filter(|(id, p)| p.source == "builtin" && !embedded(id))
        .map(|(id, _)| id.clone())
        .collect();
    let flags_before = inner.uninstalled_builtins.len();
    inner.uninstalled_builtins.retain(|id| embedded(id));
    if stale.is_empty() && inner.uninstalled_builtins.len() == flags_before {
        return;
    }
    if let Some(dir) = &inner.dir {
        for id in &stale {
            let target = dir.join(id);
            if target.exists() {
                if let Err(e) = std::fs::remove_dir_all(&target) {
                    log::err(&format!("清理旧内置插件 {id} 文件失败: {e}"));
                }
            }
        }
    }
    for id in &stale {
        inner.plugins.remove(id);
        log::ok(&format!("已移除旧内置插件 {id}（不再随宿主内置，可从商店安装）"));
    }
    crate::plugin_registry::persist(&inner)
        .unwrap_or_else(|e| log::err(&format!("持久化注册表失败: {e}")));
    drop(inner);
    for id in &stale {
        let label = format!("{}{}", crate::plugin_registry::PLUGIN_LABEL_PREFIX, id);
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.close();
        }
    }
    use tauri::Emitter;
    let _ = app.emit("toolbox://plugins-changed", ());
}

/// 从 .tbox 中只读 manifest（用于内置升级判断）。
fn peek_manifest(tbox: &[u8]) -> Option<PluginManifest> {
    let files = unzip_to_memory(tbox).ok()?;
    let (_, raw) = files.iter().find(|(n, _)| n == "manifest.json")?;
    serde_json::from_slice(raw).ok()
}

/// 从 .tbox 中只读 manifest 版本（用于内置升级判断）。
fn peek_version(tbox: &[u8]) -> Option<String> {
    peek_manifest(tbox).map(|m| m.version)
}

/// 简单日志（避免引入 log 依赖）
pub(crate) mod log {
    pub fn ok(msg: &str) {
        println!("[toolbox] {msg}");
    }
    pub fn err(msg: &str) {
        eprintln!("[toolbox] {msg}");
    }
}

// ---------- 命令（仅限主窗口调用） ----------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPayload {
    /// .tbox 原始字节（商店下载场景）
    #[serde(default)]
    pub bytes: Vec<u8>,
    /// .tbox 本地路径（本地导入场景，主窗口已用对话框让用户选择）
    #[serde(default)]
    pub path: Option<String>,
    /// builtin 之外仅允许 store | local
    pub source: String,
    pub sha256: Option<String>,
    pub signature: Option<String>,
}

/// 安装插件包（商店下载或本地导入）。
/// 注意：必须为 async——sha256/解压/落盘在同步命令里会阻塞主线程，冻结全部窗口。
#[tauri::command]
pub async fn plugin_install(window: WebviewWindow, payload: InstallPayload) -> Result<PluginManifest, String> {
    crate::plugin_registry::ensure_main(&window)?;
    let app = window.app_handle().clone();
    if !matches!(payload.source.as_str(), "store" | "local") {
        return Err("source 仅允许 store | local".into());
    }
    if payload.source == "store" && payload.signature.is_none() {
        return Err("商店安装必须提供签名".into());
    }
    let tbox = if !payload.bytes.is_empty() {
        payload.bytes
    } else if let Some(path) = &payload.path {
        // 本地导入：路径来自用户在对话框中的选择
        std::fs::read(path).map_err(|e| format!("读取插件包失败: {e}"))?
    } else {
        return Err("未提供插件包内容".into());
    };
    let app_for_task = app.clone();
    let manifest = tauri::async_runtime::spawn_blocking(move || {
        install_tbox(
            &app_for_task,
            &tbox,
            &payload.source,
            payload.sha256.as_deref(),
            payload.signature.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("后台任务执行失败: {e}"))??;
    use tauri::Emitter;
    let _ = app.emit("toolbox://plugins-changed", ());
    Ok(manifest)
}

/// 卸载插件。内置插件同样可卸载：记入「已卸载内置」集合，宿主启动/升级不再
/// 自动装回；需要时从商店重新安装（安装会自动清除该标记）。
#[tauri::command]
pub async fn plugin_uninstall(window: WebviewWindow, id: String) -> Result<(), String> {
    crate::plugin_registry::ensure_main(&window)?;
    let app = window.app_handle().clone();
    let app_for_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || uninstall_impl(&app_for_task, &id))
        .await
        .map_err(|e| format!("后台任务执行失败: {e}"))??;
    use tauri::Emitter;
    let _ = app.emit("toolbox://plugins-changed", ());
    Ok(())
}

fn uninstall_impl(app: &AppHandle, id: &str) -> Result<(), String> {
    let registry = app.state::<PluginRegistry>();
    let mut inner = registry.0.lock().unwrap_or_else(|p| p.into_inner());
    let entry = inner.plugins.get(id).ok_or("插件不存在")?;
    let is_builtin = entry.source == "builtin";
    let dir = inner.dir.clone().ok_or("插件目录未初始化")?;
    let target = dir.join(id);
    inner.plugins.remove(id);
    if is_builtin {
        inner.uninstalled_builtins.insert(id.to_string());
    }
    crate::plugin_registry::persist(&inner)?;
    drop(inner);

    // 先关闭窗口并等待销毁，再删除文件（Windows 句柄占用会让 remove_dir_all 失败）
    let label = format!("{}{}", crate::plugin_registry::PLUGIN_LABEL_PREFIX, id);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.close();
        for _ in 0..60 {
            if app.get_webview_window(&label).is_none() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
    if target.exists() {
        std::fs::remove_dir_all(&target).map_err(|e| format!("删除插件文件失败: {e}"))?;
    }
    // 一并清除该插件的持久化数据（specs/02：数据随卸载删除）
    crate::plugin_storage::delete_plugin_data(app, id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_compare() {
        assert!(plugin_manifest::version_ge("1.0.0", "1.0.0"));
        assert!(plugin_manifest::version_ge("1.2.1", "1.2.0"));
        assert!(!plugin_manifest::version_ge("0.9.0", "1.0.0"));
        assert!(plugin_manifest::version_ge("2.0.0", "1.99.99"));
    }

    #[test]
    fn unzip_rejects_garbage() {
        assert!(unzip_to_memory(b"not a zip").is_err());
        assert!(unzip_to_memory(b"").is_err());
    }

    /// zip-slip 回归：`..\` 条目在 Unix 解析下是单一组件，必须转换后再拒绝。
    #[test]
    fn entry_name_rejects_traversal_after_backslash_conversion() {
        assert!(sanitize_entry_name("..\\..\\tmp\\pwned", 0).is_err());
        assert!(sanitize_entry_name("../evil", 0).is_err());
        assert!(sanitize_entry_name("/abs/path", 0).is_err());
        assert!(sanitize_entry_name("C:\\evil", 0).is_err());
        assert!(sanitize_entry_name("a/../b", 0).is_err());
        assert!(sanitize_entry_name("..", 0).is_err());
        assert!(sanitize_entry_name("a\0b", 0).is_err());
        // 合法名（含子目录与 Windows 反斜杠写法）保留
        assert_eq!(sanitize_entry_name("assets/js/main.js", 0).unwrap(), "assets/js/main.js");
        assert_eq!(sanitize_entry_name("assets\\js\\main.js", 0).unwrap(), "assets/js/main.js");
        assert_eq!(sanitize_entry_name("manifest.json", 0).unwrap(), "manifest.json");
    }

    /// 内置包的 manifest 必须能解析且 id 与登记一致（卸载/恢复列表依赖此假设）。
    #[test]
    fn builtin_packages_manifest_matches_id() {
        for (id, tbox) in BUILTIN_PLUGINS {
            if tbox.is_empty() {
                continue; // 构建占位
            }
            let m = peek_manifest(tbox)
                .unwrap_or_else(|| panic!("内置插件 {id} 的 manifest 无法解析"));
            assert_eq!(&m.id, id);
        }
    }

    /// 端到端 zip-slip 回归：真实构造含 `..\` 条目的包，必须被拒。
    #[test]
    fn unzip_rejects_backslash_traversal_entry() {
        use std::io::Write;
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut cursor);
            let opts = zip::write::SimpleFileOptions::default();
            w.start_file("..\\..\\evil.txt", opts).unwrap();
            w.write_all(b"pwned").unwrap();
            w.finish().unwrap();
        }
        assert!(unzip_to_memory(&cursor.into_inner()).is_err());
    }

    #[test]
    fn unzip_accepts_normal_entry() {
        use std::io::Write;
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut cursor);
            let opts = zip::write::SimpleFileOptions::default();
            w.start_file("manifest.json", opts).unwrap();
            w.write_all(b"{}").unwrap();
            w.finish().unwrap();
        }
        let files = unzip_to_memory(&cursor.into_inner()).unwrap();
        assert_eq!(files[0].0, "manifest.json");
    }

    /// 固化「Node(noble) 签名 ↔ Rust(dalek) 验签」的跨库互操作：
    /// 测试向量由 @noble/ed25519 生成，消息格式与商店验签一致（sha256 hex 字符串）。
    #[test]
    fn verify_signature_interop_with_node_noble() {
        let pubkey = "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664";
        let msg = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
        let sig = "8fd8e310f989871297a15bb6687a0773a4df2318daf0200057697dd9f9bb322dc24bc5c6cde2dae2cf4dd7a12b41505709aae3732c94013e84a1d5a002406d0e";

        let key = hex::decode(pubkey).unwrap();
        let mut fixed = [0u8; 32];
        fixed.copy_from_slice(&key);
        let vk = ed25519_dalek::VerifyingKey::from_bytes(&fixed).unwrap();
        let signature =
            ed25519_dalek::Signature::from_slice(&hex::decode(sig).unwrap()).unwrap();
        vk.verify_strict(msg.as_bytes(), &signature)
            .expect("noble 生成的签名必须能被 dalek 验证");

        // 篡改消息必须失败
        assert!(vk.verify_strict(b"tampered", &signature).is_err());
    }
}
