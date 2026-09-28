use std::fs;
use std::path::Path;

fn main() {
    // 前端产物变化时强制重编译：generate_context! 在编译期嵌入 ../dist，
    // 若不声明，dist 更新后 cargo 会复用旧二进制（表现为启动后仍是旧页面）。
    println!("cargo:rerun-if-changed=../dist");

    // 内置插件的 .tbox 由 `npm run build:plugins` 生成到 src-tauri/builtin/，
    // 源码经 include_bytes! 嵌入。这里保证文件存在（缺失时写入空占位，
    // 运行时空包解析失败会被跳过），避免 cargo build 因产物未生成而失败。
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("builtin");
    if fs::create_dir_all(&dir).is_ok() {
        for name in [
            "mental-math",
            "pdf-crop",
            "pdf-compose",
            "pdf-split",
            "pdf-compress",
            "pdf-crypt",
            "qr-tools",
            "image-compress",
            "daily-calc",
            "clipboard-history",
            "text-tools",
            "password-gen",
            "class-tools",
            "gif-maker",
            "pic-merge",
        ] {
            let p = dir.join(format!("{name}.tbox"));
            if !p.exists() {
                let _ = fs::write(&p, b"");
            }
        }
    }
    tauri_build::build()
}
