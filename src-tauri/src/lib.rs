use std::fs::File;
use std::io::Write;

/// 将裁剪导出的 PDF 字节写入用户选择的本地路径。
#[tauri::command]
fn save_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let mut file = File::create(&path).map_err(|e| format!("无法创建文件: {e}"))?;
    file.write_all(&bytes)
        .map_err(|e| format!("写入失败: {e}"))?;
    Ok(())
}

/// 直接打印裁剪后的 PDF 字节。
/// macOS：用 PDFKit 的文档级打印接口，每个 PDF 页都「按比例缩放适配到单张物理纸」，
/// 避免之前 `PDFView + NSPrintOperation` 按纸张切片带来的右侧缺失、单页被拆成多页问题。
/// 过程阻塞直到用户完成/取消打印（`NSPrintOperation::runOperation()` 同步），无额外窗口。
/// 为避免 macOS 复用上一次打印的关联状态（导致重新框选后仍打印旧区域），每次打印：
///   1. 将字节写入唯一临时文件，用文件 URL 加载 `PDFDocument`（隔离内存缓冲与状态）；
///   2. 使用全新的（非共享）`NSPrintInfo` 实例，调用 `printOperationForPrintInfo:…`；
///   3. 打印结束后删除临时文件。
/// 其它平台暂不支持，返回明确错误。
#[cfg(target_os = "macos")]
#[tauri::command]
fn print_pdf(app: tauri::AppHandle, bytes: Vec<u8>) -> Result<(), String> {
    use objc2::AnyThread;
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSPrintInfo;
    use objc2_foundation::{NSString, NSURL};
    use objc2_pdf_kit::{PDFDocument, PDFPrintScalingMode};
    use std::env;
    use std::time::{SystemTime, UNIX_EPOCH};

    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let res: Result<(), String> = (|| -> Result<(), String> {
            unsafe {
                let mtm = MainThreadMarker::new().ok_or("必须在主线程执行打印")?;

                // 生成唯一临时文件名
                let millis = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                let temp_path = env::temp_dir().join(format!("toolbox_print_{}.pdf", millis));
                let temp_path_str = temp_path.to_str().ok_or("临时文件路径无效")?;

                // 写入临时文件
                let mut file = File::create(&temp_path).map_err(|e| format!("创建临时文件失败: {e}"))?;
                file.write_all(&bytes)
                    .map_err(|e| format!("写入临时文件失败: {e}"))?;

                // 从文件加载 PDF 文档（每次都由全新文件加载，杜绝加载上一次文档）
                let path_str = NSString::from_str(temp_path_str);
                let url = NSURL::fileURLWithPath(&path_str);
                let document = PDFDocument::initWithURL(PDFDocument::alloc(), &url)
                    .ok_or_else(|| "无法解析裁剪后的 PDF".to_string())?;

                // 全新（非共享）NSPrintInfo，避免复用上次打印关联的状态
                let print_info = NSPrintInfo::new();

                // 文档级打印：每个 PDF 页按比例缩放到单张纸并居中，autoRotate 自动转正，
                // 不会裁掉右侧内容，也不会把一个页面拆成多页。
                let operation = document
                    .printOperationForPrintInfo_scalingMode_autoRotate(
                        Some(&print_info),
                        PDFPrintScalingMode::PageScaleToFit,
                        true,
                        mtm,
                    )
                    .ok_or_else(|| "创建打印操作失败".to_string())?;

                // 同步运行，阻塞直到用户处理完打印对话框才返回
                operation.runOperation();

                // 打印结束后清理临时文件
                if let Err(e) = std::fs::remove_file(&temp_path) {
                    eprintln!("清理临时文件失败: {e}");
                }
                Ok(())
            }
        })();
        let _ = tx.send(res);
    })
    .map_err(|e| format!("启动打印线程失败: {e}"))?;

    match rx.recv() {
        Ok(res) => res,
        Err(e) => Err(format!("打印线程异常: {e}")),
    }
}

/// 非 macOS 平台的打印占位（当前仅支持 macOS 原生打印）。
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn print_pdf(_app: tauri::AppHandle, _bytes: Vec<u8>) -> Result<(), String> {
    Err("当前平台暂不支持原生 PDF 打印".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_bytes, print_pdf])
        .run(tauri::generate_context!())
        .expect("运行 tauri 应用时发生错误");
}