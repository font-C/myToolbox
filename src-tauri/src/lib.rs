mod app_updater;
mod broker;
mod broker_dir;
mod pdfops;
mod plugin_installer;
mod plugin_manifest;
mod plugin_protocol;
mod plugin_registry;
mod plugin_storage;
mod print;
mod store_http;

use tauri::WindowEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // 主程序自动更新（specs/07）：更新目录静态托管 + minisign 验签
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 拖拽授权表：窗口事件（拖放/销毁）与 broker 命令都会访问，必须先于任何窗口注册
        .manage(broker::GrantState::default())
        // 插件持久化 KV 存储（懒加载：首次访问时读盘）
        .manage(plugin_storage::PluginStorage::default())
        .register_uri_scheme_protocol("plugin", |ctx, request| {
            plugin_protocol::handle(ctx.app_handle(), request)
        })
        .invoke_handler(tauri::generate_handler![
            // 权限代理：插件访问系统能力的唯一通道
            broker::broker_env,
            broker::broker_open_file,
            broker::broker_save_file,
            broker::broker_read_granted,
            broker::broker_print,
            broker::broker_compress_pdf,
            broker::broker_encrypt_pdf,
            broker::broker_unlock_pdf,
            broker::broker_clipboard_read_text,
            broker::broker_clipboard_write_text,
            // 目录级访问（需 dialog:open / fs:read）：目录对比等工具用
            broker_dir::broker_pick_directory,
            broker_dir::broker_list_dir,
            broker_dir::broker_dir_info,
            // 插件持久化 KV 存储（需 storage 权限）
            plugin_storage::broker_storage_get,
            plugin_storage::broker_storage_set,
            plugin_storage::broker_storage_remove,
            plugin_storage::broker_storage_keys,
            plugin_storage::broker_storage_clear,
            // 插件生命周期
            plugin_registry::plugin_list,
            plugin_registry::plugin_open,
            plugin_registry::plugin_set_enabled,
            plugin_registry::plugin_dev_register,
            plugin_registry::plugin_dev_unregister,
            plugin_registry::plugin_dev_list,
            plugin_installer::plugin_install,
            plugin_installer::plugin_uninstall,
            // 商店资源拉取（Rust 端 HTTP，绕开 webview CORS）
            store_http::store_fetch,
            // 主程序自动更新
            app_updater::app_restart,
        ])
        .setup(|app| {
            // 插件注册表与开发插件表
            plugin_registry::init(app.handle())?;
            // 内置插件就位（安装/升级）
            plugin_installer::ensure_builtins(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::DragDrop(_) | WindowEvent::Destroyed => {
                broker::handle_window_event(window, event)
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("运行 tauri 应用时发生错误");
}
