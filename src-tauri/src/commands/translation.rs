use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::meta::open_active_conn as open_conn;

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationUpdateItem {
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationUpdatePayload {
    pub dimension_id: String,
    pub items: Vec<TranslationUpdateItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationUpdateReport {
    pub total_requested: i64,
    pub updated: i64,
    pub skipped: i64,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

const MAX_ITEMS: usize = 1000;
const MAX_ZH_LEN: usize = 500;

#[tauri::command]
pub fn db_batch_update_display_names(
    app: AppHandle,
    payload: TranslationUpdatePayload,
) -> Result<TranslationUpdateReport, String> {
    let dim_id = payload.dimension_id.trim().to_string();
    if dim_id.is_empty() {
        return Err("维度 id 不能为空".to_string());
    }
    if payload.items.is_empty() {
        return Err("无有效更新".to_string());
    }
    if payload.items.len() > MAX_ITEMS {
        return Err("单次更新不超过 1000 条，请分批".to_string());
    }

    let conn = open_conn(&app)?;

    let dim_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM dimensions WHERE id=?1 AND is_deleted=0",
            params![dim_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if dim_exists == 0 {
        return Err("维度不存在或已删除".to_string());
    }

    let ts = now_ts();
    let total = payload.items.len() as i64;
    let mut updated: i64 = 0;
    let mut skipped: i64 = 0;
    let mut warnings: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| e.to_string())?;

    let mut failed: Option<String> = None;

    for item in &payload.items {
        let id = item.id.trim().to_string();
        if id.is_empty() {
            skipped += 1;
            errors.push("id 为空，已跳过".to_string());
            continue;
        }
        let mut zh = item.display_name.trim().to_string();
        if zh.is_empty() {
            skipped += 1;
            errors.push(format!("id {} 的 displayName 为空，已跳过", id));
            continue;
        }
        if zh.chars().count() > MAX_ZH_LEN {
            zh = truncate_chars(&zh, MAX_ZH_LEN);
            warnings.push(format!("id {} 的 displayName 超长，已截断至 {}", id, MAX_ZH_LEN));
        }

        // Check module exists and belongs to dimension
        let row: Option<(String, i64)> = conn
            .query_row(
                "SELECT dimension_id, is_deleted FROM modules WHERE id=?1",
                params![id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
            )
            .ok();

        match row {
            None => {
                skipped += 1;
                errors.push(format!("id {} 不存在，已跳过", id));
                continue;
            }
            Some((mod_dim_id, is_deleted)) => {
                if is_deleted != 0 {
                    skipped += 1;
                    errors.push(format!("id {} 已删除，已跳过", id));
                    continue;
                }
                if mod_dim_id != dim_id {
                    skipped += 1;
                    // Try to get key for better message
                    let key: Option<String> = conn
                        .query_row("SELECT key FROM dimensions WHERE id=?1", params![dim_id], |r| r.get(0))
                        .ok();
                    let k = key.unwrap_or_else(|| dim_id.clone());
                    errors.push(format!("id {} 不属于维度 {}，已跳过", id, k));
                    continue;
                }
            }
        }

        let res = conn.execute(
            "UPDATE modules SET display_name=?1, updated_at=?2 WHERE id=?3",
            params![zh, ts, id],
        );

        match res {
            Ok(n) => {
                if n == 0 {
                    skipped += 1;
                    errors.push(format!("id {} 更新失败，已跳过", id));
                } else {
                    updated += 1;
                }
            }
            Err(e) => {
                failed = Some(e.to_string());
                break;
            }
        }
    }

    if let Some(e) = failed {
        let _ = conn.execute("ROLLBACK", []);
        return Err(e);
    }

    conn.execute("COMMIT", []).map_err(|e| e.to_string())?;

    Ok(TranslationUpdateReport {
        total_requested: total,
        updated,
        skipped,
        warnings,
        errors,
    })
}

#[tauri::command]
pub fn db_batch_update_display_names_text(
    app: AppHandle,
    text: String,
    dimension_id: String,
) -> Result<TranslationUpdateReport, String> {
    let dim_id = dimension_id.trim().to_string();
    if dim_id.is_empty() {
        return Err("维度 id 不能为空".to_string());
    }
    if text.trim().is_empty() {
        return Err("输入为空".to_string());
    }
    // Parse text as JSON translation payload(s). Support pmf-translation items array or flat map.
    let payload = parse_translation_text_to_payload(&text, &dim_id)?;
    db_batch_update_display_names(app, payload)
}

fn parse_translation_text_to_payload(text: &str, dimension_id: &str) -> Result<TranslationUpdatePayload, String> {
    // Extract JSON blocks (similar to frontend but minimal)
    let blocks = extract_json_blocks(text);
    if blocks.is_empty() {
        return Err("无法识别的 pmf-translation 格式".to_string());
    }
    let mut map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut warnings: Vec<String> = Vec::new();
    for block in blocks {
        let v: serde_json::Value = serde_json::from_str(&block).map_err(|e| format!("JSON 解析失败: {}", e))?;
        let obj = v.as_object().ok_or_else(|| "顶层不是对象".to_string())?;
        let items_val = obj.get("items").or_else(|| obj.get("mappings"));
        if let Some(items_val) = items_val {
            if let Some(arr) = items_val.as_array() {
                for row in arr {
                    let id = row.get("id").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
                    let zh = row.get("zh").or_else(|| row.get("displayName")).or_else(|| row.get("nameCn")).or_else(|| row.get("value"));
                    let zh_str = match zh {
                        Some(serde_json::Value::String(s)) => s.trim().to_string(),
                        Some(v) if v.is_string() => v.as_str().unwrap_or("").trim().to_string(),
                        Some(v) => v.to_string().trim().trim_matches('"').to_string(),
                        None => String::new(),
                    };
                    if id.is_empty() { continue; }
                    if zh_str.is_empty() { continue; }
                    let mut zh_final = zh_str;
                    if zh_final.chars().count() > MAX_ZH_LEN {
                        zh_final = truncate_chars(&zh_final, MAX_ZH_LEN);
                        warnings.push(format!("id {} 超长截断", id));
                    }
                    map.insert(id, zh_final);
                }
            } else if let Some(map_obj) = items_val.as_object() {
                for (k, v) in map_obj {
                    let id = k.trim().to_string();
                    let zh_str = match v {
                        serde_json::Value::String(s) => s.trim().to_string(),
                        _ => v.to_string().trim().trim_matches('"').to_string(),
                    };
                    if id.is_empty() || zh_str.is_empty() { continue; }
                    let mut zh_final = zh_str;
                    if zh_final.chars().count() > MAX_ZH_LEN {
                        zh_final = truncate_chars(&zh_final, MAX_ZH_LEN);
                    }
                    map.insert(id, zh_final);
                }
            }
        } else {
            // Maybe flat map directly?
            let all_str = obj.values().all(|v| v.is_string());
            if all_str && !obj.is_empty() {
                for (k, v) in obj {
                    if k == "format" || k == "formatVersion" || k == "dimensionKey" || k == "chunkId" || k == "totalChunks" { continue; }
                    if let Some(s) = v.as_str() {
                        let zh = s.trim();
                        if !zh.is_empty() { map.insert(k.clone(), zh.to_string()); }
                    }
                }
            }
        }
    }
    if map.is_empty() {
        return Err("无法识别的 pmf-translation 格式".to_string());
    }
    let items = map.into_iter().map(|(id, zh)| TranslationUpdateItem { id, display_name: zh }).collect();
    let _ = warnings;
    Ok(TranslationUpdatePayload { dimension_id: dimension_id.to_string(), items })
}

fn extract_json_blocks(text: &str) -> Vec<String> {
    // Remove fences
    let mut normalized = text.to_string();
    // Simple global fence replace
    while let Some(start) = normalized.find("```") {
        if let Some(end_rel) = normalized[start + 3..].find("```") {
            let end = start + 3 + end_rel + 3;
            let inner_start = normalized[start..].find('\n').map(|p| start + p + 1).unwrap_or(start + 3);
            let inner = normalized[inner_start..end - 3].to_string();
            normalized.replace_range(start..end, &inner);
        } else { break; }
    }
    let chars: Vec<char> = normalized.chars().collect();
    let n = chars.len();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < n {
        // find '{'
        let mut start: Option<usize> = None;
        for j in i..n { if chars[j] == '{' { start = Some(j); break; } }
        let Some(s) = start else { break; };
        let mut depth: i32 = 0;
        let mut in_str = false;
        let mut esc = false;
        let mut end: Option<usize> = None;
        for j in s..n {
            let ch = chars[j];
            if in_str {
                if esc { esc = false; }
                else if ch == '\\' { esc = true; }
                else if ch == '"' { in_str = false; }
            } else {
                if ch == '"' { in_str = true; }
                else if ch == '{' { depth += 1; }
                else if ch == '}' {
                    depth -= 1;
                    if depth == 0 { end = Some(j); break; }
                }
            }
        }
        if let Some(e) = end {
            let candidate: String = chars[s..=e].iter().collect();
            if serde_json::from_str::<serde_json::Value>(&candidate).is_ok() {
                out.push(candidate);
                i = e + 1;
            } else {
                i = s + 1;
            }
        } else { break; }
    }
    if out.is_empty() {
        let t = normalized.trim().to_string();
        if t.starts_with('{') && t.ends_with('}') {
            if serde_json::from_str::<serde_json::Value>(&t).is_ok() { out.push(t); }
        }
    }
    out
}
