//! 主程序自动更新（specs/07）。
//!
//! 检查/下载/安装由 tauri-plugin-updater 完成：更新目录 `app-update.json`
//! 与插件商店同源静态托管（GitHub Pages 主源 + Gitee 镜像，端点配置见
//! tauri.conf.json 的 plugins.updater.endpoints，按顺序故障转移），
//! 安装包经 minisign（Ed25519）验签，公钥固定在 tauri.conf.json 的 pubkey。

/// 重启应用：更新安装完成后由前端调用（macOS 安装不会自行退出）。
#[tauri::command]
pub fn app_restart(app: tauri::AppHandle) {
    app.restart();
}
