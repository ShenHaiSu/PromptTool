//! 图片内嵌生图参数（need06）：PNG-iTXt / JPG-COM 嵌入与解析。
//!
//! - 纯函数，无 IO；嵌入失败调用方回退原图落盘（任务仍成功）。
//! - 零新依赖：CRC32 手写 IEEE 表驱动。
//! - 文件第 0 字节魔数永不变：PNG 签名 / JPG SOI 均保留在 offset 0。

/// PNG `iTXt` keyword（用户已确认）。
pub const PNG_KEYWORD: &[u8] = b"PromptTool:Meta";
/// JPG `COM` payload 魔术头 5B（用户已确认）。
pub const JPG_MAGIC: &[u8] = b"PMF1\x00";
/// JPG 单 COM 切片上限（payload 上限 65533，留余量取 60000）。
pub const JPG_SLICE: usize = 60000;

const PNG_SIG: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

fn crc32_ieee(data: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for (i, slot) in table.iter_mut().enumerate() {
        let mut c = i as u32;
        for _ in 0..8 {
            c = if c & 1 == 1 { 0xEDB88320 ^ (c >> 1) } else { c >> 1 };
        }
        *slot = c;
    }
    let mut crc = 0xFFFFFFFFu32;
    for b in data {
        crc = table[((crc ^ (*b as u32)) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc ^ 0xFFFFFFFF
}

/// PNG 嵌入：签名(8B) + IHDR 之后、`IDAT` 之前插入单个 `iTXt` 块。
pub fn embed_png(raw: &[u8], meta_json: &[u8]) -> Result<Vec<u8>, String> {
    if raw.len() < 33 || raw[..8] != PNG_SIG {
        return Err("非 PNG".to_string());
    }
    let ihdr_len = u32::from_be_bytes([raw[8], raw[9], raw[10], raw[11]]) as usize;
    if raw[12..16] != *b"IHDR" {
        return Err("首块非 IHDR".to_string());
    }
    let ihdr_end = 16usize
        .checked_add(ihdr_len)
        .and_then(|v| v.checked_add(4))
        .ok_or_else(|| "IHDR 截断".to_string())?;
    if ihdr_end > raw.len() {
        return Err("IHDR 截断".to_string());
    }
    // data = keyword + 0x00 + 0x00(不压缩) + 0x00(压缩方法) + 0x00(lang="") + 0x00(translated="") + JSON
    let mut data = Vec::with_capacity(PNG_KEYWORD.len() + 5 + meta_json.len());
    data.extend_from_slice(PNG_KEYWORD);
    data.extend_from_slice(&[0x00, 0x00, 0x00, 0x00, 0x00]);
    data.extend_from_slice(meta_json);

    let mut chunk = Vec::with_capacity(12 + data.len());
    chunk.extend_from_slice(&(data.len() as u32).to_be_bytes());
    chunk.extend_from_slice(b"iTXt");
    chunk.extend_from_slice(&data);
    let mut crc_input = Vec::with_capacity(4 + data.len());
    crc_input.extend_from_slice(b"iTXt");
    crc_input.extend_from_slice(&data);
    chunk.extend_from_slice(&crc32_ieee(&crc_input).to_be_bytes());

    let mut out = Vec::with_capacity(raw.len() + chunk.len());
    out.extend_from_slice(&raw[..ihdr_end]);
    out.extend_from_slice(&chunk);
    out.extend_from_slice(&raw[ihdr_end..]);
    Ok(out)
}

/// JPG 嵌入：SOI 之后、跳过全部 `APPn`，在第一个非 APPn 段之前插入 `COM` 段（多段按 index/total 切片）。
pub fn embed_jpg(raw: &[u8], meta_json: &[u8]) -> Result<Vec<u8>, String> {
    if raw.len() < 2 || raw[0] != 0xFF || raw[1] != 0xD8 {
        return Err("非 JPEG".to_string());
    }
    let mut pos = 2usize;
    loop {
        if pos + 1 >= raw.len() {
            return Err("marker 错位".to_string());
        }
        if raw[pos] != 0xFF {
            return Err("marker 错位".to_string());
        }
        let m = raw[pos + 1];
        if m == 0xDA {
            break; // SOS：插入点即此处
        }
        if (0xE0..=0xEF).contains(&m) {
            if pos + 3 >= raw.len() {
                return Err("段长度越界".to_string());
            }
            let len = u16::from_be_bytes([raw[pos + 2], raw[pos + 3]]) as usize;
            if len < 2 || pos + 2 + len > raw.len() {
                return Err("段长度越界".to_string());
            }
            pos += 2 + len;
            continue;
        }
        if m == 0xD8 || (0xD0..=0xD7).contains(&m) || m == 0x01 {
            pos += 2;
            continue;
        }
        break; // DQT/DHT/SOF/SOS 等：插入点
    }

    // 分段：空 JSON 视为 1 段（拼回 "" 后 from_str 失败→调用方可见 Err，符合直觉）。
    let slices: Vec<&[u8]> = if meta_json.is_empty() {
        vec![&[]]
    } else {
        meta_json.chunks(JPG_SLICE).collect()
    };
    let total = slices.len();
    if total > 255 {
        return Err("JSON 过大（分段超 255）".to_string());
    }
    let mut segs = Vec::with_capacity(total * 16);
    for (i, s) in slices.iter().enumerate() {
        let mut payload = Vec::with_capacity(JPG_MAGIC.len() + 2 + s.len());
        payload.extend_from_slice(JPG_MAGIC);
        payload.push(i as u8);
        payload.push(total as u8);
        payload.extend_from_slice(s);
        segs.extend_from_slice(&[0xFF, 0xFE]);
        segs.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
        segs.extend_from_slice(&payload);
    }
    let mut out = Vec::with_capacity(raw.len() + segs.len());
    out.extend_from_slice(&raw[..pos]);
    out.extend_from_slice(&segs);
    out.extend_from_slice(&raw[pos..]);
    Ok(out)
}

/// 解析内嵌元数据：返回与旧 sidecar 同构的 JSON。
/// 无内嵌数据 → `Ok(None)`；格式损坏 → `Err`。`ext` 非 png/jpg → `Ok(None)`。
pub fn extract_embedded_meta(bytes: &[u8], ext: &str) -> Result<Option<serde_json::Value>, String> {
    let ext = ext.to_ascii_lowercase();
    match ext.as_str() {
        "png" => extract_png(bytes),
        "jpg" | "jpeg" => extract_jpg(bytes),
        _ => Ok(None),
    }
}

fn png_itxt_prefix() -> Vec<u8> {
    let mut p = Vec::with_capacity(PNG_KEYWORD.len() + 5);
    p.extend_from_slice(PNG_KEYWORD);
    p.extend_from_slice(&[0x00, 0x00, 0x00, 0x00, 0x00]);
    p
}

fn extract_png(bytes: &[u8]) -> Result<Option<serde_json::Value>, String> {
    if bytes.len() < 8 || bytes[..8] != PNG_SIG {
        return Err("非 PNG".to_string());
    }
    let prefix = png_itxt_prefix();
    let mut pos = 8usize;
    loop {
        if pos + 8 > bytes.len() {
            break;
        }
        let len = u32::from_be_bytes([bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]]) as usize;
        let typ = &bytes[pos + 4..pos + 8];
        let data_start = pos + 8;
        let data_end = data_start.checked_add(len).ok_or_else(|| "PNG chunk 越界".to_string())?;
        let chunk_end = data_end.checked_add(4).ok_or_else(|| "PNG chunk 越界".to_string())?;
        if chunk_end > bytes.len() {
            return Err("PNG chunk 越界".to_string());
        }
        if typ == b"iTXt" {
            let data = &bytes[data_start..data_end];
            if data.len() >= prefix.len() && data[..prefix.len()] == prefix[..] {
                let json_bytes = &data[prefix.len()..];
                let s = std::str::from_utf8(json_bytes).map_err(|e| format!("内嵌 JSON 解析失败：{}", e))?;
                let v: serde_json::Value =
                    serde_json::from_str(s).map_err(|e| format!("内嵌 JSON 解析失败：{}", e))?;
                return Ok(Some(v));
            }
        }
        if typ == b"IEND" {
            break;
        }
        pos = chunk_end;
    }
    Ok(None)
}

fn extract_jpg(bytes: &[u8]) -> Result<Option<serde_json::Value>, String> {
    if bytes.len() < 2 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return Err("非 JPEG".to_string());
    }
    // (index, total, slice)
    let mut parts: Vec<(u8, u8, Vec<u8>)> = Vec::new();
    let mut pos = 2usize;
    while pos + 1 < bytes.len() {
        if bytes[pos] != 0xFF {
            return Err("marker 错位".to_string());
        }
        // 跳过 FF 填充字节
        if bytes[pos + 1] == 0xFF {
            pos += 1;
            continue;
        }
        // stuffed 00（仅熵编码流中出现，SOS 前不应出现；遇则错位）
        if bytes[pos + 1] == 0x00 {
            return Err("marker 错位".to_string());
        }
        let m = bytes[pos + 1];
        if m == 0xDA {
            break; // SOS：后面是图像流，停止扫描
        }
        if m == 0xD9 {
            break; // EOI：扫完
        }
        if m == 0xD8 || (0xD0..=0xD7).contains(&m) || m == 0x01 {
            pos += 2;
            continue;
        }
        if pos + 3 >= bytes.len() {
            return Err("段长度越界".to_string());
        }
        let len = u16::from_be_bytes([bytes[pos + 2], bytes[pos + 3]]) as usize;
        if len < 2 || pos + 2 + len > bytes.len() {
            return Err("段长度越界".to_string());
        }
        if m == 0xFE {
            let payload = &bytes[pos + 4..pos + 2 + len];
            if payload.len() >= JPG_MAGIC.len() + 2 && payload[..JPG_MAGIC.len()] == JPG_MAGIC[..] {
                let index = payload[JPG_MAGIC.len()];
                let total = payload[JPG_MAGIC.len() + 1];
                if total == 0 || index >= total {
                    return Err("COM 分段头非法".to_string());
                }
                parts.push((index, total, payload[JPG_MAGIC.len() + 2..].to_vec()));
            }
        }
        pos += 2 + len;
    }
    if parts.is_empty() {
        return Ok(None);
    }
    let total = parts[0].1;
    if parts.iter().any(|(_, t, _)| *t != total) {
        return Err("COM 分段头非法".to_string());
    }
    // 去重后不足 total → 缺片
    let mut slots: Vec<Option<Vec<u8>>> = (0..total as usize).map(|_| None).collect();
    for (index, _, slice) in parts {
        if slots[index as usize].is_none() {
            slots[index as usize] = Some(slice);
        }
    }
    if slots.iter().any(|s| s.is_none()) {
        return Err("COM 分段缺失（index 去重后不足 total）".to_string());
    }
    let mut json_bytes = Vec::new();
    for s in slots.into_iter().flatten() {
        json_bytes.extend_from_slice(&s);
    }
    let s = std::str::from_utf8(&json_bytes).map_err(|e| format!("内嵌 JSON 解析失败：{}", e))?;
    let v: serde_json::Value = serde_json::from_str(s).map_err(|e| format!("内嵌 JSON 解析失败：{}", e))?;
    Ok(Some(v))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_png() -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&PNG_SIG);
        // IHDR len=13
        v.extend_from_slice(&13u32.to_be_bytes());
        v.extend_from_slice(b"IHDR");
        v.extend_from_slice(&[0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]); // 1x1 RGB
        v.extend_from_slice(&0u32.to_be_bytes()); // CRC 占位（嵌入逻辑不校验）
        // IDAT（空负载）
        v.extend_from_slice(&0u32.to_be_bytes());
        v.extend_from_slice(b"IDAT");
        v.extend_from_slice(&crc32_ieee(b"IDAT").to_be_bytes());
        // IEND
        v.extend_from_slice(&0u32.to_be_bytes());
        v.extend_from_slice(b"IEND");
        v.extend_from_slice(&0xAE426082u32.to_be_bytes());
        v
    }

    fn minimal_jpg() -> Vec<u8> {
        let mut v = vec![0xFF, 0xD8];
        // APP0 len=16
        v.extend_from_slice(&[0xFF, 0xE0, 0x00, 0x10]);
        v.extend_from_slice(b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00");
        // DQT len=0x43
        v.extend_from_slice(&[0xFF, 0xDB, 0x00, 0x43, 0x00]);
        v.extend_from_slice(&[0u8; 64]);
        // SOF0 len=11
        v.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]);
        // SOS len=8
        v.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]);
        // EOI
        v.extend_from_slice(&[0xFF, 0xD9]);
        v
    }

    fn sample_meta() -> Vec<u8> {
        serde_json::json!({
            "prompt": "a small glass cube on a white studio background 中文提示词",
            "irHash": null,
            "size": "1K",
            "ratio": "1:1",
            "model": "agnes-image-2.5-flash",
            "imageUrl": "https://platform-outputs.agnes-ai.space/x.png",
            "elapsedMs": 12345,
            "createdAt": 1720000000,
            "taskId": "test-uuid"
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn crc32_known_vector() {
        assert_eq!(crc32_ieee(b"123456789"), 0xCBF43926);
    }

    #[test]
    fn png_embed_keeps_magic() {
        let raw = minimal_png();
        let out = embed_png(&raw, &sample_meta()).unwrap();
        assert_eq!(&out[..8], &PNG_SIG);
        // 第二块为 iTXt：IHDR 结束位置后 8 字节
        let ihdr_len = u32::from_be_bytes([raw[8], raw[9], raw[10], raw[11]]) as usize;
        let ihdr_end = 16 + ihdr_len + 4;
        let second_type = &out[ihdr_end + 4..ihdr_end + 8];
        assert_eq!(second_type, b"iTXt");
        // keyword 匹配
        let data_start = ihdr_end + 8;
        assert_eq!(&out[data_start..data_start + PNG_KEYWORD.len()], PNG_KEYWORD);
    }

    #[test]
    fn png_crc_valid() {
        let raw = minimal_png();
        let out = embed_png(&raw, &sample_meta()).unwrap();
        let ihdr_len = u32::from_be_bytes([raw[8], raw[9], raw[10], raw[11]]) as usize;
        let ihdr_end = 16 + ihdr_len + 4;
        let len = u32::from_be_bytes([out[ihdr_end], out[ihdr_end + 1], out[ihdr_end + 2], out[ihdr_end + 3]]) as usize;
        let typ_data = &out[ihdr_end + 4..ihdr_end + 8 + len];
        let crc = u32::from_be_bytes([
            out[ihdr_end + 8 + len],
            out[ihdr_end + 8 + len + 1],
            out[ihdr_end + 8 + len + 2],
            out[ihdr_end + 8 + len + 3],
        ]);
        assert_eq!(crc32_ieee(typ_data), crc);
    }

    #[test]
    fn png_roundtrip() {
        let raw = minimal_png();
        let meta = sample_meta();
        let out = embed_png(&raw, &meta).unwrap();
        let back = extract_embedded_meta(&out, "png").unwrap().expect("应解析出 meta");
        let expect: serde_json::Value = serde_json::from_slice(&meta).unwrap();
        assert_eq!(back, expect);
    }

    #[test]
    fn png_bad_input_falls_back() {
        assert!(embed_png(b"not a png", b"{}").is_err());
        // 首块非 IHDR
        let mut bad = minimal_png();
        bad[12..16].copy_from_slice(b"IDAT");
        assert!(embed_png(&bad, b"{}").is_err());
        // IHDR 截断
        let truncated = &minimal_png()[..20];
        assert!(embed_png(truncated, b"{}").is_err());
    }

    #[test]
    fn jpg_embed_keeps_soi() {
        let raw = minimal_jpg();
        let out = embed_jpg(&raw, &sample_meta()).unwrap();
        assert_eq!(&out[..2], &[0xFF, 0xD8]);
        // APP0 仍在 COM 之前：第一个 COM 出现位置应在 APP0 结束之后
        let app0_end: usize;
        {
            let len = u16::from_be_bytes([raw[4], raw[5]]) as usize;
            app0_end = 2 + 2 + len;
        }
        // 在 out 中定位第一个 FF FE
        let mut com_pos = None;
        for i in 0..out.len().saturating_sub(1) {
            if out[i] == 0xFF && out[i + 1] == 0xFE {
                com_pos = Some(i);
                break;
            }
        }
        let com_pos = com_pos.expect("应有 COM 段");
        assert!(com_pos >= app0_end, "APP0 应仍在 COM 之前");
    }

    #[test]
    fn jpg_roundtrip_single() {
        let raw = minimal_jpg();
        let meta = sample_meta();
        assert!(meta.len() < JPG_SLICE);
        let out = embed_jpg(&raw, &meta).unwrap();
        let back = extract_embedded_meta(&out, "jpg").unwrap().expect("应解析出 meta");
        let expect: serde_json::Value = serde_json::from_slice(&meta).unwrap();
        assert_eq!(back, expect);
    }

    #[test]
    fn jpg_roundtrip_multi() {
        let raw = minimal_jpg();
        // 构造 >60000 字节 JSON：长 prompt 填充
        let big_prompt = "x".repeat(65000);
        let meta = serde_json::json!({ "prompt": big_prompt, "size": "1K" }).to_string().into_bytes();
        assert!(meta.len() > JPG_SLICE);
        let out = embed_jpg(&raw, &meta).unwrap();
        let back = extract_embedded_meta(&out, "jpg").unwrap().expect("多段应拼回");
        let expect: serde_json::Value = serde_json::from_slice(&meta).unwrap();
        assert_eq!(back, expect);
    }

    #[test]
    fn jpg_bad_input_falls_back() {
        assert!(embed_jpg(b"not jpeg", b"{}").is_err());
        // 段长度越界：APP0 声明超长
        let mut bad = minimal_jpg();
        bad[4] = 0xFF;
        bad[5] = 0xFF;
        assert!(embed_jpg(&bad, b"{}").is_err());
    }

    #[test]
    fn extract_none_for_plain() {
        assert_eq!(extract_embedded_meta(&minimal_png(), "png").unwrap(), None);
        assert_eq!(extract_embedded_meta(&minimal_jpg(), "jpg").unwrap(), None);
        assert_eq!(extract_embedded_meta(&minimal_png(), "webp").unwrap(), None);
    }

    #[test]
    fn extract_missing_segment() {
        let raw = minimal_jpg();
        let big_prompt = "y".repeat(65000);
        let meta = serde_json::json!({ "prompt": big_prompt }).to_string().into_bytes();
        let out = embed_jpg(&raw, &meta).unwrap();
        // 删掉第二个 COM 段（fixture 删一段）→ 缺片 Err
        let mut first = None;
        let mut second = None;
        let mut i = 0;
        while i + 1 < out.len() {
            if out[i] == 0xFF && out[i + 1] == 0xFE {
                let len = u16::from_be_bytes([out[i + 2], out[i + 3]]) as usize;
                if first.is_none() {
                    first = Some((i, len));
                } else {
                    second = Some((i, len));
                    break;
                }
                i += 2 + len;
            } else {
                i += 1;
            }
        }
        let (s, len) = second.expect("多段 fixture 应有第二段");
        let mut cut = Vec::new();
        cut.extend_from_slice(&out[..s]);
        cut.extend_from_slice(&out[s + 2 + len..]);
        let err = extract_embedded_meta(&cut, "jpg").unwrap_err();
        assert!(err.contains("分段缺失"), "实际：{}", err);
    }
}
