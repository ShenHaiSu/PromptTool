use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::db::find_module_hit;
use super::meta::open_active_conn as open_conn;


fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ------------------------------------------------------------------
// Payload / Report types (camelCase for invoke)
// ------------------------------------------------------------------
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentImportItem {
    pub dimension_key: String,
    pub dimension_id: Option<String>,
    pub content_en: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub weight: Option<f64>,
    #[serde(default)]
    pub is_nsfw: Option<bool>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentPromptPayload {
    pub id: String,
    pub raw: String,
    pub segments: Vec<SegmentImportItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentImportPayload {
    pub format: String,
    pub format_version: i64,
    pub prompts: Vec<SegmentPromptPayload>,
    #[serde(default = "default_unassigned_strategy")]
    pub unassigned_strategy: String,
    #[serde(default = "default_mode")]
    pub mode: String,
}

fn default_unassigned_strategy() -> String {
    "ignore".to_string()
}
fn default_mode() -> String {
    "skip".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentImportReport {
    pub prompts: i64,
    pub segments_total: i64,
    pub segments_imported: i64,
    pub segments_skipped: i64,
    pub segments_ignored_unassigned: i64,
    pub modules_created: i64,
    pub modules_updated: i64,
    pub modules_skipped: i64,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

fn parse_segments_text_payload(text: &str) -> Result<SegmentImportPayload, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("输入为空".to_string());
    }
    // Try direct parse
    let v: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("JSON 解析失败: {}", e))?;
    // If top-level has prompts array, treat as batch
    if v.get("prompts").and_then(|x| x.as_array()).is_some() {
        let payload: SegmentImportPayload = serde_json::from_value(v.clone())
            .map_err(|e| format!("格式校验失败: {}", e))?;
        validate_payload_meta(&payload)?;
        return Ok(payload);
    }
    // Single-entry shorthand: { raw, segments }
    if v.get("raw").is_some() && v.get("segments").is_some() {
        let raw = v.get("raw").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let segs: Vec<SegmentImportItem> = serde_json::from_value(
            v.get("segments").cloned().unwrap_or(serde_json::Value::Array(vec![])),
        )
        .map_err(|e| format!("segments 解析失败: {}", e))?;
        let fmt = v
            .get("format")
            .and_then(|x| x.as_str())
            .unwrap_or("pmf-segments")
            .to_string();
        let ver = v
            .get("formatVersion")
            .and_then(|x| x.as_i64())
            .unwrap_or(1);
        let payload = SegmentImportPayload {
            format: fmt,
            format_version: ver,
            prompts: vec![SegmentPromptPayload { id: "p01".to_string(), raw, segments: segs }],
            unassigned_strategy: "ignore".to_string(),
            mode: "skip".to_string(),
        };
        validate_payload_meta(&payload)?;
        return Ok(payload);
    }
    Err("无法识别的 pmf-segments 格式，需包含 prompts 或 raw+segments".to_string())
}

fn validate_payload_meta(payload: &SegmentImportPayload) -> Result<(), String> {
    if payload.format != "pmf-segments" {
        return Err(format!(
            "不支持的格式 '{}'（应为 pmf-segments）",
            payload.format
        ));
    }
    if payload.format_version != 1 {
        return Err(format!(
            "不支持的格式版本 {}（当前支持 1）",
            payload.format_version
        ));
    }
    Ok(())
}

// ------------------------------------------------------------------
// Core import logic (shared)
// ------------------------------------------------------------------
fn import_segments_into(
    conn: &rusqlite::Connection,
    payload: &SegmentImportPayload,
) -> Result<SegmentImportReport, String> {
    validate_payload_meta(payload)?;

    let mode = payload.mode.as_str();
    if mode != "skip" && mode != "overwrite" {
        return Err(format!("未知导入模式 '{}'（可选：skip / overwrite）", mode));
    }
    let unassigned = payload.unassigned_strategy.as_str();
    if unassigned != "ignore" && unassigned != "to_camera" && unassigned != "prompt_new" {
        return Err(format!(
            "未知未分配策略 '{}'（可选：ignore / to_camera / prompt_new）",
            unassigned
        ));
    }
    let is_overwrite = mode == "overwrite";

    // For "prompt_new" we do a pre-check: if any unassigned present, error out without writing
    if unassigned == "prompt_new" {
        let has_unassigned = payload.prompts.iter().any(|p| {
            p.segments
                .iter()
                .any(|s| s.dimension_key.trim().eq_ignore_ascii_case("unassigned"))
        });
        if has_unassigned {
            return Err("存在未分配片段（unassigned），请先新建维度或重映射后再导入".to_string());
        }
    }

    // Build dimension key -> id map (case-insensitive)
    let mut dim_key_to_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, key FROM dimensions WHERE is_deleted=0")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (id, key) = r.map_err(|e| e.to_string())?;
            dim_key_to_id.insert(key.to_lowercase(), id);
        }
    }

    let mut report = SegmentImportReport {
        prompts: payload.prompts.len() as i64,
        segments_total: 0,
        segments_imported: 0,
        segments_skipped: 0,
        segments_ignored_unassigned: 0,
        modules_created: 0,
        modules_updated: 0,
        modules_skipped: 0,
        errors: Vec::new(),
        warnings: Vec::new(),
    };

    // Count total segments
    for p in &payload.prompts {
        report.segments_total += p.segments.len() as i64;
    }

    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| format!("开始事务失败: {}", e))?;
    let tx_result: Result<(), String> = (|| {
        for prompt in &payload.prompts {
            if prompt.raw.trim().is_empty() {
                report.errors.push(format!("prompt '{}' raw 为空，已跳过其全部片段", prompt.id));
                continue;
            }
            for seg in &prompt.segments {
                let mut key = seg.dimension_key.trim().to_string();
                if key.is_empty() {
                    report.errors.push(format!(
                        "prompt '{}' 存在空 dimensionKey 的片段，已跳过（contentEn={:?}）",
                        prompt.id, seg.content_en
                    ));
                    continue;
                }
                let key_lower = key.to_lowercase();
                // Handle unassigned strategy
                if key_lower == "unassigned" {
                    if unassigned == "ignore" {
                        report.segments_ignored_unassigned += 1;
                        continue;
                    } else if unassigned == "to_camera" {
                        key = "camera".to_string();
                    } else {
                        // prompt_new already early-returned; this branch unreachable
                        report.segments_ignored_unassigned += 1;
                        continue;
                    }
                }

                let content_en = seg.content_en.trim().to_string();
                if content_en.is_empty() {
                    report.warnings.push(format!(
                        "prompt '{}' dimension '{}' 的片段 contentEn 为空，已跳过",
                        prompt.id, key
                    ));
                    continue;
                }
                if content_en.len() > 500 {
                    report.warnings.push(format!(
                        "prompt '{}' dimension '{}' contentEn 超长，已截断至 500",
                        prompt.id, key
                    ));
                }
                let content_en = content_en.chars().take(500).collect::<String>();

                // Resolve dimension id (case-insensitive)
                let dim_id_opt: Option<String> = dim_key_to_id.get(&key.to_lowercase()).cloned().or_else(|| {
                    // Fallback: try dimensionId if provided
                    if let Some(ref did) = seg.dimension_id {
                        let trimmed = did.trim();
                        if !trimmed.is_empty() {
                            // verify it exists
                            let exists: Option<String> = conn
                                .query_row(
                                    "SELECT id FROM dimensions WHERE id=?1 AND is_deleted=0",
                                    params![trimmed],
                                    |r| r.get(0),
                                )
                                .ok();
                            return exists;
                        }
                    }
                    None
                });

                let dim_id = match dim_id_opt {
                    Some(id) => id,
                    None => {
                        report.errors.push(format!(
                            "维度 '{}' 不存在（prompt '{}'，contentEn={:?}），已跳过",
                            key, prompt.id, content_en
                        ));
                        continue;
                    }
                };

                // Prepare display_name fallback
                let display_name = seg
                    .display_name
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|| content_en.chars().take(20).collect::<String>());

                let mut weight = seg.weight.unwrap_or(1.0);
                if !weight.is_finite() {
                    report.warnings.push(format!(
                        "prompt '{}' dimension '{}' weight 非数值，已重置为 1.0",
                        prompt.id, key
                    ));
                    weight = 1.0;
                }
                if weight < 0.5 || weight > 2.0 {
                    let clamped = weight.clamp(0.5, 2.0);
                    let clamped_rounded = (clamped * 10.0).round() / 10.0;
                    report.warnings.push(format!(
                        "prompt '{}' dimension '{}' weight {} 超范围，已 clamp 至 {}",
                        prompt.id, key, weight, clamped_rounded
                    ));
                    weight = clamped_rounded;
                } else {
                    weight = (weight * 10.0).round() / 10.0;
                }

                let is_nsfw = seg.is_nsfw.unwrap_or(false);

                // Build ModuleDto-like for dedup helpers
                let fmod = super::db::ModuleDto {
                    id: String::new(),
                    dimension_id: dim_id.clone(),
                    content_en: content_en.clone(),
                    display_name: display_name.clone(),
                    weight,
                    is_enabled: true,
                    is_nsfw,
                    usage_count: 0,
                    example_image: None,
                    notes: seg.notes.clone(),
                    dimension_key: Some(key.clone()),
                };

                let hit = find_module_hit(conn, &fmod, &dim_id)?;
                match hit {
                    Some(hit_id) => {
                        if is_overwrite {
                            conn.execute(
                                "UPDATE modules SET content_en=?1, display_name=?2, weight=?3, is_nsfw=?4, notes=?5, updated_at=?6 WHERE id=?7",
                                params![content_en, display_name, weight, if is_nsfw { 1 } else { 0 }, seg.notes, now_ts(), hit_id],
                            )
                            .map_err(|e| e.to_string())?;
                            report.modules_updated += 1;
                            report.segments_imported += 1;
                        } else {
                            report.modules_skipped += 1;
                            report.segments_skipped += 1;
                        }
                    }
                    None => {
                        let new_id = new_id();
                        let ts = now_ts();
                        conn.execute(
                            "INSERT INTO modules (id, dimension_id, content_en, display_name, weight, is_enabled, is_nsfw, usage_count, created_at, updated_at, is_deleted) VALUES (?1,?2,?3,?4,?5,1,?6,0,?7,?8,0)",
                            params![new_id, dim_id, content_en, display_name, weight, if is_nsfw { 1 } else { 0 }, ts, ts],
                        )
                        .map_err(|e| e.to_string())?;
                        // Update notes if provided
                        if let Some(n) = seg.notes.as_deref().filter(|s| !s.is_empty()) {
                            conn.execute("UPDATE modules SET notes=?1 WHERE id=?2", params![n, new_id])
                                .map_err(|e| e.to_string())?;
                        }
                        report.modules_created += 1;
                        report.segments_imported += 1;
                    }
                }
            }
        }
        Ok(())
    })();

    match tx_result {
        Ok(()) => {
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            Ok(report)
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

// ------------------------------------------------------------------
// Tauri commands
// ------------------------------------------------------------------
#[tauri::command]
pub fn db_import_segments(
    app: AppHandle,
    payload: SegmentImportPayload,
) -> Result<SegmentImportReport, String> {
    let conn = open_conn(&app)?;
    import_segments_into(&conn, &payload)
}

#[tauri::command]
pub fn db_import_segments_text(
    app: AppHandle,
    text: String,
    unassigned_strategy: String,
    mode: String,
) -> Result<SegmentImportReport, String> {
    let mut payload = parse_segments_text_payload(&text)?;
    payload.unassigned_strategy = if unassigned_strategy.trim().is_empty() {
        "ignore".to_string()
    } else {
        unassigned_strategy.trim().to_lowercase()
    };
    payload.mode = if mode.trim().is_empty() {
        "skip".to_string()
    } else {
        mode.trim().to_lowercase()
    };
    let conn = open_conn(&app)?;
    import_segments_into(&conn, &payload)
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn temp_conn(tag: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!(
            "pmf_segment_test_{}_{}",
            tag,
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open(dir.join("pmf.db")).unwrap();
        conn.execute_batch(include_str!("../../resources/schema.sql"))
            .unwrap();
        conn
    }

    fn seed_dims(conn: &Connection) {
        let ts = chrono::Utc::now().timestamp();
        conn.execute_batch(&format!(
            "INSERT INTO dimensions (id,key,name_cn,name_en,sort_order,is_multi_select,is_enabled,created_at,updated_at,is_deleted) VALUES
             ('dim_body','body','身材','Body',3,0,1,{ts},{ts},0),
             ('dim_face','face','面部','Face',4,0,1,{ts},{ts},0),
             ('dim_top','top','上装','Top',5,0,1,{ts},{ts},0),
             ('dim_shoes','shoes','鞋袜','Shoes',8,0,1,{ts},{ts},0),
             ('dim_camera','camera','相机','Camera',13,0,1,{ts},{ts},0)"
        ))
        .unwrap();
    }

    fn payload_single(body_text: &str) -> SegmentImportPayload {
        SegmentImportPayload {
            format: "pmf-segments".to_string(),
            format_version: 1,
            prompts: vec![SegmentPromptPayload {
                id: "p01".to_string(),
                raw: "slim waist".to_string(),
                segments: vec![SegmentImportItem {
                    dimension_key: "body".to_string(),
                    dimension_id: None,
                    content_en: body_text.to_string(),
                    display_name: None,
                    weight: Some(1.0),
                    is_nsfw: Some(false),
                    notes: None,
                }],
            }],
            unassigned_strategy: "ignore".to_string(),
            mode: "skip".to_string(),
        }
    }

    #[test]
    fn import_single_segment_creates_module() {
        let conn = temp_conn("single");
        seed_dims(&conn);
        let p = payload_single("slim waist");
        let r = import_segments_into(&conn, &p).unwrap();
        assert_eq!(r.modules_created, 1);
        assert_eq!(r.segments_imported, 1);
    }

    #[test]
    fn import_dedup_skip() {
        let conn = temp_conn("dedup_skip");
        seed_dims(&conn);
        let p = payload_single("slim waist");
        import_segments_into(&conn, &p).unwrap();
        let r2 = import_segments_into(&conn, &p).unwrap();
        assert_eq!(r2.modules_skipped, 1);
        assert_eq!(r2.modules_created, 0);
    }

    #[test]
    fn import_dedup_overwrite() {
        let conn = temp_conn("dedup_overwrite");
        seed_dims(&conn);
        let mut p = payload_single("slim waist");
        import_segments_into(&conn, &p).unwrap();
        p.mode = "overwrite".to_string();
        p.prompts[0].segments[0].weight = Some(1.5);
        let r2 = import_segments_into(&conn, &p).unwrap();
        assert_eq!(r2.modules_updated, 1);
    }

    #[test]
    fn import_unassigned_ignore() {
        let conn = temp_conn("unassigned_ignore");
        seed_dims(&conn);
        let mut p = payload_single("slim waist");
        p.prompts[0].segments.push(SegmentImportItem {
            dimension_key: "unassigned".to_string(),
            dimension_id: None,
            content_en: "ultra detailed".to_string(),
            display_name: None,
            weight: None,
            is_nsfw: None,
            notes: None,
        });
        let r = import_segments_into(&conn, &p).unwrap();
        assert_eq!(r.segments_ignored_unassigned, 1);
        assert_eq!(r.modules_created, 1);
    }

    #[test]
    fn import_unassigned_to_camera() {
        let conn = temp_conn("unassigned_camera");
        seed_dims(&conn);
        let mut p = payload_single("slim waist");
        p.unassigned_strategy = "to_camera".to_string();
        p.prompts[0].segments.push(SegmentImportItem {
            dimension_key: "unassigned".to_string(),
            dimension_id: None,
            content_en: "8k ultra detailed".to_string(),
            display_name: None,
            weight: None,
            is_nsfw: None,
            notes: None,
        });
        let r = import_segments_into(&conn, &p).unwrap();
        assert_eq!(r.modules_created, 2);
        assert_eq!(r.segments_ignored_unassigned, 0);
    }

    #[test]
    fn import_unknown_dimension_error() {
        let conn = temp_conn("unknown_dim");
        seed_dims(&conn);
        let mut p = payload_single("slim waist");
        p.prompts[0].segments.push(SegmentImportItem {
            dimension_key: "unknown_dim_xyz".to_string(),
            dimension_id: None,
            content_en: "something".to_string(),
            display_name: None,
            weight: None,
            is_nsfw: None,
            notes: None,
        });
        let r = import_segments_into(&conn, &p).unwrap();
        assert_eq!(r.errors.len(), 1);
        assert_eq!(r.modules_created, 1);
    }

    #[test]
    fn import_invalid_format_rejected() {
        let conn = temp_conn("invalid_fmt");
        seed_dims(&conn);
        let mut p = payload_single("slim waist");
        p.format = "bad-format".to_string();
        let r = import_segments_into(&conn, &p);
        assert!(r.is_err());
    }

    #[test]
    fn parse_text_payload_ok() {
        let json = r#"{"format":"pmf-segments","formatVersion":1,"prompts":[{"id":"p01","raw":"a, b","segments":[{"dimensionKey":"body","contentEn":"a"}]}]}"#;
        let p = parse_segments_text_payload(json).unwrap();
        assert_eq!(p.prompts.len(), 1);
    }
}
