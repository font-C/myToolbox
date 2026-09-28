//! PDF 处理内核（broker 背后）：压缩、加密、解锁。
//!
//! 全部纯 Rust 实现（lopdf + image），三平台行为一致，无外部二进制依赖。
//! 输入输出均为 PDF 字节；加密采用 PDF 2.0 标准 AES-256（V5/R6）安全处理器，
//! 与主流阅读器（Adobe / Chrome / macOS 预览）互通。

use std::collections::BTreeMap;
use std::sync::Arc;

use lopdf::encryption::crypt_filters::{Aes256CryptFilter, CryptFilter};
use lopdf::encryption::{EncryptionState, EncryptionVersion, Permissions};
use lopdf::{Document as PdfDocument, Object, ObjectId, Stream};
use rand::RngCore;

// ---------- 压缩 ----------

/// 压缩档位（对应 UI 的三档）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompressPreset {
    /// 轻：尽量保画质
    Light,
    /// 推荐：画质与体积均衡
    Recommended,
    /// 极限：最小体积
    Extreme,
}

impl CompressPreset {
    pub fn parse(s: Option<&str>) -> Result<Self, String> {
        match s.unwrap_or("recommended") {
            "light" => Ok(Self::Light),
            "recommended" => Ok(Self::Recommended),
            "extreme" => Ok(Self::Extreme),
            other => Err(format!("未知压缩档位「{other}」，应为 light / recommended / extreme")),
        }
    }

    /// 最长边像素上限与 JPEG 质量（0-100）
    fn params(self) -> (u32, u8) {
        match self {
            Self::Light => (2400, 85),
            Self::Recommended => (1600, 72),
            Self::Extreme => (1100, 55),
        }
    }
}

/// 压缩 PDF：重编码内嵌图像（JPEG 重设质量与分辨率、大尺寸无损图转 JPEG）、
/// 重压缩未压缩的内容流。文字矢量内容不受影响（保持可选中）。
pub fn compress_pdf(bytes: &[u8], preset: CompressPreset) -> Result<Vec<u8>, String> {
    let (max_dim, quality) = preset.params();
    let mut doc = load_plain(bytes)?;
    let ids: Vec<ObjectId> = doc.objects.keys().copied().collect();

    for id in ids {
        let Some(Object::Stream(stream)) = doc.objects.get(&id) else {
            continue;
        };
        let is_image = stream
            .dict
            .get(b"Subtype")
            .and_then(Object::as_name)
            .is_ok_and(|n| n == b"Image");
        if !is_image {
            continue;
        }
        let is_mask = stream
            .dict
            .get(b"ImageMask")
            .and_then(Object::as_bool)
            .is_ok_and(|b| b);
        if is_mask {
            continue;
        }
        let Ok(filters) = stream.filters() else { continue };

        let replaced: Option<(Vec<u8>, u32, u32, bool)> = if filters.len() == 1 && filters[0] == b"DCTDecode" {
            // JPEG：解码 → 降采样 → 重设质量
            recompress_jpeg(&stream.content, max_dim, quality)
        } else if filters.len() == 1 && filters[0] == b"FlateDecode" {
            // 无损图：仅当尺寸/体积可观时转 JPEG（小图标转有损反而变大变糊）
            flate_image_to_jpeg(stream, &doc, max_dim, quality)
        } else {
            None
        };

        let Some((jpeg, w, h, gray)) = replaced else { continue };
        let Some(Object::Stream(stream)) = doc.objects.get_mut(&id) else { continue };
        stream.set_content(jpeg);
        stream.dict.set("Filter", Object::Name(b"DCTDecode".to_vec()));
        stream.dict.set("Width", w as i64);
        stream.dict.set("Height", h as i64);
        stream.dict.set("BitsPerComponent", 8i64);
        stream
            .dict
            .set("ColorSpace", Object::Name(if gray { b"DeviceGray".to_vec() } else { b"DeviceRGB".to_vec() }));
        stream.dict.remove(b"DecodeParms");
        stream.dict.remove(b"Decode");
    }

    doc.compress();

    let mut out = Vec::new();
    doc.save_to(&mut out).map_err(|e| format!("生成压缩 PDF 失败: {e}"))?;
    Ok(out)
}

/// JPEG 重压缩。返回 (新字节, 宽, 高, 是否灰度)；结果没有变小则返回 None（保留原图）。
fn recompress_jpeg(jpeg: &[u8], max_dim: u32, quality: u8) -> Option<(Vec<u8>, u32, u32, bool)> {
    // CMYK（4 分量）JPEG 转码易偏色，直接跳过
    let components = jpeg_components(jpeg)?;
    if components != 1 && components != 3 {
        return None;
    }
    let img = image::load_from_memory(jpeg).ok()?;
    let gray = matches!(img.color(), image::ColorType::L8);
    let resized = if img.width().max(img.height()) > max_dim {
        img.thumbnail(max_dim, max_dim)
    } else {
        img
    };
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(&resized)
        .ok()?;
    (out.len() < jpeg.len()).then_some((out, resized.width(), resized.height(), gray))
}

/// 无损图（FlateDecode，含 PNG/TIFF 预测器）转 JPEG。
/// 仅处理 8bit 的 RGB/灰度（含 ICCBased N=1/3）；预测器由 lopdf 自动还原。
fn flate_image_to_jpeg(
    stream: &Stream,
    doc: &PdfDocument,
    max_dim: u32,
    quality: u8,
) -> Option<(Vec<u8>, u32, u32, bool)> {
    let dict = &stream.dict;
    let width = dict.get(b"Width").and_then(Object::as_i64).ok()? as u32;
    let height = dict.get(b"Height").and_then(Object::as_i64).ok()? as u32;
    let bpc = dict.get(b"BitsPerComponent").and_then(Object::as_i64).unwrap_or(8);
    if bpc != 8 || width == 0 || height == 0 {
        return None;
    }
    // 小图（图标/印章）转有损得不偿失
    let pixels = (width as u64) * (height as u64);
    if pixels < 100_000 && stream.content.len() < 96_000 {
        return None;
    }
    let (channels, is_gray) = match dict.get(b"ColorSpace") {
        Ok(cs) => match cs {
            Object::Name(name) => match name.as_slice() {
                b"DeviceRGB" => (3, false),
                b"DeviceGray" => (1, true),
                _ => return None,
            },
            Object::Array(arr) => {
                // [/ICCBased ref] → 按流字典的 /N 分量数处理；其余（Indexed/CMYK 等）跳过
                let Some(Object::Reference(id)) = arr.first() else { return None };
                let n = doc
                    .get_object(*id)
                    .ok()?
                    .as_stream()
                    .ok()?
                    .dict
                    .get(b"N")
                    .and_then(Object::as_i64)
                    .ok()?;
                match n {
                    1 => (1, true),
                    3 => (3, false),
                    _ => return None,
                }
            }
            _ => return None,
        },
        Err(_) => (3, false),
    };

    // DecodeParms 为数组形式时 lopdf 只识别字典形式，这里归一化（本就要整体替换内容）
    let mut stream = stream.clone();
    if let Ok(Object::Array(parms)) = stream.dict.get(b"DecodeParms") {
        let flate_index = stream.filters().ok()?.iter().position(|f| *f == b"FlateDecode")?;
        match parms.get(flate_index) {
            Some(p @ Object::Dictionary(_)) => {
                let p = p.clone();
                stream.dict.set("DecodeParms", p);
            }
            _ => {
                stream.dict.remove(b"DecodeParms");
            }
        }
    }
    let raw = stream.decompressed_content().ok()?;
    let need = width as usize * height as usize * channels;
    if raw.len() < need {
        return None;
    }

    let img = match (channels, is_gray) {
        (1, true) => image::DynamicImage::ImageLuma8(image::GrayImage::from_raw(width, height, raw[..need].to_vec())?),
        _ => image::DynamicImage::ImageRgb8(image::RgbImage::from_raw(width, height, raw[..need].to_vec())?),
    };
    let resized = if img.width().max(img.height()) > max_dim {
        img.thumbnail(max_dim, max_dim)
    } else {
        img
    };
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(&resized)
        .ok()?;
    (out.len() < stream.content.len()).then_some((out, resized.width(), resized.height(), is_gray))
}

/// 扫描 JPEG SOF 段获取颜色分量数（1=灰度 3=RGB 4=CMYK）。
fn jpeg_components(data: &[u8]) -> Option<u32> {
    if data.get(0..2) != Some(&[0xFF, 0xD8][..]) {
        return None;
    }
    const SOF: &[u8] = &[0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF];
    let mut i = 2;
    while i + 4 <= data.len() {
        if data[i] != 0xFF {
            return None;
        }
        let marker = data[i + 1];
        match marker {
            0xFF => {
                i += 1; // 填充字节
                continue;
            }
            0xD8 | 0x01 | 0xD0..=0xD7 => {
                i += 2;
                continue;
            }
            0xDA => return None, // 已进入扫描数据仍未见到 SOF
            _ => {}
        }
        let len = u16::from_be_bytes([data[i + 2], data[i + 3]]) as usize;
        if len < 2 || i + 2 + len > data.len() {
            return None;
        }
        if SOF.contains(&marker) {
            return Some(*data.get(i + 2 + len - 1)? as u32);
        }
        i += 2 + len;
    }
    None
}

// ---------- 加密 / 解锁 ----------

/// 为 PDF 设置打开密码（AES-256，PDF 2.0 标准）。owner_password 缺省与打开密码相同。
pub fn encrypt_pdf(bytes: &[u8], user_password: &str, owner_password: Option<&str>) -> Result<Vec<u8>, String> {
    if user_password.is_empty() {
        return Err("请输入打开密码".into());
    }
    let mut doc = load_plain(bytes)?;
    let owner = owner_password.filter(|s| !s.is_empty()).unwrap_or(user_password);

    // 标准安全处理器的参数依赖文件 /ID；缺失时补一个随机 ID
    if doc.trailer.get(b"ID").is_err() {
        let mut id = [0u8; 16];
        rand::rngs::OsRng.fill_bytes(&mut id);
        let hex = hex::encode(id);
        doc.trailer.set(
            "ID",
            Object::Array(vec![
                Object::string_literal(hex.clone()),
                Object::string_literal(hex),
            ]),
        );
    }

    let mut file_key = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut file_key);
    let state = EncryptionState::try_from(EncryptionVersion::V5 {
        encrypt_metadata: true,
        crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), Arc::new(Aes256CryptFilter) as Arc<dyn CryptFilter>)]),
        file_encryption_key: &file_key,
        stream_filter: b"StdCF".to_vec(),
        string_filter: b"StdCF".to_vec(),
        owner_password: owner,
        user_password,
        permissions: Permissions::all(),
    })
    .map_err(|e| format!("初始化加密失败: {e}"))?;

    doc.encrypt(&state).map_err(|e| format!("加密 PDF 失败: {e}"))?;

    // lopdf 生成的 crypt filter 不带 /Length；Acrobat/pypdf 宽容，但 CoreGraphics
    // （macOS 预览）会报 "unsupported crypt filter key length" 并渲染空白，必须补上。
    if let Ok(enc_ref) = doc.trailer.get(b"Encrypt").and_then(Object::as_reference) {
        if let Some(Object::Dictionary(mut encrypt_dict)) = doc.objects.get_mut(&enc_ref).map(|o| o.clone()) {
            encrypt_dict.set("Length", 256i64);
            if let Ok(Object::Dictionary(cf)) = encrypt_dict.get_mut(b"CF") {
                if let Ok(Object::Dictionary(ref mut stdcf)) = cf.get_mut(b"StdCF") {
                    stdcf.set("Length", 256i64);
                }
            }
            doc.set_object(enc_ref, Object::Dictionary(encrypt_dict));
        }
    }
    save(doc)
}

/// 去除 PDF 密码（支持 RC4 / AES-128 / AES-256 标准加密）。输出未加密副本。
///
/// 注意：lopdf 对受密码保护的文档，无密码 `load_mem` 只会得到空对象表，
/// 必须用 `LoadOptions::with_password` 在加载时完成认证与解密。
pub fn unlock_pdf(bytes: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let probe = PdfDocument::load_mem(bytes).map_err(|_| "无法解析 PDF，文件可能已损坏".to_string())?;
    if !probe.is_encrypted() {
        // 空用户密码的受限文档会在加载时自动解密（was_encrypted 标记来源）
        return if probe.was_encrypted() {
            save(probe)
        } else {
            Err("该 PDF 未加密，无需解锁".into())
        };
    }
    let doc = PdfDocument::load_mem_with_options(bytes, lopdf::LoadOptions::with_password(password))
        .map_err(|_| "密码错误，或该文档使用了不支持的加密方式".to_string())?;
    save(doc)
}

// ---------- 公共 ----------

fn load_plain(bytes: &[u8]) -> Result<PdfDocument, String> {
    let doc = PdfDocument::load_mem(bytes).map_err(|_| "无法解析 PDF，文件可能已损坏".to_string())?;
    if doc.is_encrypted() {
        return Err("该 PDF 已加密，请先用「PDF 加密 / 解锁」工具解除密码".into());
    }
    Ok(doc)
}

fn save(mut doc: PdfDocument) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    doc.save_to(&mut out).map_err(|e| format!("写出 PDF 失败: {e}"))?;
    Ok(out)
}

// ---------- 测试 ----------

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::Dictionary;
    use std::io::Write as _;

    fn name(s: &str) -> Object {
        Object::Name(s.as_bytes().to_vec())
    }

    /// 生成一张 1600×1600 渐变测试图的高质量 JPEG（压缩测试需要可再压缩的空间）
    fn sample_jpeg() -> Vec<u8> {
        let img = image::RgbImage::from_fn(1600, 1600, |x, y| {
            image::Rgb([(x % 251) as u8, (y % 241) as u8, ((x * 7 + y * 13) % 253) as u8])
        });
        let mut buf = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 95)
            .encode_image(&image::DynamicImage::ImageRgb8(img))
            .unwrap();
        buf
    }

    /// 组装最小合法文档：catalog / pages / page（lopdf 0.45 无公开 dict 宏，手工建字典）
    fn assemble(mut doc: PdfDocument, page_id: ObjectId, extra_fixups: impl FnOnce(&mut PdfDocument)) -> Vec<u8> {
        let pages_id = doc.add_object({
            let mut d = Dictionary::new();
            d.set("Type", "Pages");
            d.set("Count", 1i64);
            d.set("Kids", vec![Object::Reference(page_id)]);
            d
        });
        extra_fixups(&mut doc);
        if let Some(Object::Dictionary(page)) = doc.objects.get_mut(&page_id) {
            page.set("Parent", Object::Reference(pages_id));
        }
        let catalog_id = doc.add_object({
            let mut d = Dictionary::new();
            d.set("Type", "Catalog");
            d.set("Pages", Object::Reference(pages_id));
            d
        });
        doc.trailer.set("Root", Object::Reference(catalog_id));

        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    /// 最小合法 PDF：1 页，绘制一张 DCTDecode 图片
    fn sample_pdf() -> Vec<u8> {
        let jpeg = sample_jpeg();
        let mut doc = PdfDocument::new();

        let mut img_dict = Dictionary::new();
        img_dict.set("Type", "XObject");
        img_dict.set("Subtype", "Image");
        img_dict.set("Width", 1600i64);
        img_dict.set("Height", 1600i64);
        img_dict.set("ColorSpace", "DeviceRGB");
        img_dict.set("BitsPerComponent", 8i64);
        img_dict.set("Filter", "DCTDecode");
        let image_id = doc.add_object(Stream::new(img_dict, jpeg));

        let content_id = doc.add_object(Stream::new(
            Dictionary::new(),
            b"q 500 0 0 500 50 50 cm /Im1 Do Q".to_vec(),
        ));

        let page_id = doc.add_object({
            let mut d = Dictionary::new();
            d.set("Type", "Page");
            d.set("MediaBox", vec![Object::Integer(0), Object::Integer(0), Object::Integer(612), Object::Integer(792)]);
            d.set("Contents", Object::Reference(content_id));
            d.set(
                "Resources",
                Object::Dictionary({
                    let mut xobjs = Dictionary::new();
                    xobjs.set("Im1", Object::Reference(image_id));
                    let mut res = Dictionary::new();
                    res.set("XObject", Object::Dictionary(xobjs));
                    res
                }),
            );
            d
        });

        assemble(doc, page_id, |_| {})
    }

    /// 最小合法 PDF：纯文本页（未压缩内容流，便于解密后逐字节比对）
    fn sample_text_pdf() -> Vec<u8> {
        let content = b"BT /F1 24 Tf 72 720 Td (Hello toolbox) Tj ET".to_vec();
        let mut doc = PdfDocument::new();
        let content_id = doc.add_object(Stream::new(Dictionary::new(), content));
        let page_id = doc.add_object({
            let mut d = Dictionary::new();
            d.set("Type", "Page");
            d.set("MediaBox", vec![Object::Integer(0), Object::Integer(0), Object::Integer(612), Object::Integer(792)]);
            d.set("Contents", Object::Reference(content_id));
            d
        });

        assemble(doc, page_id, |_| {})
    }

    fn content_of(pdf: &[u8]) -> Vec<u8> {
        let doc = PdfDocument::load_mem(pdf).unwrap();
        for object in doc.objects.values() {
            let Ok(stream) = object.as_stream() else { continue };
            let no_type = stream.dict.get(b"Type").is_err();
            let no_subtype = stream.dict.get(b"Subtype").is_err();
            if no_type && no_subtype {
                return stream.get_plain_content().unwrap();
            }
        }
        panic!("未找到内容流");
    }

    #[test]
    fn compress_shrinks_image_pdf_and_keeps_structure() {
        let src = sample_pdf();
        let out = compress_pdf(&src, CompressPreset::Extreme).unwrap();
        assert!(out.len() < src.len(), "压缩后应更小: {} -> {}", src.len(), out.len());

        let doc = PdfDocument::load_mem(&out).unwrap();
        assert_eq!(doc.get_pages().len(), 1);
        let images = doc
            .objects
            .values()
            .filter(|o| {
                o.as_stream()
                    .ok()
                    .and_then(|s| s.dict.get(b"Subtype").ok())
                    .and_then(|obj| Object::as_name(obj).ok())
                    .is_some_and(|n| n == b"Image")
            })
            .count();
        assert_eq!(images, 1, "图片对象应保留");
    }

    #[test]
    fn compress_converts_large_flate_image_to_jpeg() {
        // 1200×1200 DeviceRGB 无损图（FlateDecode，无预测器）
        let raw: Vec<u8> = (0..1200u32)
            .flat_map(|y| (0..1200u32).flat_map(move |x| [(x % 251) as u8, (y % 241) as u8, ((x * 7 + y * 13) % 253) as u8]))
            .collect();
        let mut enc = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(&raw).unwrap();
        let flated = enc.finish().unwrap();

        let mut doc = PdfDocument::new();
        let mut img_dict = Dictionary::new();
        img_dict.set("Type", "XObject");
        img_dict.set("Subtype", "Image");
        img_dict.set("Width", 1200i64);
        img_dict.set("Height", 1200i64);
        img_dict.set("ColorSpace", "DeviceRGB");
        img_dict.set("BitsPerComponent", 8i64);
        img_dict.set("Filter", "FlateDecode");
        let image_id = doc.add_object(Stream::new(img_dict, flated));
        let content_id = doc.add_object(Stream::new(
            Dictionary::new(),
            b"q 500 0 0 500 50 50 cm /Im1 Do Q".to_vec(),
        ));
        let page_id = doc.add_object({
            let mut d = Dictionary::new();
            d.set("Type", "Page");
            d.set("Contents", Object::Reference(content_id));
            d
        });
        let src = assemble(doc, page_id, |_| {});

        let out = compress_pdf(&src, CompressPreset::Recommended).unwrap();
        assert!(out.len() < src.len(), "无损图应转 JPEG 变小: {} -> {}", src.len(), out.len());
        let doc2 = PdfDocument::load_mem(&out).unwrap();
        let img = doc2
            .objects
            .values()
            .filter_map(|o| o.as_stream().ok())
            .find(|s| s.dict.get(b"Subtype").and_then(Object::as_name).is_ok_and(|n| n == b"Image"))
            .expect("应保留图片对象");
        assert_eq!(img.filters().unwrap(), vec![&b"DCTDecode"[..]], "转换后应为 DCTDecode");
        assert_eq!(doc2.get_pages().len(), 1);
    }

    #[test]
    fn compress_rejects_encrypted_pdf() {
        let src = sample_text_pdf();
        let encrypted = encrypt_pdf(&src, "pw", None).unwrap();
        assert!(compress_pdf(&encrypted, CompressPreset::Light).unwrap_err().contains("已加密"));
    }

    #[test]
    fn encrypt_then_unlock_round_trip() {
        let src = sample_text_pdf();
        let encrypted = encrypt_pdf(&src, "secret-1", Some("owner-1")).unwrap();

        let reloaded = PdfDocument::load_mem(&encrypted).unwrap();
        assert!(reloaded.is_encrypted(), "输出应为加密文档");
        // crypt filter 必须带 /Length 256（CoreGraphics/macOS 预览严格校验）
        let enc_dict = reloaded
            .trailer
            .get(b"Encrypt")
            .and_then(Object::as_reference)
            .ok()
            .and_then(|id| reloaded.get_object(id).ok())
            .and_then(|o| o.as_dict().ok())
            .expect("应有 /Encrypt 字典");
        let stdcf = enc_dict
            .get(b"CF")
            .and_then(|o| Object::as_dict(&o))
            .ok()
            .and_then(|cf| cf.get(b"StdCF").ok())
            .and_then(|o| Object::as_dict(&o).ok())
            .expect("应有 StdCF 过滤器");
        let len = stdcf.get(b"Length").map(|o| Object::as_i64(&o).unwrap_or(0)).unwrap_or(0);
        assert_eq!(len, 256, "StdCF /Length 必须为 256");

        let encrypted2 = encrypted.clone();
        assert!(unlock_pdf(&encrypted2, "wrong-pw").is_err(), "错误密码必须被拒绝");

        let plain = unlock_pdf(&encrypted, "secret-1").unwrap();
        let doc = PdfDocument::load_mem(&plain).unwrap();
        assert!(!doc.is_encrypted(), "解锁后应不再加密");
        assert_eq!(doc.get_pages().len(), 1);
        assert_eq!(content_of(&plain), content_of(&src), "解密后内容流应与原件一致");
    }

    #[test]
    fn encrypt_requires_password() {
        assert!(encrypt_pdf(&sample_text_pdf(), "", None).is_err());
    }

    #[test]
    fn encrypt_rejects_already_encrypted() {
        let encrypted = encrypt_pdf(&sample_text_pdf(), "pw", None).unwrap();
        assert!(encrypt_pdf(&encrypted, "pw2", None).unwrap_err().contains("已加密"));
    }

    #[test]
    fn unlock_rejects_plain_pdf() {
        assert!(unlock_pdf(&sample_text_pdf(), "pw").unwrap_err().contains("未加密"));
    }

    #[test]
    fn preset_parse_and_params() {
        assert_eq!(CompressPreset::parse(None).unwrap(), CompressPreset::Recommended);
        assert_eq!(CompressPreset::parse(Some("light")).unwrap(), CompressPreset::Light);
        assert!(CompressPreset::parse(Some("nope")).is_err());
    }
}
