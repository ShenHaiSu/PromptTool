use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

// ------------------------------------------------------------------
// Helpers — schema / display names embedded
// ------------------------------------------------------------------

const SCHEMA_SQL: &str = include_str!("../../resources/schema.sql");

const NSFW_MODULE_IDS: &[&str] = &[
    "mod_body_15",
    "mod_face_15",
    "mod_top_15",
    "mod_bottom_15",
    "mod_outfit_15",
    "mod_shoes_15",
    "mod_accessories_15",
    "mod_pose_15",
    "mod_props_15",
    "mod_background_15",
    "mod_camera_15",
    "mod_body_26",
    "mod_body_27",
    "mod_body_28",
    "mod_face_26",
    "mod_face_27",
    "mod_face_28",
    "mod_top_26",
    "mod_top_27",
    "mod_top_28",
    "mod_bottom_26",
    "mod_bottom_27",
    "mod_bottom_28",
    "mod_outfit_26",
    "mod_outfit_27",
    "mod_outfit_28",
    "mod_shoes_26",
    "mod_shoes_27",
    "mod_shoes_28",
    "mod_accessories_26",
    "mod_accessories_27",
    "mod_accessories_28",
    "mod_pose_26",
    "mod_pose_27",
    "mod_pose_28",
    "mod_props_26",
    "mod_props_27",
    "mod_props_28",
    "mod_background_26",
    "mod_background_27",
    "mod_background_28",
    "mod_camera_26",
    "mod_camera_27",
    "mod_camera_28",
];

const DISABLED_GENDER_IDS: &[&str] = &[
    "mod_gender_11",
    "mod_gender_12",
    "mod_gender_13",
    "mod_gender_14",
    "mod_gender_15",
];

const TARGET_ORDER: &[(&str, i64)] = &[
    ("gender", 1),
    ("ethnicity", 2),
    ("height", 3),
    ("body", 4),
    ("face", 5),
    ("top", 6),
    ("bottom", 7),
    ("outfit", 8),
    ("shoes", 9),
    ("accessories", 10),
    ("pose", 11),
    ("props", 12),
    ("background", 13),
    ("camera", 14),
];

// ------------------------------------------------------------------
// Public: init_db — called from setup
// ------------------------------------------------------------------

pub fn db_path_for(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(dir.join("pmf.db"))
}

fn open_and_pragmas(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn is_new_db(conn: &Connection) -> bool {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dimensions'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(1);
    count == 0
}

fn migrate_if_needed(conn: &Connection) -> Result<(), String> {
    // Check is_nsfw column exists
    let cols: Vec<String> = conn
        .prepare("PRAGMA table_info(modules)")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    if !cols.iter().any(|c| c == "is_nsfw") {
        conn.execute(
            "ALTER TABLE modules ADD COLUMN is_nsfw INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    // P0-01 indexes (idempotent)
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_assemblies_favorite ON assemblies(is_favorite) WHERE is_deleted = 0",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_assemblies_created ON assemblies(created_at DESC) WHERE is_deleted = 0",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_templates_created ON templates(created_at DESC) WHERE is_deleted = 0",
        [],
    );
    Ok(())
}

fn ensure_dimensions(conn: &Connection) -> Result<(), String> {
    let ts = chrono::Utc::now().timestamp();
    let dims: Vec<(&str, &str, &str, &str, i64, i64)> = vec![
        ("dim_01", "body", "模特身材特点", "Body", 4, 0),
        ("dim_02", "face", "模特面部特点", "Face", 5, 0),
        ("dim_03", "top", "模特上装", "Top", 6, 0),
        ("dim_04", "bottom", "模特下装", "Bottom", 7, 0),
        ("dim_05", "outfit", "模特全身套装", "Outfit", 8, 0),
        ("dim_06", "shoes", "模特鞋袜", "Shoes", 9, 0),
        ("dim_07", "accessories", "模特配饰", "Accessories", 10, 1),
        ("dim_08", "pose", "模特姿势", "Pose", 11, 0),
        ("dim_09", "props", "交互物品", "Props", 12, 0),
        ("dim_10", "background", "背景风格", "Background", 13, 0),
        ("dim_11", "camera", "相机参数", "Camera", 14, 0),
        ("dim_12", "gender", "模特性别", "Gender", 1, 0),
        ("dim_13", "ethnicity", "模特人种", "Ethnicity", 2, 0),
        ("dim_14", "height", "模特身高", "Height", 3, 0),
    ];
    for (id, key, cn, en, order, multi) in dims {
        conn.execute(
            "INSERT OR IGNORE INTO dimensions (id, key, name_cn, name_en, sort_order, is_multi_select, is_enabled, icon, created_at, updated_at, is_deleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, NULL, ?7, ?8, 0)",
            rusqlite::params![id, key, cn, en, order, multi, ts, ts],
        )
        .map_err(|e| e.to_string())?;
    }
    for (key, order) in TARGET_ORDER {
        conn.execute(
            "UPDATE dimensions SET sort_order=?1, updated_at=?2 WHERE key=?3 AND sort_order!=?1",
            rusqlite::params![order, ts, key],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn mark_nsfw_modules(conn: &Connection) -> Result<(), String> {
    for mid in NSFW_MODULE_IDS {
        let _ = conn.execute("UPDATE modules SET is_nsfw=1 WHERE id=?1", rusqlite::params![mid]);
    }
    let _ = conn.execute("UPDATE modules SET is_nsfw=0 WHERE id='mod_gender_15'", []);
    Ok(())
}

fn disable_deprecated_gender(conn: &Connection) -> Result<(), String> {
    let ts = chrono::Utc::now().timestamp();
    let placeholders = DISABLED_GENDER_IDS
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "UPDATE modules SET is_enabled=0, updated_at=?1 WHERE id IN ({}) AND is_deleted=0 AND is_enabled=1",
        placeholders
    );
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(ts)];
    for id in DISABLED_GENDER_IDS {
        params.push(Box::new(*id));
    }
    let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| b.as_ref()).collect();
    let _ = conn.execute(&sql, refs.as_slice());
    Ok(())
}

fn import_sample_prompts(conn: &Connection, app: &AppHandle) -> Result<usize, String> {
    // Resolve samplePrompt dir: prefer bundled resources, fallback to docs/samplePrompt
    let candidate_dirs: Vec<PathBuf> = {
        let mut v = Vec::new();
        if let Ok(res_dir) = app.path().resource_dir() {
            v.push(res_dir.join("samplePrompt"));
            v.push(res_dir.join("../docs/samplePrompt"));
        }
        // Dev fallback: relative to current dir
        v.push(PathBuf::from("docs/samplePrompt"));
        v.push(PathBuf::from("../docs/samplePrompt"));
        v.push(PathBuf::from("../../docs/samplePrompt"));
        v
    };
    let sample_dir = candidate_dirs.iter().find(|p| p.is_dir()).cloned();
    let sample_dir = match sample_dir {
        Some(p) => p,
        None => return Ok(0),
    };

    let rows: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, key FROM dimensions WHERE is_deleted=0")
            .map_err(|e| e.to_string())?;
        let iter = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        iter.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    let dim_map: HashMap<String, String> = rows.into_iter().collect();
    let ts = chrono::Utc::now().timestamp();
    let mut count = 0usize;

    for (key, dim_id) in &dim_map {
        let dim_dir = sample_dir.join(key);
        if !dim_dir.is_dir() {
            continue;
        }
        let entries = std::fs::read_dir(&dim_dir).map_err(|e| e.to_string())?;
        let mut files: Vec<PathBuf> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().map(|e| e == "txt").unwrap_or(false))
            .collect();
        files.sort();
        for f in files {
            let content = std::fs::read_to_string(&f)
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            if content.is_empty() {
                continue;
            }
            let stem = f.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let num_str = stem.split('_').last().unwrap_or("01");
            let num: i32 = num_str.parse().unwrap_or(1);
            let module_id = format!("mod_{}_{:02}", key, num);
            let display_name = content.clone(); // fallback to content; Rust no DISPLAY_NAMES embed to keep binary small
            let exists: Option<String> = conn
                .query_row(
                    "SELECT display_name FROM modules WHERE id=?1",
                    rusqlite::params![module_id],
                    |r| r.get(0),
                )
                .ok();
            if exists.is_some() {
                // existing: only update content_en if changed and display_name was equal to old content (preserve user edits)
                let old_content: Option<String> = conn
                    .query_row(
                        "SELECT content_en FROM modules WHERE id=?1",
                        rusqlite::params![module_id],
                        |r| r.get(0),
                    )
                    .ok();
                if let Some(old) = old_content {
                    if old != content {
                        // If display_name == old content, update both; else only content
                        let disp: String = exists.unwrap_or_default();
                        if disp == old {
                            let _ = conn.execute(
                                "UPDATE modules SET content_en=?1, display_name=?2, updated_at=?3 WHERE id=?4",
                                rusqlite::params![content, display_name, ts, module_id],
                            );
                        } else {
                            let _ = conn.execute(
                                "UPDATE modules SET content_en=?1, updated_at=?2 WHERE id=?3",
                                rusqlite::params![content, ts, module_id],
                            );
                        }
                    }
                }
                continue;
            }
            conn.execute(
                "INSERT OR IGNORE INTO modules (id, dimension_id, content_en, display_name, weight, is_enabled, is_nsfw, usage_count, example_image, notes, created_at, updated_at, is_deleted) VALUES (?1, ?2, ?3, ?4, 1.0, 1, 0, 0, NULL, NULL, ?5, ?6, 0)",
                rusqlite::params![module_id, dim_id, content, display_name, ts, ts],
            )
            .map_err(|e| e.to_string())?;
            // rusqlite changes() not per-row with IGNORE; count if inserted
            let ch = conn.changes();
            if ch > 0 {
                count += 1;
            }
        }
    }
    Ok(count)
}

fn seed_if_empty(conn: &Connection, app: &AppHandle) -> Result<(), String> {
    ensure_dimensions(conn)?;
    let existing: i64 = conn
        .query_row("SELECT COUNT(*) FROM modules WHERE is_deleted=0", [], |r| r.get(0))
        .unwrap_or(0);
    if existing == 0 {
        // first run: import
        let _ = import_sample_prompts(conn, app);
    } else {
        // incremental repair: ensure any missing files are imported (idempotent)
        let _ = import_sample_prompts(conn, app);
    }
    mark_nsfw_modules(conn)?;
    disable_deprecated_gender(conn)?;
    // Seed 3 rules if empty
    let rule_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM rules WHERE is_deleted=0", [], |r| r.get(0))
        .unwrap_or(0);
    if rule_count == 0 {
        let ts = chrono::Utc::now().timestamp();
        let rules: Vec<(&str, &str, &str, &str, Option<&str>, &str, Option<&str>, &str)> = vec![
            (
                "rule_01",
                "套装互斥",
                "mutex",
                "dim_05",
                None,
                "dim_03",
                None,
                "已选全身套装，上装/下装将自动忽略",
            ),
            (
                "rule_02",
                "鞋袜与赤脚互斥",
                "mutex",
                "dim_06",
                Some("mod_shoes_15"),
                "dim_06",
                None,
                "赤脚与鞋袜不可共存",
            ),
            (
                "rule_03",
                "室内外背景互斥",
                "excludes",
                "dim_10",
                Some("mod_bg_01"),
                "dim_10",
                None,
                "室内背景与户外背景冲突",
            ),
        ];
        for (id, name, ty, src_dim, src_mod, tgt_dim, tgt_mod, msg) in rules {
            conn.execute(
                "INSERT OR IGNORE INTO rules (id, name, type, source_dimension_id, source_module_id, target_dimension_id, target_module_id, message, is_enabled, created_at, is_deleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, 0)",
                rusqlite::params![id, name, ty, src_dim, src_mod, tgt_dim, tgt_mod, msg, ts],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Initialize DB file, run migrations, seed. Called from Tauri setup.
pub fn init_db(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let db_path = dir.join("pmf.db");
    let is_new_file = !db_path.exists();
    let conn = open_and_pragmas(&db_path)?;
    if is_new_file || is_new_db(&conn) {
        conn.execute_batch(SCHEMA_SQL).map_err(|e| e.to_string())?;
    }
    migrate_if_needed(&conn)?;
    seed_if_empty(&conn, app)?;
    Ok(db_path)
}

// ------------------------------------------------------------------
// Legacy import
// ------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub dimensions: i64,
    pub modules: i64,
    pub assemblies: i64,
    pub templates: i64,
    pub skipped: i64,
}

#[tauri::command]
pub fn db_import_legacy_db(app: AppHandle, legacy_path: String) -> Result<ImportReport, String> {
    let new_path = db_path_for(&app)?;
    if !Path::new(&legacy_path).exists() {
        return Err(format!("旧库文件不存在: {}", legacy_path));
    }
    let conn = open_and_pragmas(&new_path)?;
    // Ensure schema exists before attach
    if is_new_db(&conn) {
        conn.execute_batch(SCHEMA_SQL).map_err(|e| e.to_string())?;
    }
    // ATTACH legacy
    // Use single quotes escape: rusqlite param for ATTACH not supported, use format with escaping
    let escaped = legacy_path.replace('\'', "''");
    conn.execute_batch(&format!("ATTACH DATABASE '{}' AS legacy;", escaped))
        .map_err(|e| e.to_string())?;

    let mut report = ImportReport {
        dimensions: 0,
        modules: 0,
        assemblies: 0,
        templates: 0,
        skipped: 0,
    };

    // Helper to run INSERT OR IGNORE and count changes
    let count_insert = |sql: &str| -> i64 {
        let ch_before = conn
            .query_row("SELECT total_changes()", [], |r| r.get::<_, i64>(0))
            .unwrap_or(0);
        let _ = conn.execute_batch(sql);
        let ch_after = conn
            .query_row("SELECT total_changes()", [], |r| r.get::<_, i64>(0))
            .unwrap_or(ch_before);
        (ch_after - ch_before).max(0)
    };

    report.dimensions = count_insert(
        "INSERT OR IGNORE INTO main.dimensions SELECT * FROM legacy.dimensions;",
    );
    report.modules = count_insert(
        "INSERT OR IGNORE INTO main.modules SELECT * FROM legacy.modules;",
    );
    // tags
    let _ = count_insert(
        "INSERT OR IGNORE INTO main.tags SELECT * FROM legacy.tags;",
    );
    let _ = count_insert(
        "INSERT OR IGNORE INTO main.module_tags SELECT * FROM legacy.module_tags;",
    );
    report.assemblies = count_insert(
        "INSERT OR IGNORE INTO main.assemblies SELECT * FROM legacy.assemblies;",
    );
    let _ = count_insert(
        "INSERT OR IGNORE INTO main.assembly_items SELECT * FROM legacy.assembly_items;",
    );
    report.templates = count_insert(
        "INSERT OR IGNORE INTO main.templates SELECT * FROM legacy.templates;",
    );
    let _ = count_insert(
        "INSERT OR IGNORE INTO main.rules SELECT * FROM legacy.rules;",
    );

    let _ = conn.execute_batch("DETACH DATABASE legacy;");
    migrate_if_needed(&conn)?;
    Ok(report)
}
