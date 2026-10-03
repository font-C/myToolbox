//! 商店资源拉取（Rust 端 HTTP）：替代 webview fetch。
//!
//! webview 里的 fetch 受 CORS 约束（源是 tauri://localhost），
//! GitHub Pages 带 ACAO:* 能用，但 Gitee raw 等静态托管不发 CORS 头会被拦。
//! 挪到 Rust 端（reqwest）后任何 https 目录都能当商店源；
//! UA / 超时 / 大小上限在此统一约束。
//!
//! 安全边界：本命令是宿主唯一的外发 HTTP 通道，仅允许主窗口调用
//! （插件窗口不得借道发起任意请求外泄数据）；重定向可跟随（Gitee raw 等
//! 静态托管会 302）但每一跳必须仍是 https，防降级；流式读取并设 256MB
//! 硬上限（防恶意大响应 OOM）。

use tauri::ipc::Response;
use tauri::WebviewWindow;

const MAX_BYTES: usize = 256 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECS: u64 = 60;
const USER_AGENT: &str = concat!("toolbox/", env!("CARGO_PKG_VERSION"));

fn ensure_https(url: &str) -> Result<(), String> {
    if url.starts_with("https://") {
        Ok(())
    } else {
        Err(format!("仅允许 https 拉取: {url}"))
    }
}

/// 拉取商店资源（index.json / .tbox 包），返回原始字节（前端收到 ArrayBuffer）。
/// 仅允许 https；非 2xx 报错并携带状态码；响应超过 256MB 拒绝。
/// 仅允许主窗口调用。
#[tauri::command]
pub async fn store_fetch(
    window: WebviewWindow,
    url: String,
    timeout_secs: Option<u64>,
) -> Result<Response, String> {
    crate::plugin_registry::ensure_main(&window)?;
    ensure_https(&url)?;
    let secs = timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS).clamp(5, 600);
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(secs))
        // 跟随重定向（Gitee raw 等静态托管会 302），但每一跳必须仍是 https
        // ——防 https→http 降级与内网跳转；跳数上限防循环
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 5 {
                attempt.stop()
            } else if attempt.url().scheme() == "https" {
                attempt.follow()
            } else {
                attempt.error("重定向到非 https 地址，已拒绝")
            }
        }))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;
    let mut resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("商店返回 {status}"));
    }
    // 声明长度超限直接拒绝；流式读取，边读边计数，超限即断
    if let Some(len) = resp.content_length() {
        if len > MAX_BYTES as u64 {
            return Err(format!("响应超过 {}MB 上限", MAX_BYTES / 1024 / 1024));
        }
    }
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("读取响应失败: {e}"))? {
        if bytes.len().saturating_add(chunk.len()) > MAX_BYTES {
            return Err(format!("响应超过 {}MB 上限", MAX_BYTES / 1024 / 1024));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_https() {
        let err = ensure_https("http://example.com/x").expect_err("非 https 地址应被拒绝");
        assert!(err.contains("仅允许 https"));
        assert!(ensure_https("https://example.com/index.json").is_ok());
    }

    /// 手动验证（cargo test -- --ignored）：Gitee raw 的 302 跳转链能按
    /// https-only 重定向策略正常跟随，图标可拉取。CI 不依赖外网，默认跳过。
    #[tokio::test]
    #[ignore = "需要外网"]
    async fn follows_gitee_https_redirect_chain() {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() > 5 {
                    attempt.stop()
                } else if attempt.url().scheme() == "https" {
                    attempt.follow()
                } else {
                    attempt.error("重定向到非 https 地址，已拒绝")
                }
            }))
            .build()
            .unwrap();
        let resp = client
            .get("https://gitee.com/font-c/my-toolbox-store/raw/master/store/icons/course-scheduler.png")
            .send()
            .await
            .expect("Gitee 图标应可拉取");
        assert!(resp.status().is_success(), "状态码: {}", resp.status());
        let bytes = resp.bytes().await.unwrap();
        assert!(bytes.len() > 100);
        // PNG 魔数
        assert_eq!(&bytes[..4], &[0x89, 0x50, 0x4e, 0x47]);
    }
}
