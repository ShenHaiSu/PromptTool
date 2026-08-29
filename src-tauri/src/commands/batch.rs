use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::db::{find_module_hit, ModuleDto};
use super::meta::open_active_conn as open_conn;

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}
fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn safe_truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

fn clamp_weight(v: f64) -> f64 {
    let c = v.clamp(0.5, 2.0);
    (c * 10.0).round() / 10.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchCreateItem {
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
pub struct BatchCreatePayload {
    pub dim_id: String,
    pub items: Vec<BatchCreateItem>,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub weight: Option<f64>,
    #[serde(default)]
    pub is_nsfw: Option<bool>,
}
fn default_mode() -> String {
    "skip".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchCreateReport {
    pub total_requested: i64,
    pub valid: i64,
    pub modules_created: i64,
    pub modules_updated: i64,
    pub modules_skipped: i64,
    pub empty_ignored: i64,
    pub duplicate_in_batch: i64,
    pub truncated: i64,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

fn batch_create_modules_into(
    conn: &rusqlite::Connection,
    payload: &BatchCreatePayload,
) -> Result<BatchCreateReport, String> {
    let dim_id_raw = payload.dim_id.trim().to_string();
    if dim_id_raw.is_empty() {
        return Err("维度 id 不能为空".to_string());
    }
    let mode = payload.mode.trim().to_lowercase();
    if mode != "skip" && mode != "overwrite" {
        return Err(format!("未知导入模式 '{}'（可选：skip / overwrite）", payload.mode));
    }
    let is_overwrite = mode == "overwrite";

    // Validate dimension exists
    let exists: Option<String> = conn
        .query_row(
            "SELECT id FROM dimensions WHERE id=?1 AND is_deleted=0",
            params![dim_id_raw],
            |r| r.get(0),
        )
        .ok();
    if exists.is_none() {
        return Err("维度不存在或已删除".to_string());
    }
    let dim_id = dim_id_raw;

    // Normalize payload weight
    let mut payload_weight = payload.weight.unwrap_or(1.0);
    let mut early_warnings: Vec<String> = Vec::new();
    if !payload_weight.is_finite() {
        early_warnings.push("权重非数值，已重置为 1.0".to_string());
        payload_weight = 1.0;
    }
    if payload_weight < 0.5 || payload_weight > 2.0 {
        let clamped = clamp_weight(payload_weight);
        early_warnings.push(format!("权重 {} 超范围，已 clamp 至 {}", payload_weight, clamped));
        payload_weight = clamped;
    } else {
        payload_weight = (payload_weight * 10.0).round() / 10.0;
    }
    let payload_is_nsfw = payload.is_nsfw.unwrap_or(false);

    let mut items = payload.items.clone();
    let total_requested = items.len() as i64;

    // Backend limit 500
    let mut truncated_limit = 0i64;
    let mut warnings: Vec<String> = early_warnings;
    if items.len() > 500 {
        truncated_limit = (items.len() - 500) as i64;
        warnings.push("已截断至 500 行，剩余请分批".to_string());
        items.truncate(500);
    }

    if items.is_empty() {
        return Err("无有效内容".to_string());
    }

    let mut report = BatchCreateReport {
        total_requested,
        valid: 0,
        modules_created: 0,
        modules_updated: 0,
        modules_skipped: 0,
        empty_ignored: 0,
        duplicate_in_batch: 0,
        truncated: 0,
        errors: Vec::new(),
        warnings,
    };

    // dedup within batch (exact contentEn after trim+trunc)
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| format!("开始事务失败: {}", e))?;

    let tx_result: Result<(), String> = (|| {
        for (idx, item) in items.iter().enumerate() {
            let mut content_en = item.content_en.trim().to_string();
            if content_en.is_empty() {
                report.empty_ignored += 1;
                continue;
            }
            if content_en.chars().count() > 500 {
                report.warnings.push(format!("第 {} 行超长已截断至 500", idx + 1));
                report.truncated += 1;
                content_en = safe_truncate_chars(&content_en, 500);
            }

            // batch dedup: if seen, count and treat as existing (skip or overwrite same row)
            if seen.contains(&content_en) {
                report.duplicate_in_batch += 1;
                // Let it fall through to hit handling — find_module_hit will hit the first insert
                // For counting we keep duplicate_in_batch separate; decide action below.
            } else {
                seen.insert(content_en.clone());
            }

            let display_name = item
                .display_name
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| safe_truncate_chars(&content_en, 20));

            let mut w = item.weight.or(Some(payload_weight)).unwrap_or(payload_weight);
            if !w.is_finite() {
                report.warnings.push(format!("第 {} 行权重非数值，已重置为 1.0", idx + 1));
                w = 1.0;
            }
            if w < 0.5 || w > 2.0 {
                let clamped = clamp_weight(w);
                report.warnings.push(format!("第 {} 行权重 {} 超范围，已 clamp 至 {}", idx + 1, w, clamped));
                w = clamped;
            } else {
                w = (w * 10.0).round() / 10.0;
            }
            let is_nsfw = item.is_nsfw.unwrap_or(payload_is_nsfw);

            // Use find_module_hit Semantics: dimension_id + content_en
            let probe = ModuleDto {
                id: String::new(),
                dimension_id: dim_id.clone(),
                content_en: content_en.clone(),
                display_name: display_name.clone(),
                weight: w,
                is_enabled: true,
                is_nsfw,
                usage_count: 0,
                example_image: None,
                notes: item.notes.clone(),
                dimension_key: None,
            };
            let hit = find_module_hit(conn, &probe, &dim_id)?;
            match hit {
                Some(hit_id) => {
                    if is_overwrite {
                        let ts = now_ts();
                        let r = conn.execute(
                            "UPDATE modules SET content_en=?1, display_name=?2, weight=?3, is_nsfw=?4, notes=?5, updated_at=?6 WHERE id=?7",
                            params![content_en, display_name, w, if is_nsfw { 1 } else { 0 }, item.notes, ts, hit_id],
                        );
                        if let Err(e) = r {
                            report.errors.push(format!("第 {} 行更新失败: {}", idx + 1, e));
                            continue;
                        }
                        report.modules_updated += 1;
                        report.valid += 1;
                    } else {
                        report.modules_skipped += 1;
                        // still count as valid request but skipped — don't increment valid (mirrors segment semantics skipped)
                    }
                }
                None => {
                    let nid = new_id();
                    let ts = now_ts();
                    let r = conn.execute(
                        "INSERT INTO modules (id, dimension_id, content_en, display_name, weight, is_enabled, is_nsfw, usage_count, created_at, updated_at, is_deleted) VALUES (?1,?2,?3,?4,?5,1,?6,0,?7,?8,0)",
                        params![nid, dim_id, content_en, display_name, w, if is_nsfw { 1 } else { 0 }, ts, ts],
                    );
                    if let Err(e) = r {
                        report.errors.push(format!("第 {} 行写入失败: {}", idx + 1, e));
                        continue;
                    }
                    if let Some(n) = item.notes.as_deref().filter(|s| !s.is_empty()) {
                        let _ = conn.execute("UPDATE modules SET notes=?1 WHERE id=?2", params![n, nid]);
                    }
                    report.modules_created += 1;
                    report.valid += 1;
                }
            }
        }
        // adjust truncated to include limit truncation
        if truncated_limit > 0 {
            report.truncated += truncated_limit;
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

#[tauri::command]
pub fn db_batch_create_modules(
    app: AppHandle,
    dim_id: String,
    items: Vec<BatchCreateItem>,
    mode: String,
    weight: Option<f64>,
    is_nsfw: Option<bool>,
) -> Result<BatchCreateReport, String> {
    let conn = open_conn(&app)?;
    let payload = BatchCreatePayload { dim_id, items, mode, weight, is_nsfw };
    batch_create_modules_into(&conn, &payload)
}

#[tauri::command]
pub fn db_batch_create_modules_text(
    app: AppHandle,
    dim_id: String,
    text: String,
    mode: String,
    weight: Option<f64>,
    is_nsfw: Option<bool>,
) -> Result<BatchCreateReport, String> {
    let items: Vec<BatchCreateItem> = text
        .split('\n')
        .map(|s| s.trim_end_matches('\r').to_string())
        .map(|l| BatchCreateItem { content_en: l, display_name: None, weight: None, is_nsfw: None, notes: None })
        .collect();
    let payload = BatchCreatePayload { dim_id, items, mode, weight, is_nsfw };
    let conn = open_conn(&app)?;
    batch_create_modules_into(&conn, &payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn temp_conn(tag: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("pmf_batch_test_{}_{}", tag, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open(dir.join("pmf.db")).unwrap();
        conn.execute_batch(include_str!("../../resources/schema.sql")).unwrap();
        conn
    }
    fn seed_dims(conn: &Connection) {
        let ts = chrono::Utc::now().timestamp();
        conn.execute_batch(&format!(
            "INSERT INTO dimensions (id,key,name_cn,name_en,sort_order,is_multi_select,is_enabled,created_at,updated_at,is_deleted) VALUES
             ('dim_top','top','上装','Top',5,0,1,{ts},{ts},0),
             ('dim_body','body','身材','Body',3,0,1,{ts},{ts},0)"
        ))
        .unwrap();
    }
    fn payload(dim_id: &str, texts: &[&str], mode: &str) -> BatchCreatePayload {
        BatchCreatePayload {
            dim_id: dim_id.to_string(),
            items: texts.iter().map(|t| BatchCreateItem { content_en: t.to_string(), display_name: None, weight: None, is_nsfw: None, notes: None }).collect(),
            mode: mode.to_string(),
            weight: Some(1.0),
            is_nsfw: Some(false),
        }
    }

    #[test]
    fn batch_single_creates() {
        let conn = temp_conn("single");
        seed_dims(&conn);
        let p = payload("dim_top", &["oversized white shirt"], "skip");
        let r = batch_create_modules_into(&conn, &p).unwrap();
        assert_eq!(r.modules_created, 1);
        assert_eq!(r.valid, 1);
    }

    #[test]
    fn batch_dedup_skip() {
        let conn = temp_conn("dedup_skip");
        seed_dims(&conn);
        let p = payload("dim_top", &["slim waist"], "skip");
        batch_create_modules_into(&conn, &p).unwrap();
        let r2 = batch_create_modules_into(&conn, &payload("dim_top", &["slim waist"], "skip")).unwrap();
        assert_eq!(r2.modules_skipped, 1);
        assert_eq!(r2.modules_created, 0);
    }

    #[test]
    fn batch_dedup_overwrite() {
        let conn = temp_conn("dedup_over");
        seed_dims(&conn);
        let p = payload("dim_top", &["slim waist"], "skip");
        batch_create_modules_into(&conn, &p).unwrap();
        let mut p2 = payload("dim_top", &["slim waist"], "overwrite");
        p2.weight = Some(1.5);
        let r2 = batch_create_modules_into(&conn, &p2).unwrap();
        assert_eq!(r2.modules_updated, 1);
        let w: f64 = conn.query_row("SELECT weight FROM modules WHERE content_en='slim waist' AND dimension_id='dim_top' AND is_deleted=0", [], |r| r.get(0)).unwrap();
        assert!((w - 1.5).abs() < 1e-9);
    }

    #[test]
    fn batch_empty_and_truncate() {
        let conn = temp_conn("empty_trunc");
        seed_dims(&conn);
        let long = "x".repeat(600);
        let p = BatchCreatePayload {
            dim_id: "dim_top".to_string(),
            items: vec![
                BatchCreateItem { content_en: "  ".to_string(), display_name: None, weight: None, is_nsfw: None, notes: None },
                BatchCreateItem { content_en: long.clone(), display_name: None, weight: None, is_nsfw: None, notes: None },
                BatchCreateItem { content_en: "ok".to_string(), display_name: None, weight: None, is_nsfw: None, notes: None },
            ],
            mode: "skip".to_string(),
            weight: Some(1.0),
            is_nsfw: Some(false),
        };
        let r = batch_create_modules_into(&conn, &p).unwrap();
        assert_eq!(r.empty_ignored, 1);
        assert_eq!(r.truncated, 1);
        assert_eq!(r.modules_created, 2);
        let ce: String = conn.query_row("SELECT content_en FROM modules WHERE display_name=?1", params![safe_truncate_chars(&long, 20)], |r| r.get(0)).unwrap();
        assert_eq!(ce.chars().count(), 500);
    }

    #[test]
    fn batch_duplicate_in_batch() {
        let conn = temp_conn("dup_in_batch");
        seed_dims(&conn);
        let p = payload("dim_top", &["hello", "hello", "hello"], "skip");
        let r = batch_create_modules_into(&conn, &p).unwrap();
        assert_eq!(r.modules_created, 1);
        // second and third are dup in batch -> treated as skip
        assert_eq!(r.modules_skipped, 2);
        assert_eq!(r.duplicate_in_batch, 2);
    }

    #[test]
    fn batch_limit_500() {
        let conn = temp_conn("limit500");
        seed_dims(&conn);
        let texts: Vec<String> = (0..600).map(|i| format!("line {}", i)).collect();
        let refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
        let p = payload("dim_top", &refs, "skip");
        let r = batch_create_modules_into(&conn, &p).unwrap();
        assert_eq!(r.modules_created, 500);
        assert!(r.warnings.iter().any(|w| w.contains("500")));
        assert!(r.truncated >= 100);
    }

    #[test]
    fn batch_invalid_dim() {
        let conn = temp_conn("invalid_dim");
        seed_dims(&conn);
        let p = payload("not_exist", &["hello"], "skip");
        let r = batch_create_modules_into(&conn, &p);
        assert!(r.is_err());
    }
}
