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

/// 数据库文件所在目录 = exe_dir/data/
pub fn data_dir_for(_app: &AppHandle) -> Result<PathBuf, String> {
    // 不能使用 app.path().executable_dir()：Tauri v2 在 Windows 上该 API 直接报
    // Err(Not supported)（底层 dirs::executable_dir() 在 win.rs 中恒为 None），
    // 导致 init_db 静默失败、data 目录永不创建。
    // std::env::current_exe() 返回实际 exe 的绝对路径，Windows/macOS/Linux 均可靠。
    let exe = std::env::current_exe()
        .map_err(|e| format!("无法获取当前可执行文件路径: {}", e))?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| "无法获取可执行文件所在目录".to_string())?;
    Ok(data_dir_from_exe(exe_dir))
}

/// exe 目录 → data 目录的纯拼接逻辑（可单测，无需 AppHandle）
fn data_dir_from_exe(exe_dir: &Path) -> PathBuf {
    exe_dir.join("data")
}

/// 完整数据库文件路径 = exe_dir/data/pmf.db
pub fn exe_db_path_for(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir_for(app)?.join("pmf.db"))
}

pub fn db_path_for(app: &AppHandle) -> Result<PathBuf, String> {
    exe_db_path_for(app)
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

pub fn migrate_if_needed(conn: &Connection) -> Result<(), String> {
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

pub fn ensure_dimensions(conn: &Connection) -> Result<(), String> {
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

pub fn mark_nsfw_modules(conn: &Connection) -> Result<(), String> {
    for mid in NSFW_MODULE_IDS {
        let _ = conn.execute("UPDATE modules SET is_nsfw=1 WHERE id=?1", rusqlite::params![mid]);
    }
    let _ = conn.execute("UPDATE modules SET is_nsfw=0 WHERE id='mod_gender_15'", []);
    Ok(())
}

pub fn disable_deprecated_gender(conn: &Connection) -> Result<(), String> {
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

pub fn import_sample_prompts(conn: &Connection, app: &AppHandle) -> Result<usize, String> {
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


pub fn schema_sql() -> &'static str {
    SCHEMA_SQL
}

pub fn seed_rules_if_empty(conn: &Connection) -> Result<(), String> {
    let rule_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM rules WHERE is_deleted=0", [], |r| r.get(0))
        .unwrap_or(0);
    if rule_count == 0 {
        let ts = chrono::Utc::now().timestamp();
        let rules: Vec<(&str, &str, &str, &str, Option<&str>, &str, Option<&str>, &str)> = vec![
            ("rule_01","套装互斥","mutex","dim_05",None,"dim_03",None,"已选全身套装，上装/下装将自动忽略"),
            ("rule_02","鞋袜与赤脚互斥","mutex","dim_06",Some("mod_shoes_15"),"dim_06",None,"赤脚与鞋袜不可共存"),
            ("rule_03","室内外背景互斥","excludes","dim_10",Some("mod_bg_01"),"dim_10",None,"室内背景与户外背景冲突"),
        ];
        for (id, name, ty, src_dim, src_mod, tgt_dim, tgt_mod, msg) in rules {
            conn.execute(
                "INSERT OR IGNORE INTO rules (id, name, type, source_dimension_id, source_module_id, target_dimension_id, target_module_id, message, is_enabled, created_at, is_deleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, 0)",
                rusqlite::params![id, name, ty, src_dim, src_mod, tgt_dim, tgt_mod, msg, ts],
            ).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
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
/// 数据库位于 exe 所在目录的 data/ 下；若新库不存在且旧 %APPDATA% 库存在，则自动迁移。
pub fn init_db(app: &AppHandle) -> Result<PathBuf, String> {
    // exe 旁 data/ 目录；创建失败给出明确指引，绝不静默回退到 AppData
    let dir = data_dir_for(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| {
        format!(
            "无法创建数据库目录 '{}': {}。\n提示：请确保程序所在目录可写，或以管理员权限运行。",
            dir.display(),
            e
        )
    })?;
    let db_path = dir.join("pmf.db");
    let is_new_file = !db_path.exists();

    // ---- 旧库自动迁移：新库不存在但旧 AppData 库存在 → SQLite backup API 安全迁移 ----
    let legacy_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("pmf.db");
    if is_new_file && legacy_path.exists() {
        migrate_legacy_db(&legacy_path, &db_path)?;
        eprintln!(
            "[pmf] 旧库已迁移: {} → {}",
            legacy_path.display(),
            db_path.display()
        );
    }

    let conn = open_and_pragmas(&db_path)?;
    if is_new_file || is_new_db(&conn) {
        conn.execute_batch(SCHEMA_SQL).map_err(|e| e.to_string())?;
    }
    migrate_if_needed(&conn)?;
    seed_if_empty(&conn, app)?;
    Ok(db_path)
}

/// 使用 rusqlite 的 backup API 将旧库完整复制到新路径（事务级原子，含 WAL checkpoint）。
/// 旧库只读不删除，保证回滚安全。
pub fn migrate_legacy_db(legacy: &Path, new_path: &Path) -> Result<(), String> {
    let _ = std::fs::remove_file(new_path);
    if let Some(parent) = new_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建目标目录 '{}': {}", parent.display(), e))?;
    }
    // 源库：先 checkpoint WAL 到主文件，再用 backup API 全量复制
    let src = Connection::open(legacy).map_err(|e| format!("打开旧库失败 '{}': {}", legacy.display(), e))?;
    let _ = src.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    let mut dst = Connection::open(new_path).map_err(|e| e.to_string())?;
    let backup = rusqlite::backup::Backup::new(&src, &mut dst)
        .map_err(|e| format!("备份初始化失败: {}", e))?;
    backup
        .run_to_completion(50, std::time::Duration::from_millis(250), None)
        .map_err(|e| format!("备份执行失败: {}", e))?;
    drop(backup);
    dst.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| e.to_string())?;
    Ok(())
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

// ------------------------------------------------------------------
// Unit tests
// ------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("pmf_test_{}_{}", tag, uuid::Uuid::new_v4()));
        fs_impl::create_dir_all(&base).unwrap();
        base
    }

    mod fs_impl {
        pub use std::fs::*;
    }

    #[test]
    fn data_dir_from_exe_returns_data_suffix() {
        let d = data_dir_from_exe(Path::new("C:/AnyDir/app"));
        assert!(d.ends_with("data"));
        assert_eq!(d, PathBuf::from("C:/AnyDir/app/data"));
        // 完整 db 路径以 pmf.db 结尾
        assert!(d.join("pmf.db").ends_with("pmf.db"));
    }

    #[test]
    fn reset_legacy_db_copies_all_data() {
        let dir = unique_temp_dir("migrate");
        let legacy = dir.join("old/pmf.db");
        fs_impl::create_dir_all(legacy.parent().unwrap()).unwrap();
        let new_path = dir.join("new/pmf.db");

        // 1) 建旧库并灌入数据
        {
            let conn = Connection::open(&legacy).unwrap();
            conn.execute_batch(SCHEMA_SQL).unwrap();
            let ts = 1_700_000_000i64;
            conn.execute_batch(&format!(
                "INSERT INTO dimensions (id, key, name_cn, name_en, sort_order, is_multi_select, is_enabled, icon, created_at, updated_at, is_deleted) VALUES
                 ('dim_a','top','上装','Top',1,0,1,NULL,{ts},{ts},0),
                 ('dim_b','bottom','下装','Bottom',2,0,1,NULL,{ts},{ts},0);"
            ))
            .unwrap();
            conn.execute_batch(&format!(
                "INSERT INTO modules (id, dimension_id, content_en, display_name, weight, is_enabled, is_nsfw, usage_count, example_image, notes, created_at, updated_at, is_deleted) VALUES
                 ('moda1','dim_a','white shirt','白衬衫',1.0,1,0,5,NULL,NULL,{ts},{ts},0),
                 ('moda2','dim_a','black shirt','黑衬衫',1.2,1,0,0,NULL,NULL,{ts},{ts},0),
                 ('modb1','dim_b','skinny jeans','紧身牛仔裤',1.0,1,0,3,NULL,NULL,{ts},{ts},0);"
            ))
            .unwrap();
            conn.execute_batch(&format!(
                "INSERT INTO rules (id, name, type, source_dimension_id, source_module_id, target_dimension_id, target_module_id, message, is_enabled, created_at, is_deleted) VALUES
                 ('rule_x','测试规则','mutex','dim_a',NULL,'dim_b',NULL,'互斥',1,{ts},0);"
            ))
            .unwrap();
            conn.execute_batch(&format!(
                "INSERT INTO tags (id, name, color, created_at, is_deleted) VALUES ('tag_x','韩系','#ff0000',{ts},0);"
            ))
            .unwrap();
        }

        // 2) 迁移
        migrate_legacy_db(&legacy, &new_path).unwrap();

        // 3) 新库数据一致
        let conn = Connection::open(&new_path).unwrap();
        let dims: i64 = conn
            .query_row("SELECT COUNT(*) FROM dimensions", [], |r| r.get(0))
            .unwrap();
        let mods: i64 = conn
            .query_row("SELECT COUNT(*) FROM modules", [], |r| r.get(0))
            .unwrap();
        let rules: i64 = conn
            .query_row("SELECT COUNT(*) FROM rules", [], |r| r.get(0))
            .unwrap();
        let tags: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!((dims, mods, rules, tags), (2, 3, 1, 1));
        // 内容抽样
        let name: String = conn
            .query_row(
                "SELECT name_cn FROM dimensions WHERE key='top'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(name, "上装");
        let content: String = conn
            .query_row(
                "SELECT content_en FROM modules WHERE id='modb1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(content, "skinny jeans");
        let msg: String = conn
            .query_row(
                "SELECT message FROM rules WHERE id='rule_x'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(msg, "互斥");
        // 4) 旧库保留不动（回滚安全）
        assert!(legacy.exists());
        assert!(new_path.exists());
        let _ = fs_impl::remove_dir_all(&dir);
    }

    #[test]
    fn migrate_wal_pragmas_are_applied() {
        let dir = unique_temp_dir("wal");
        let db = dir.join("pmf.db");
        let conn = open_and_pragmas(&db).unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
        let _ = fs_impl::remove_dir_all(&dir);
    }
}
