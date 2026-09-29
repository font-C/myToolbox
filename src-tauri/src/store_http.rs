//! 商店资源拉取（Rust 端 HTTP）：替代 webview fetch。
//!
//! webview 里的 fetch 受 CORS 约束（源是 tauri://localhost），
//! GitHub Pages 带 ACAO:* 能用，但 Gitee raw 等静态托管不发 CORS 头会被拦。
//! 挪到 Rust 端（reqwest）后任何 https 目录都能当商店源；
//! UA / 超时 / 大小上限在此统一约束。

use tauri::ipc::Response;

const MAX_BYTES: usize = 256 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECS: u64 = 60;
const USER_AGENT: &str = concat!("toolbox/", env!("CARGO_PKG_VERSION"));

/// 拉取商店资源（index.json / .tbox 包），返回原始字节（前端收到 ArrayBuffer）。
/// 仅允许 https；非 2xx 报错并携带状态码；响应超过 256MB 拒绝。
#[tauri::command]
pub async fn store_fetch(url: String, timeout_secs: Option<u64>) -> Result<Response, String> {
    if !url.starts_with("https://") {
        return Err(format!("仅允许 https 拉取: {url}"));
    }
    let secs = timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS).clamp(5, 600);
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(secs))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;
    let resp = client.get(&url).send().await.map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("商店返回 {status}"));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("读取响应失败: {e}"))?;
    if bytes.len() > MAX_BYTES {
        return Err(format!("响应超过 {}MB 上限", MAX_BYTES / 1024 / 1024));
    }
    Ok(Response::new(bytes.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_non_https() {
        // tauri::ipc::Response 未实现 Debug，不能用 unwrap_err
        let err = store_fetch("http://example.com/x".into(), None)
            .await
            .err()
            .expect("非 https 地址应被拒绝");
        assert!(err.contains("仅允许 https"));
    }
}
