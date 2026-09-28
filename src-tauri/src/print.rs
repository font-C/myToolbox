//! 原生 PDF 打印实现（平台相关），供主窗口旧命令（过渡期）与 broker_print 复用。
//!
//! macOS：PDFKit 文档级打印，每个 PDF 页按比例缩放适配到单张物理纸。
//! 过程阻塞直到用户完成/取消打印（`NSPrintOperation::runOperation()` 同步），无额外窗口。
//! 为避免 macOS 复用上一次打印的关联状态（导致重新框选后仍打印旧区域），每次打印：
//!   1. 将字节写入唯一临时文件，用文件 URL 加载 `PDFDocument`（隔离内存缓冲与状态）；
//!   2. 使用全新的（非共享）`NSPrintInfo` 实例，调用 `printOperationForPrintInfo:…`；
//!   3. 打印结束后删除临时文件。
//!
//! Windows：pdfium-render 把 PDF 逐页渲染成 RGBA 位图（内存），再用 Windows GDI 的
//! 文档打印链路（CreateDC → StartDocW → 逐页 StartPage/StretchDIBits/EndPage → EndDoc）
//! 输出到默认打印机。每页「按比例缩放并居中适配到单张物理纸」。

use std::fs::File;
use std::io::Write;

pub fn print_pdf_impl(app: &tauri::AppHandle, bytes: Vec<u8>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return print_macos(app, bytes);
    }
    #[cfg(target_os = "windows")]
    {
        return print_windows(app, bytes);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        let _ = bytes;
        Err("当前平台暂不支持原生 PDF 打印".to_string())
    }
}

#[cfg(target_os = "macos")]
fn print_macos(app: &tauri::AppHandle, bytes: Vec<u8>) -> Result<(), String> {
    use objc2::AnyThread;
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSPrintInfo;
    use objc2_foundation::{NSString, NSURL};
    use objc2_pdf_kit::{PDFDocument, PDFPrintScalingMode};

    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let res: Result<(), String> = (|| -> Result<(), String> {
            unsafe {
                let mtm = MainThreadMarker::new().ok_or("必须在主线程执行打印")?;

                let millis = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                let temp_path = std::env::temp_dir().join(format!("toolbox_print_{}.pdf", millis));
                let temp_path_str = temp_path.to_str().ok_or("临时文件路径无效")?;

                let mut file = File::create(&temp_path).map_err(|e| format!("创建临时文件失败: {e}"))?;
                file.write_all(&bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;

                let path_str = NSString::from_str(temp_path_str);
                let url = NSURL::fileURLWithPath(&path_str);
                let document = PDFDocument::initWithURL(PDFDocument::alloc(), &url)
                    .ok_or_else(|| "无法解析裁剪后的 PDF".to_string())?;

                // 全新（非共享）NSPrintInfo，避免复用上次打印关联的状态
                let print_info = NSPrintInfo::new();

                // 文档级打印：每个 PDF 页按比例缩放到单张纸并居中，autoRotate 自动转正
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

/// 从多个候选位置查找 pdfium 动态库（Windows）。
#[cfg(target_os = "windows")]
fn find_pdfium_lib(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use pdfium_render::prelude::Pdfium;
    use tauri::Manager;
    let lib_name = format!(
        "{}",
        Pdfium::pdfium_platform_library_name()
            .to_string_lossy()
            .replace('\\', "/") // 兼容 Windows 路径分隔符
    );
    // 1) Tauri 资源目录（tauri.conf bundle.resources 打包进来的位置）
    if let Ok(resource_dir) = app.path().resource_dir() {
        let p = resource_dir.join(&lib_name);
        if p.exists() {
            return Some(p);
        }
        let p2 = resource_dir.join("resources").join(&lib_name);
        if p2.exists() {
            return Some(p2);
        }
    }
    // 2) 可执行文件所在目录
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let p = parent.join(&lib_name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    // 3) 当前工作目录
    if let Ok(cwd) = std::env::current_dir() {
        let p = cwd.join(&lib_name);
        if p.exists() {
            return Some(p);
        }
    }
    // 4) 系统 DLL 搜索路径
    if !lib_name.contains('/') {
        return Some(std::path::PathBuf::from(&lib_name));
    }
    None
}

#[cfg(target_os = "windows")]
fn print_windows(app: &tauri::AppHandle, bytes: Vec<u8>) -> Result<(), String> {
    use pdfium_render::prelude::*;
    use windows_sys::Win32::Graphics::Gdi::{
        CreateDCW, DeleteDC, GetDeviceCaps, StretchDIBits, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, HORZRES, HORZSIZE, RGBQUAD, SRCCOPY, VERTRES, VERTSIZE,
    };
    use windows_sys::Win32::Graphics::Printing::GetDefaultPrinterW;
    use windows_sys::Win32::Storage::Xps::{EndDoc, EndPage, StartDocW, StartPage, DOCINFOW};

    // 1) 写入临时 PDF 文件
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let temp_path = std::env::temp_dir().join(format!("toolbox_print_win_{}.pdf", millis));
    let mut file = File::create(&temp_path).map_err(|e| format!("创建临时文件失败: {e}"))?;
    file.write_all(&bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;

    // 2) 绑定并加载 PDF
    let lib_path =
        find_pdfium_lib(app).ok_or("未找到 pdfium 动态库（pdfium.dll），无法渲染 PDF")?;
    let bindings = Pdfium::bind_to_library(&lib_path).map_err(|e| format!("加载 pdfium 失败: {e}"))?;
    let pdfium = Pdfium::new(bindings);
    let document =
        pdfium
            .load_pdf_from_file(&temp_path, None)
            .map_err(|e| format!("无法解析裁剪后的 PDF: {e}"))?;

    // 3) 查询默认打印机，创建打印设备上下文
    let printer_name = unsafe {
        let mut size: u32 = 0;
        let _ = GetDefaultPrinterW(std::ptr::null_mut(), &mut size);
        let mut buf: Vec<u16> = vec![0u16; size as usize];
        let ok = GetDefaultPrinterW(buf.as_mut_ptr(), &mut size);
        if ok == 0 {
            return Err("无法获取默认打印机".to_string());
        }
        while buf.last() == Some(&0) {
            buf.pop();
        }
        buf
    };
    if printer_name.is_empty() {
        return Err("系统中没有可用的默认打印机".to_string());
    }
    let mut printer_wide: Vec<u16> = printer_name.clone();
    printer_wide.push(0);

    let hdc = unsafe {
        CreateDCW(std::ptr::null(), printer_wide.as_ptr(), std::ptr::null(), std::ptr::null())
    };
    if hdc == std::ptr::null_mut() {
        return Err("创建打印机设备上下文失败".to_string());
    }

    // 4) 获取可打印区域（像素）与纸张物理尺寸（毫米）
    let print_w = unsafe { GetDeviceCaps(hdc, HORZRES as i32) };
    let print_h = unsafe { GetDeviceCaps(hdc, VERTRES as i32) };
    let paper_w_mm = unsafe { GetDeviceCaps(hdc, HORZSIZE as i32) };
    let paper_h_mm = unsafe { GetDeviceCaps(hdc, VERTSIZE as i32) };
    if print_w <= 0 || print_h <= 0 {
        let _ = unsafe { DeleteDC(hdc) };
        return Err("无法获取打印机可打印区域".to_string());
    }
    let dpi_x = (print_w as f64) / (paper_w_mm as f64 / 25.4);
    let dpi_y = (print_h as f64) / (paper_h_mm as f64 / 25.4);

    // 5) 开始文档
    let doc_name_wide: Vec<u16> = "工具箱打印".encode_utf16().chain(std::iter::once(0)).collect();
    let di = DOCINFOW {
        cbSize: std::mem::size_of::<DOCINFOW>() as i32,
        lpszDocName: doc_name_wide.as_ptr(),
        lpszOutput: std::ptr::null(),
        lpszDatatype: std::ptr::null(),
        fwType: 0,
    };
    if unsafe { StartDocW(hdc, &di) } <= 0 {
        let _ = unsafe { DeleteDC(hdc) };
        return Err("StartDoc 失败".to_string());
    }

    // 6) 逐页渲染并按比例缩放适配单张纸、居中
    let page_count = document.pages().len();
    for index in 0..page_count {
        let page = match document.pages().get(index) {
            Ok(p) => p,
            Err(e) => {
                let _ = unsafe { EndDoc(hdc) };
                let _ = unsafe { DeleteDC(hdc) };
                return Err(format!("读取第 {} 页失败: {e}", index + 1));
            }
        };
        let page_w_pt = page.width().value;
        let page_h_pt = page.height().value;

        let render_scale = (dpi_x / 72.0).max(dpi_y / 72.0).max(2.0);
        let bmp_w = (page_w_pt as f64 * render_scale).round().max(1.0);
        let bmp_h = (page_h_pt as f64 * render_scale).round().max(1.0);
        let config = PdfRenderConfig::new()
            .set_target_width(bmp_w as i32)
            .set_maximum_height(bmp_h as i32)
            .clear_before_rendering(true);
        let bitmap = page
            .render_with_config(&config)
            .map_err(|e| format!("渲染第 {} 页失败: {e}", index + 1))?;
        let image = bitmap.as_image().into_rgba8();
        let (img_w, img_h) = image.dimensions();
        let mut raw = image.into_raw(); // RGBA
        // GDI 的 BI_RGB + 32bpp 需要 BGRA，交换 R/B
        for px in raw.chunks_exact_mut(4) {
            px.swap(0, 2);
        }

        let scale = ((print_w as f64 / img_w as f64).min(print_h as f64 / img_h as f64)).min(1.0);
        let dst_w = (img_w as f64 * scale).round() as i32;
        let dst_h = (img_h as f64 * scale).round() as i32;
        let dst_x = ((print_w - dst_w) as f64 / 2.0).round() as i32;
        let dst_y = ((print_h - dst_h) as f64 / 2.0).round() as i32;

        if unsafe { StartPage(hdc) } <= 0 {
            let _ = unsafe { EndDoc(hdc) };
            let _ = unsafe { DeleteDC(hdc) };
            return Err(format!("StartPage 第 {} 页失败", index + 1));
        }

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: img_w as i32,
                biHeight: -(img_h as i32), // 负值=自上而下
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: (img_w * img_h * 4) as u32,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [RGBQUAD {
                rgbBlue: 0,
                rgbGreen: 0,
                rgbRed: 0,
                rgbReserved: 0,
            }],
        };
        let res = unsafe {
            StretchDIBits(
                hdc,
                dst_x,
                dst_y,
                dst_w,
                dst_h,
                0,
                0,
                img_w as i32,
                img_h as i32,
                raw.as_ptr() as *const core::ffi::c_void,
                &bmi,
                DIB_RGB_COLORS,
                SRCCOPY,
            )
        };
        if res == -1 {
            let _ = unsafe { EndDoc(hdc) };
            let _ = unsafe { DeleteDC(hdc) };
            return Err(format!("绘制第 {} 页失败", index + 1));
        }
        if unsafe { EndPage(hdc) } <= 0 {
            let _ = unsafe { EndDoc(hdc) };
            let _ = unsafe { DeleteDC(hdc) };
            return Err(format!("EndPage 第 {} 页失败", index + 1));
        }
    }

    // 7) 结束文档，清理资源
    let doc_ok = unsafe { EndDoc(hdc) } > 0;
    let _ = unsafe { DeleteDC(hdc) };
    let _ = std::fs::remove_file(&temp_path);

    if !doc_ok {
        return Err("EndDoc 失败".to_string());
    }
    Ok(())
}
