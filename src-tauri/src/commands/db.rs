use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::migration::db_path_for;

// ------------------------------------------------------------------
// Local helpers — open connection per command (serialized, WAL-safe)
// ------------------------------------------------------------------
fn open_conn(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let path = db_path_for(app)?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ------------------------------------------------------------------
// DTOs
// ------------------------------------------------------------------
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DimensionDto {
    pub id: String,
    pub key: String,
    pub name_cn: String,
    pub name_en: Option<String>,
    pub sort_order: i64,
    pub is_multi_select: bool,
    pub is_enabled: bool,
    pub icon: Option<String>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModuleDto {
    pub id: String,
    pub dimension_id: String,
    pub content_en: String,
    pub display_name: String,
    pub weight: f64,
    pub is_enabled: bool,
    pub is_nsfw: bool,
    pub usage_count: i64,
    pub example_image: Option<String>,
    pub notes: Option<String>,
    pub dimension_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssemblyDto {
    pub id: String,
    pub title: Option<String>,
    pub prompt_ir_json: String,
    pub final_prompt: String,
    pub model_profile: String,
    pub created_at: i64,
    pub is_favorite: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssemblyItemDto {
    pub id: String,
    pub assembly_id: String,
    pub module_id: String,
    pub sort_order: i64,
    pub weight_override: Option<f64>,
    pub is_locked: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDto {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub config_json: Option<String>,
    pub cover_prompt: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssemblyConfigDto {
    pub separator: String,
    pub use_weight_brackets: bool,
    pub model_profile: String,
    pub sort_by: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SelectedItemDto {
    pub module: ModuleDto,
    pub weight_override: Option<f64>,
    pub locked: bool,
}

// ------------------------------------------------------------------
// Dimensions / Modules
// ------------------------------------------------------------------
#[tauri::command]
pub fn db_get_dimensions(app: AppHandle) -> Result<Vec<DimensionDto>, String> {
    let conn = open_conn(&app)?;
    let mut stmt = conn
        .prepare("SELECT id, key, name_cn, name_en, sort_order, is_multi_select, is_enabled, icon, created_at, updated_at FROM dimensions WHERE is_deleted=0 ORDER BY sort_order")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(DimensionDto {
                id: r.get(0)?,
                key: r.get(1)?,
                name_cn: r.get(2)?,
                name_en: r.get(3)?,
                sort_order: r.get(4)?,
                is_multi_select: r.get::<_, i64>(5)? != 0,
                is_enabled: r.get::<_, i64>(6)? != 0,
                icon: r.get(7)?,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_get_modules_by_dimension(
    app: AppHandle,
    dim_id: String,
) -> Result<Vec<ModuleDto>, String> {
    let conn = open_conn(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT m.id, m.dimension_id, m.content_en, m.display_name, m.weight, m.is_enabled, m.is_nsfw, m.usage_count, m.example_image, m.notes, d.key as dim_key FROM modules m JOIN dimensions d ON m.dimension_id=d.id WHERE m.dimension_id=?1 AND m.is_deleted=0 ORDER BY m.created_at",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![dim_id], |r| {
            Ok(ModuleDto {
                id: r.get(0)?,
                dimension_id: r.get(1)?,
                content_en: r.get(2)?,
                display_name: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                weight: r.get(4)?,
                is_enabled: r.get::<_, i64>(5)? != 0,
                is_nsfw: r.get::<_, i64>(6)? != 0,
                usage_count: r.get(7)?,
                example_image: r.get(8)?,
                notes: r.get(9)?,
                dimension_key: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_get_all_modules_grouped(
    app: AppHandle,
) -> Result<std::collections::HashMap<String, Vec<ModuleDto>>, String> {
    let conn = open_conn(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT m.id, m.dimension_id, m.content_en, m.display_name, m.weight, m.is_enabled, m.is_nsfw, m.usage_count, m.example_image, m.notes, d.key as dim_key FROM modules m JOIN dimensions d ON m.dimension_id=d.id WHERE m.is_deleted=0 ORDER BY d.sort_order, m.created_at",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ModuleDto {
                id: r.get(0)?,
                dimension_id: r.get(1)?,
                content_en: r.get(2)?,
                display_name: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                weight: r.get(4)?,
                is_enabled: r.get::<_, i64>(5)? != 0,
                is_nsfw: r.get::<_, i64>(6)? != 0,
                usage_count: r.get(7)?,
                example_image: r.get(8)?,
                notes: r.get(9)?,
                dimension_key: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut map: std::collections::HashMap<String, Vec<ModuleDto>> = std::collections::HashMap::new();
    for r in rows {
        let m = r.map_err(|e| e.to_string())?;
        let key = m.dimension_key.clone().unwrap_or_default();
        map.entry(key).or_default().push(m);
    }
    Ok(map)
}

#[tauri::command]
pub fn db_search_modules(app: AppHandle, keyword: String) -> Result<Vec<ModuleDto>, String> {
    let conn = open_conn(&app)?;
    let pat = format!("%{}%", keyword);
    let mut stmt = conn
        .prepare(
            "SELECT m.id, m.dimension_id, m.content_en, m.display_name, m.weight, m.is_enabled, m.is_nsfw, m.usage_count, m.example_image, m.notes, d.key as dim_key FROM modules m JOIN dimensions d ON m.dimension_id=d.id WHERE m.is_deleted=0 AND (m.content_en LIKE ?1 OR m.display_name LIKE ?1 OR m.notes LIKE ?1) ORDER BY m.created_at",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![pat], |r| {
            Ok(ModuleDto {
                id: r.get(0)?,
                dimension_id: r.get(1)?,
                content_en: r.get(2)?,
                display_name: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                weight: r.get(4)?,
                is_enabled: r.get::<_, i64>(5)? != 0,
                is_nsfw: r.get::<_, i64>(6)? != 0,
                usage_count: r.get(7)?,
                example_image: r.get(8)?,
                notes: r.get(9)?,
                dimension_key: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_create_module(
    app: AppHandle,
    dim_id: String,
    content_en: String,
    display_name: String,
    weight: f64,
) -> Result<ModuleDto, String> {
    let conn = open_conn(&app)?;
    let id = new_id();
    let ts = now_ts();
    conn.execute(
        "INSERT INTO modules (id, dimension_id, content_en, display_name, weight, is_enabled, is_nsfw, usage_count, created_at, updated_at, is_deleted) VALUES (?1, ?2, ?3, ?4, ?5, 1, 0, 0, ?6, ?7, 0)",
        params![id, dim_id, content_en, display_name, weight, ts, ts],
    )
    .map_err(|e| e.to_string())?;
    let dim_key: Option<String> = conn
        .query_row("SELECT key FROM dimensions WHERE id=?1", params![dim_id], |r| r.get(0))
        .ok();
    Ok(ModuleDto {
        id,
        dimension_id: dim_id,
        content_en,
        display_name,
        weight,
        is_enabled: true,
        is_nsfw: false,
        usage_count: 0,
        example_image: None,
        notes: None,
        dimension_key: dim_key,
    })
}

#[tauri::command]
pub fn db_update_module(app: AppHandle, m: ModuleDto) -> Result<(), String> {
    let conn = open_conn(&app)?;
    let ts = now_ts();
    conn.execute(
        "UPDATE modules SET content_en=?1, display_name=?2, weight=?3, is_enabled=?4, is_nsfw=?5, notes=?6, updated_at=?7 WHERE id=?8",
        params![
            m.content_en,
            m.display_name,
            m.weight,
            if m.is_enabled { 1 } else { 0 },
            if m.is_nsfw { 1 } else { 0 },
            m.notes,
            ts,
            m.id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_soft_delete_module(app: AppHandle, id: String) -> Result<(), String> {
    let conn = open_conn(&app)?;
    let ts = now_ts();
    conn.execute(
        "UPDATE modules SET is_deleted=1, updated_at=?1 WHERE id=?2",
        params![ts, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ------------------------------------------------------------------
// Assemblies
// ------------------------------------------------------------------
#[tauri::command]
pub fn db_save_assembly(
    app: AppHandle,
    title: Option<String>,
    ir_json: String,
    final_prompt: String,
    config: AssemblyConfigDto,
    items: Vec<SelectedItemDto>,
    is_favorite: bool,
) -> Result<String, String> {
    let conn = open_conn(&app)?;
    let aid = new_id();
    let ts = now_ts();
    let ttl = if title.as_deref().map(|s| s.trim().is_empty()).unwrap_or(true) {
        let short = if final_prompt.len() > 30 {
            format!("{}...", &final_prompt[..30])
        } else {
            final_prompt.clone()
        };
        let ymd = chrono::DateTime::<chrono::Utc>::from_timestamp(ts, 0)
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_default();
        if short.is_empty() {
            format!("{} · (空方案)", ymd)
        } else {
            format!("{} · {}", ymd, short)
        }
    } else {
        title.unwrap()
    };
    // Use transaction via batch
    conn.execute("BEGIN IMMEDIATE", []).map_err(|e| e.to_string())?;
    let res: Result<(), String> = (|| {
        conn.execute(
            "INSERT INTO assemblies (id, title, prompt_ir, final_prompt, model_profile, created_at, is_favorite, is_deleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
            params![aid, ttl, ir_json, final_prompt, config.model_profile, ts, if is_favorite { 1 } else { 0 }],
        )
        .map_err(|e| e.to_string())?;
        for (idx, it) in items.iter().enumerate() {
            conn.execute(
                "INSERT INTO assembly_items (id, assembly_id, module_id, sort_order, weight_override, is_locked) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    new_id(),
                    aid,
                    it.module.id,
                    idx as i64,
                    it.weight_override,
                    if it.locked { 1 } else { 0 }
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    match res {
        Ok(_) => {
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            Ok(aid)
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn db_save_assembly_from_ir(
    app: AppHandle,
    ir_json: String,
    final_prompt: String,
    config: AssemblyConfigDto,
    is_favorite: bool,
) -> Result<String, String> {
    let conn = open_conn(&app)?;
    let aid = new_id();
    let ts = now_ts();
    let short = if final_prompt.len() > 30 {
        format!("{}...", &final_prompt[..30])
    } else {
        final_prompt.clone()
    };
    let ymd = chrono::DateTime::<chrono::Utc>::from_timestamp(ts, 0)
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default();
    let title = if short.is_empty() {
        format!("{} · (空方案)", ymd)
    } else {
        format!("{} · {}", ymd, short)
    };
    // Parse ir_json to extract segments for assembly_items
    let segs: Vec<(String, f64)> = serde_json::from_str::<serde_json::Value>(&ir_json)
        .ok()
        .and_then(|v| v.get("segments").cloned())
        .and_then(|s| serde_json::from_value::<Vec<serde_json::Value>>(s).ok())
        .map(|arr| {
            arr.into_iter()
                .map(|seg| {
                    let mid = seg.get("source_module_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let w = seg.get("weight").and_then(|v| v.as_f64()).unwrap_or(1.0);
                    (mid, w)
                })
                .collect()
        })
        .unwrap_or_default();

    conn.execute("BEGIN IMMEDIATE", []).map_err(|e| e.to_string())?;
    let res: Result<(), String> = (|| {
        conn.execute(
            "INSERT INTO assemblies (id, title, prompt_ir, final_prompt, model_profile, created_at, is_favorite, is_deleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
            params![aid, title, ir_json, final_prompt, config.model_profile, ts, if is_favorite { 1 } else { 0 }],
        )
        .map_err(|e| e.to_string())?;
        for (idx, (mid, w)) in segs.iter().enumerate() {
            if mid.is_empty() {
                continue;
            }
            let exists: Option<i64> = conn
                .query_row("SELECT 1 FROM modules WHERE id=?1", params![mid], |r| r.get(0))
                .ok();
            if exists.is_none() {
                continue;
            }
            let w_ov: Option<f64> = if (*w - 1.0).abs() < 1e-9 { None } else { Some(*w) };
            conn.execute(
                "INSERT INTO assembly_items (id, assembly_id, module_id, sort_order, weight_override, is_locked) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
                params![new_id(), aid, mid, idx as i64, w_ov],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    match res {
        Ok(_) => {
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            Ok(aid)
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn db_list_recent(app: AppHandle, limit: i64, offset: i64) -> Result<Vec<AssemblyDto>, String> {
    let conn = open_conn(&app)?;
    let mut stmt = conn
        .prepare("SELECT id, title, prompt_ir, final_prompt, model_profile, created_at, is_favorite FROM assemblies WHERE is_deleted=0 ORDER BY created_at DESC LIMIT ?1 OFFSET ?2")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit, offset], |r| {
            Ok(AssemblyDto {
                id: r.get(0)?,
                title: r.get(1)?,
                prompt_ir_json: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                final_prompt: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                model_profile: r.get::<_, Option<String>>(4)?.unwrap_or("sd".to_string()),
                created_at: r.get(5)?,
                is_favorite: r.get::<_, i64>(6)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_list_favorites(app: AppHandle, limit: i64) -> Result<Vec<AssemblyDto>, String> {
    let conn = open_conn(&app)?;
    let mut stmt = conn
        .prepare("SELECT id, title, prompt_ir, final_prompt, model_profile, created_at, is_favorite FROM assemblies WHERE is_deleted=0 AND is_favorite=1 ORDER BY created_at DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |r| {
            Ok(AssemblyDto {
                id: r.get(0)?,
                title: r.get(1)?,
                prompt_ir_json: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                final_prompt: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                model_profile: r.get::<_, Option<String>>(4)?.unwrap_or("sd".to_string()),
                created_at: r.get(5)?,
                is_favorite: r.get::<_, i64>(6)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_search_assemblies(app: AppHandle, keyword: String) -> Result<Vec<AssemblyDto>, String> {
    let conn = open_conn(&app)?;
    let pat = format!("%{}%", keyword);
    let mut stmt = conn
        .prepare("SELECT id, title, prompt_ir, final_prompt, model_profile, created_at, is_favorite FROM assemblies WHERE is_deleted=0 AND (title LIKE ?1 OR final_prompt LIKE ?1 OR prompt_ir LIKE ?1) ORDER BY created_at DESC LIMIT 50")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![pat], |r| {
            Ok(AssemblyDto {
                id: r.get(0)?,
                title: r.get(1)?,
                prompt_ir_json: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                final_prompt: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                model_profile: r.get::<_, Option<String>>(4)?.unwrap_or("sd".to_string()),
                created_at: r.get(5)?,
                is_favorite: r.get::<_, i64>(6)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_get_assembly_items(
    app: AppHandle,
    assembly_id: String,
) -> Result<Vec<AssemblyItemDto>, String> {
    let conn = open_conn(&app)?;
    let mut stmt = conn
        .prepare("SELECT id, assembly_id, module_id, sort_order, weight_override, is_locked FROM assembly_items WHERE assembly_id=?1 ORDER BY sort_order")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![assembly_id], |r| {
            Ok(AssemblyItemDto {
                id: r.get(0)?,
                assembly_id: r.get(1)?,
                module_id: r.get(2)?,
                sort_order: r.get(3)?,
                weight_override: r.get(4)?,
                is_locked: r.get::<_, i64>(5)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_load_selected_items(
    app: AppHandle,
    assembly_id: String,
) -> Result<Vec<SelectedItemDto>, String> {
    let conn = open_conn(&app)?;
    // Fetch assembly prompt_ir for snapshot fallback
    let prompt_ir: Option<String> = conn
        .query_row(
            "SELECT prompt_ir FROM assemblies WHERE id=?1 AND is_deleted=0",
            params![assembly_id],
            |r| r.get(0),
        )
        .ok();

    let snapshot_map: std::collections::HashMap<String, (String, String, f64)> = {
        let mut m = std::collections::HashMap::new();
        if let Some(ref json) = prompt_ir {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(json) {
                if let Some(arr) = v.get("segments").and_then(|s| s.as_array()) {
                    for seg in arr {
                        let mid = seg.get("source_module_id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                        let text = seg.get("text").and_then(|x| x.as_str()).unwrap_or("").to_string();
                        let dk = seg.get("dimension_key").and_then(|x| x.as_str()).unwrap_or("").to_string();
                        let w = seg.get("weight").and_then(|x| x.as_f64()).unwrap_or(1.0);
                        if !mid.is_empty() {
                            m.insert(mid, (text, dk, w));
                        }
                    }
                }
            }
        }
        m
    };

    let mut stmt = conn
        .prepare(
            "SELECT ai.id, ai.assembly_id, ai.module_id, ai.sort_order, ai.weight_override, ai.is_locked, m.content_en, m.display_name, m.weight as mod_weight, m.is_deleted as mod_deleted, m.dimension_id, d.key as dim_key FROM assembly_items ai LEFT JOIN modules m ON m.id=ai.module_id LEFT JOIN dimensions d ON d.id=m.dimension_id WHERE ai.assembly_id=?1 ORDER BY ai.sort_order",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![assembly_id], |r| {
            Ok((
                r.get::<_, String>(2)?, // module_id
                r.get::<_, Option<f64>>(4)?,
                r.get::<_, i64>(5)? != 0,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, Option<String>>(7)?,
                r.get::<_, Option<f64>>(8)?,
                r.get::<_, Option<i64>>(9)?,
                r.get::<_, Option<String>>(10)?,
                r.get::<_, Option<String>>(11)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut result: Vec<SelectedItemDto> = Vec::new();
    for r in rows {
        let (mid, w_ov, locked, content_en, display_name, mod_weight, mod_deleted, dimension_id, dim_key) =
            r.map_err(|e| e.to_string())?;
        let snap = snapshot_map.get(&mid);
        let is_deleted = mod_deleted.map(|v| v != 0).unwrap_or(false);
        let module = if content_en.is_none() || is_deleted {
            let text = snap.map(|(t, _, _)| t.clone()).unwrap_or_else(|| format!("[已失效:{}]", &mid[..mid.len().min(8)]));
            let dk = snap.map(|(_, k, _)| k.clone()).unwrap_or_default();
            let w = snap.map(|(_, _, ww)| *ww).unwrap_or(1.0);
            let disp = format!("[已失效] {}", &text[..text.len().min(20)]);
            ModuleDto {
                id: mid.clone(),
                dimension_id: dimension_id.unwrap_or_default(),
                content_en: text.clone(),
                display_name: disp,
                weight: w,
                is_enabled: false,
                is_nsfw: false,
                usage_count: 0,
                example_image: None,
                notes: Some("[原条目已删除，已用快照占位]".to_string()),
                dimension_key: Some(dk),
            }
        } else {
            ModuleDto {
                id: mid.clone(),
                dimension_id: dimension_id.unwrap_or_default(),
                content_en: content_en.unwrap_or_default(),
                display_name: display_name.unwrap_or_default(),
                weight: mod_weight.unwrap_or(1.0),
                is_enabled: true,
                is_nsfw: false,
                usage_count: 0,
                example_image: None,
                notes: None,
                dimension_key: dim_key.clone(),
            }
        };
        let _ = display_name; // suppress unused
        let _ = mod_weight;
        result.push(SelectedItemDto {
            module,
            weight_override: w_ov,
            locked,
        });
    }

    if result.is_empty() {
        if let Some(json) = prompt_ir {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                if let Some(arr) = v.get("segments").and_then(|s| s.as_array()) {
                    for seg in arr {
                        let mid = seg.get("source_module_id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                        let text = seg.get("text").and_then(|x| x.as_str()).unwrap_or("").to_string();
                        let dk = seg.get("dimension_key").and_then(|x| x.as_str()).unwrap_or("").to_string();
                        let w = seg.get("weight").and_then(|x| x.as_f64()).unwrap_or(1.0);
                        let w_ov = if (w - 1.0).abs() < 1e-9 { None } else { Some(w) };
                        result.push(SelectedItemDto {
                            module: ModuleDto {
                                id: if mid.is_empty() { format!("snap_{}", result.len()) } else { mid },
                                dimension_id: String::new(),
                                content_en: text.clone(),
                                display_name: if text.is_empty() { "[快照]".to_string() } else { text[..text.len().min(20)].to_string() },
                                weight: w,
                                is_enabled: false,
                                is_nsfw: false,
                                usage_count: 0,
                                example_image: None,
                                notes: Some("[快照还原]".to_string()),
                                dimension_key: Some(dk),
                            },
                            weight_override: w_ov,
                            locked: false,
                        });
                    }
                }
            }
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn db_toggle_favorite(app: AppHandle, id: String) -> Result<bool, String> {
    let conn = open_conn(&app)?;
    let cur: Option<i64> = conn
        .query_row("SELECT is_favorite FROM assemblies WHERE id=?1", params![id], |r| r.get(0))
        .ok();
    let cur = cur.ok_or_else(|| format!("assembly not found: {}", id))?;
    let new_val = if cur != 0 { 0 } else { 1 };
    conn.execute("UPDATE assemblies SET is_favorite=?1 WHERE id=?2", params![new_val, id])
        .map_err(|e| e.to_string())?;
    Ok(new_val != 0)
}

#[tauri::command]
pub fn db_rename_assembly(app: AppHandle, id: String, title: String) -> Result<(), String> {
    let conn = open_conn(&app)?;
    conn.execute("UPDATE assemblies SET title=?1 WHERE id=?2", params![title, id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_soft_delete_assembly(app: AppHandle, id: String) -> Result<(), String> {
    let conn = open_conn(&app)?;
    conn.execute("UPDATE assemblies SET is_deleted=1 WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ------------------------------------------------------------------
// Templates
// ------------------------------------------------------------------
#[tauri::command]
pub fn db_save_template(
    app: AppHandle,
    name: String,
    desc: Option<String>,
    config: AssemblyConfigDto,
    enabled_keys: Vec<String>,
    cover: Option<String>,
) -> Result<String, String> {
    let conn = open_conn(&app)?;
    let tid = new_id();
    let ts = now_ts();
    let payload = serde_json::json!({
        "assembly_config": {
            "separator": config.separator,
            "use_weight_brackets": config.use_weight_brackets,
            "model_profile": config.model_profile,
            "sort_by": config.sort_by,
        },
        "enabled_dimension_keys": enabled_keys,
        "version": 1,
    });
    let config_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO templates (id, name, description, config_json, cover_prompt, created_at, is_deleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
        params![tid, name, desc, config_json, cover, ts],
    )
    .map_err(|e| e.to_string())?;
    Ok(tid)
}

#[tauri::command]
pub fn db_list_templates(app: AppHandle) -> Result<Vec<TemplateDto>, String> {
    let conn = open_conn(&app)?;
    let mut stmt = conn
        .prepare("SELECT id, name, description, config_json, cover_prompt, created_at FROM templates WHERE is_deleted=0 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TemplateDto {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                config_json: r.get(3)?,
                cover_prompt: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_apply_template(app: AppHandle, id: String) -> Result<(AssemblyConfigDto, Vec<String>), String> {
    let conn = open_conn(&app)?;
    let cfg_json: Option<String> = conn
        .query_row("SELECT config_json FROM templates WHERE id=?1 AND is_deleted=0", params![id], |r| r.get(0))
        .ok();
    let Some(json) = cfg_json else {
        return Ok((
            AssemblyConfigDto {
                separator: ", ".to_string(),
                use_weight_brackets: true,
                model_profile: "sd".to_string(),
                sort_by: "dimensionOrder".to_string(),
            },
            vec![],
        ));
    };
    if json.is_empty() {
        return Ok((
            AssemblyConfigDto {
                separator: ", ".to_string(),
                use_weight_brackets: true,
                model_profile: "sd".to_string(),
                sort_by: "dimensionOrder".to_string(),
            },
            vec![],
        ));
    }
    let v: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let ac = v.get("assembly_config");
    let enabled = v
        .get("enabled_dimension_keys")
        .and_then(|x| x.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let cfg = AssemblyConfigDto {
        separator: ac.and_then(|x| x.get("separator")).and_then(|x| x.as_str()).unwrap_or(", ").to_string(),
        use_weight_brackets: ac.and_then(|x| x.get("use_weight_brackets")).and_then(|x| x.as_bool()).unwrap_or(true),
        model_profile: ac.and_then(|x| x.get("model_profile")).and_then(|x| x.as_str()).unwrap_or("sd").to_string(),
        sort_by: ac.and_then(|x| x.get("sort_by")).and_then(|x| x.as_str()).unwrap_or("dimensionOrder").to_string(),
    };
    Ok((cfg, enabled))
}

#[tauri::command]
pub fn db_soft_delete_template(app: AppHandle, id: String) -> Result<(), String> {
    let conn = open_conn(&app)?;
    conn.execute("UPDATE templates SET is_deleted=1 WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_export_csv(app: AppHandle, path: String, results_json: String) -> Result<(), String> {
    let _conn = open_conn(&app)?;
    let items: Vec<serde_json::Value> =
        serde_json::from_str(&results_json).map_err(|e| e.to_string())?;
    // Buffer with UTF-8 BOM + csv rows, then single atomic write (Excel friendly)
    let mut buf: Vec<u8> = vec![0xEF, 0xBB, 0xBF];
    {
        let mut wtr = csv::Writer::from_writer(&mut buf);
        wtr.write_record(["index", "final_prompt", "hash", "warnings"])
            .map_err(|e| e.to_string())?;
        for (i, v) in items.iter().enumerate() {
            let prompt = v
                .get("finalPrompt")
                .and_then(|x| x.as_str())
                .unwrap_or("");
            let hash = v.get("hash").and_then(|x| x.as_str()).unwrap_or("");
            let warnings = v
                .get("warnings")
                .and_then(|x| x.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str())
                        .collect::<Vec<_>>()
                        .join("; ")
                })
                .unwrap_or_default();
            wtr.write_record([&(i + 1).to_string(), prompt, hash, &warnings])
                .map_err(|e| e.to_string())?;
        }
        wtr.flush().map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, buf).map_err(|e| e.to_string())?;
    Ok(())
}
