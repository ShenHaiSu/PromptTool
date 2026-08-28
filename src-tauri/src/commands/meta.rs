use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Manager};

const META_SCHEMA_SQL: &str = include_str!("../../resources/meta_schema.sql");

pub struct AppState {
    pub default_db: PathBuf,
    pub foreground: Mutex<Option<PathBuf>>,
    pub resident: Mutex<VecDeque<PathBuf>>,
    pub max_active: Mutex<usize>,
}

// ------------------------------------------------------------------
// Meta DB helpers
// ------------------------------------------------------------------

fn open_and_pragmas_meta(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn is_new_meta_db(conn: &Connection) -> bool {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='db_registry'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(1);
    n == 0
}

pub fn init_default_db(path: &Path) -> Result<(), String> {
    let conn = open_and_pragmas_meta(path)?;
    if is_new_meta_db(&conn) {
        conn.execute_batch(META_SCHEMA_SQL)
            .map_err(|e| e.to_string())?;
    } else {
        // Ensure schema exists (idempotent) + upgrade path collation
        conn.execute_batch(META_SCHEMA_SQL)
            .map_err(|e| e.to_string())?;
    }
    conn.execute(
        "INSERT OR IGNORE INTO app_settings(k,v) VALUES ('max_active','2')",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_state_from_meta(
    default_db: &Path,
) -> Result<(Option<PathBuf>, usize, VecDeque<PathBuf>), String> {
    let conn = Connection::open(default_db).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;

    // Ensure missing rows are marked before loading
    let _ = refresh_missing_status(default_db);

    let fg: Option<String> = conn
        .query_row(
            "SELECT v FROM app_settings WHERE k='foreground_path'",
            [],
            |r| r.get(0),
        )
        .ok();
    let max_active: usize = conn
        .query_row(
            "SELECT v FROM app_settings WHERE k='max_active'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(2)
        .clamp(1, 5);

    let fg_path = fg
        .and_then(|s| {
            let p = PathBuf::from(s.trim());
            if p.is_absolute() {
                Some(p)
            } else {
                None
            }
        })
        .filter(|p| p.exists());

    // If fg path existed but status is missing, treat as None
    let fg_path = match &fg_path {
        Some(p) => {
            let status: Option<String> = conn
                .query_row(
                    "SELECT status FROM db_registry WHERE path=?1 COLLATE NOCASE",
                    rusqlite::params![p.to_string_lossy().to_string()],
                    |r| r.get(0),
                )
                .ok();
            if status.as_deref() == Some("missing") {
                None
            } else {
                fg_path
            }
        }
        None => None,
    };

    let mut resident = VecDeque::new();
    if max_active > 1 {
        let fg_lower = fg_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        let limit = (max_active as i64) - if fg_path.is_some() { 1 } else { 0 };
        if limit > 0 {
            if let Ok(mut stmt) = conn.prepare(
                "SELECT path FROM db_registry WHERE status='available' ORDER BY last_opened_at DESC LIMIT ?1",
            ) {
                if let Ok(rows) = stmt.query_map(rusqlite::params![limit], |r| r.get::<_, String>(0)) {
                    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
                    for r in rows.flatten() {
                        let lower = r.to_ascii_lowercase();
                        if lower == fg_lower {
                            continue;
                        }
                        if !seen.insert(lower.clone()) {
                            continue;
                        }
                        let p = PathBuf::from(&r);
                        if p.exists() && fg_path.as_ref().map(|fp| fp.to_string_lossy().to_ascii_lowercase() != lower).unwrap_or(true) {
                            resident.push_back(p);
                        }
                    }
                }
            }
        }
    }
    Ok((fg_path, max_active, resident))
}

pub fn open_active_conn(app: &AppHandle) -> Result<Connection, String> {
    let state = app.state::<AppState>();
    let fg = state
        .foreground
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "当前无激活的提示词数据库，请先选择或创建一个业务库".to_string())?;
    if !fg.exists() {
        let _ = mark_registry_missing(&state.default_db, &fg);
        return Err(format!("当前前台数据库文件不存在: {}", fg.display()));
    }
    let conn = Connection::open(&fg).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn refresh_registry_counts(default_db: &Path, business_path: &Path) -> Result<(), String> {
    let bconn = Connection::open(business_path).map_err(|e| e.to_string())?;
    bconn
        .execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    let dim_count: i64 = bconn
        .query_row(
            "SELECT COUNT(*) FROM dimensions WHERE is_deleted=0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let module_count: i64 = bconn
        .query_row(
            "SELECT COUNT(*) FROM modules WHERE is_deleted=0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let favorite_count: i64 = bconn
        .query_row(
            "SELECT COUNT(*) FROM assemblies WHERE is_favorite=1 AND is_deleted=0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let mconn = Connection::open(default_db).map_err(|e| e.to_string())?;
    mconn
        .execute(
            "UPDATE db_registry SET dim_count=?1, module_count=?2, favorite_count=?3 WHERE path=?4 COLLATE NOCASE",
            rusqlite::params![
                dim_count,
                module_count,
                favorite_count,
                business_path.to_string_lossy().to_string()
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn mark_registry_missing(default_db: &Path, path: &Path) -> Result<(), String> {
    let conn = Connection::open(default_db).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE db_registry SET status='missing' WHERE path=?1 COLLATE NOCASE",
        rusqlite::params![path.to_string_lossy().to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn refresh_missing_status(default_db: &Path) -> Result<(), String> {
    let conn = Connection::open(default_db).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT path, status FROM db_registry")
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    for (path_str, status) in rows {
        let p = PathBuf::from(&path_str);
        let exists = p.exists();
        if !exists && status == "available" {
            let _ = conn.execute(
                "UPDATE db_registry SET status='missing' WHERE path=?1 COLLATE NOCASE",
                rusqlite::params![path_str],
            );
        } else if exists && status == "missing" {
            // Auto-heal if file reappeared and is valid
            let _ = conn.execute(
                "UPDATE db_registry SET status='available' WHERE path=?1 COLLATE NOCASE",
                rusqlite::params![path_str],
            );
        }
    }
    // If foreground points to missing, clear it
    if let Ok(fg) = conn.query_row(
        "SELECT v FROM app_settings WHERE k='foreground_path'",
        [],
        |r| r.get::<_, String>(0),
    ) {
        let fp = PathBuf::from(&fg);
        if !fp.exists() {
            let _ = conn.execute(
                "DELETE FROM app_settings WHERE k='foreground_path'",
                [],
            );
        } else {
            // also check if that registry row is missing
            let st: Option<String> = conn.query_row(
                "SELECT status FROM db_registry WHERE path=?1 COLLATE NOCASE",
                rusqlite::params![fg],
                |r| r.get(0),
            ).ok();
            if st.as_deref() == Some("missing") {
                let _ = conn.execute("DELETE FROM app_settings WHERE k='foreground_path'", []);
            }
        }
    }
    Ok(())
}

// ------------------------------------------------------------------
// Registry row helpers
// ------------------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RegistryRow {
    pub id: String,
    pub path: String,
    pub alias: String,
    pub remark: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub last_opened_at: Option<i64>,
    pub dim_count: i64,
    pub module_count: i64,
    pub favorite_count: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActiveInfo {
    pub foreground: Option<RegistryRow>,
    pub resident: Vec<RegistryRow>,
    pub max_active: usize,
}

fn row_from_sql(r: &rusqlite::Row) -> rusqlite::Result<RegistryRow> {
    Ok(RegistryRow {
        id: r.get(0)?,
        path: r.get(1)?,
        alias: r.get(2)?,
        remark: r.get(3)?,
        status: r.get(4)?,
        created_at: r.get(5)?,
        last_opened_at: r.get(6)?,
        dim_count: r.get(7)?,
        module_count: r.get(8)?,
        favorite_count: r.get(9)?,
    })
}

pub fn query_registry_rows(default_db: &Path, filter: Option<&str>) -> Result<Vec<RegistryRow>, String> {
    let _ = refresh_missing_status(default_db);
    let conn = Connection::open(default_db).map_err(|e| e.to_string())?;
    let sql = if filter.is_some() {
        "SELECT id, path, alias, remark, status, created_at, last_opened_at, dim_count, module_count, favorite_count FROM db_registry WHERE status=?1 COLLATE NOCASE ORDER BY last_opened_at DESC"
    } else {
        "SELECT id, path, alias, remark, status, created_at, last_opened_at, dim_count, module_count, favorite_count FROM db_registry ORDER BY last_opened_at DESC"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let Some(f) = filter {
        let rows = stmt.query_map(rusqlite::params![f], |r| row_from_sql(r)).map_err(|e| e.to_string())?;
        for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    } else {
        let rows = stmt.query_map([], |r| row_from_sql(r)).map_err(|e| e.to_string())?;
        for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    }
    Ok(out)
}

// ------------------------------------------------------------------
// Commands
// ------------------------------------------------------------------

#[tauri::command]
pub fn db_get_active_info(app: AppHandle) -> Result<ActiveInfo, String> {
    let state = app.state::<AppState>();
    let default_db = state.default_db.clone();
    let _ = refresh_missing_status(&default_db);
    let fg_path = state
        .foreground
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let max_active = *state.max_active.lock().map_err(|e| e.to_string())?;
    let resident_paths = state.resident.lock().map_err(|e| e.to_string())?.clone();

    // Sync foreground with DB if DB was changed externally
    let conn = Connection::open(&default_db).map_err(|e| e.to_string())?;
    let db_fg: Option<String> = conn
        .query_row(
            "SELECT v FROM app_settings WHERE k='foreground_path'",
            [],
            |r| r.get(0),
        )
        .ok();

    let resolved_fg: Option<PathBuf> = if let Some(ref p) = fg_path {
        Some(p.clone())
    } else if let Some(s) = db_fg {
        let p = PathBuf::from(s.clone());
        if p.exists() {
            // verify not missing
            let st: Option<String> = conn.query_row(
                "SELECT status FROM db_registry WHERE path=?1 COLLATE NOCASE",
                rusqlite::params![s],
                |r| r.get(0),
            ).ok();
            if st.as_deref() == Some("missing") { None } else { Some(p) }
        } else {
            None
        }
    } else {
        None
    };

    let fetch_row = |path: &Path| -> Option<RegistryRow> {
        let c = Connection::open(&default_db).ok()?;
        let mut stmt = c
            .prepare("SELECT id, path, alias, remark, status, created_at, last_opened_at, dim_count, module_count, favorite_count FROM db_registry WHERE path=?1 COLLATE NOCASE")
            .ok()?;
        stmt.query_row(rusqlite::params![path.to_string_lossy().to_string()], |r| row_from_sql(r))
            .ok()
    };

    let foreground = resolved_fg.as_ref().and_then(|p| fetch_row(p));
    let mut resident = Vec::new();
    let mut seen_lower: std::collections::HashSet<String> = std::collections::HashSet::new();
    if let Some(ref fg) = foreground {
        seen_lower.insert(fg.path.to_ascii_lowercase());
    }
    for p in &resident_paths {
        let lower = p.to_string_lossy().to_ascii_lowercase();
        if !seen_lower.insert(lower.clone()) {
            continue;
        }
        if let Some(r) = fetch_row(p) {
            resident.push(r);
        }
    }
    // If DB has more available than resident, fill from DB
    if resident.len() < max_active.saturating_sub(if foreground.is_some() { 1 } else { 0 }) {
        if let Ok(all) = query_registry_rows(&default_db, Some("available")) {
            for r in all {
                let lower = r.path.to_ascii_lowercase();
                if !seen_lower.insert(lower.clone()) {
                    continue;
                }
                if resident.len() >= max_active.saturating_sub(if foreground.is_some() { 1 } else { 0 }) {
                    break;
                }
                resident.push(r);
            }
        }
    }

    Ok(ActiveInfo {
        foreground,
        resident,
        max_active,
    })
}

#[tauri::command]
pub fn db_list_registry(app: AppHandle) -> Result<Vec<RegistryRow>, String> {
    let state = app.state::<AppState>();
    query_registry_rows(&state.default_db, None)
}

#[tauri::command]
pub fn db_set_max_active(app: AppHandle, max_active: usize) -> Result<(), String> {
    let max = max_active.clamp(1, 5);
    let state = app.state::<AppState>();
    *state.max_active.lock().map_err(|e| e.to_string())? = max;
    let mconn = Connection::open(&state.default_db).map_err(|e| e.to_string())?;
    mconn
        .execute(
            "INSERT OR REPLACE INTO app_settings(k,v) VALUES ('max_active', ?1)",
            rusqlite::params![max.to_string()],
        )
        .map_err(|e| e.to_string())?;
    let mut resident = state.resident.lock().map_err(|e| e.to_string())?;
    // dedup by lower
    {
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        resident.retain(|p| seen.insert(p.to_string_lossy().to_ascii_lowercase()));
    }
    while resident.len() > max.saturating_sub(1) {
        resident.pop_back();
    }
    Ok(())
}

#[tauri::command]
pub fn db_set_temp_carry(app: AppHandle, payload_json: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = Connection::open(&state.default_db).map_err(|e| e.to_string())?;
    let ts = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT OR REPLACE INTO temp_carry(id, payload_json, updated_at) VALUES ('carry_v1', ?1, ?2)",
        rusqlite::params![payload_json, ts],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_get_temp_carry(app: AppHandle) -> Result<TempCarryResult, String> {
    let state = app.state::<AppState>();
    let conn = Connection::open(&state.default_db).map_err(|e| e.to_string())?;
    let v: Option<String> = conn
        .query_row(
            "SELECT payload_json FROM temp_carry WHERE id='carry_v1'",
            [],
            |r| r.get(0),
        )
        .ok();
    if v.is_some() {
        let _ = conn.execute("DELETE FROM temp_carry WHERE id='carry_v1'", []);
    }
    Ok(TempCarryResult {
        payload_json: v,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TempCarryResult {
    pub payload_json: Option<String>,
}

// ------------------------------------------------------------------
// Auto-migrate first business
// ------------------------------------------------------------------

pub fn should_auto_migrate_first_business(
    default_db: &Path,
    app: &AppHandle,
) -> Option<(PathBuf, PathBuf)> {
    let count: i64 = Connection::open(default_db)
        .ok()
        .and_then(|c| {
            c.query_row("SELECT COUNT(*) FROM db_registry", [], |r| r.get(0))
                .ok()
        })
        .unwrap_or(1);
    if count != 0 {
        return None;
    }
    let data_dir = super::migration::data_dir_for(app).ok()?;
    let pmf = data_dir.join("pmf.db");
    if !pmf.exists() {
        return None;
    }
    let target = data_dir.join("PromptDataBase.db");
    if target.exists() {
        return None;
    }
    Some((pmf, target))
}

fn unique_alias_for(default_db: &Path, base: &str) -> Result<String, String> {
    let mconn = Connection::open(default_db).map_err(|e| e.to_string())?;
    let mut alias = base.to_string();
    let mut n = 1;
    loop {
        let exists: i64 = mconn
            .query_row(
                "SELECT COUNT(*) FROM db_registry WHERE alias=?1 COLLATE NOCASE",
                rusqlite::params![alias],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if exists == 0 {
            break;
        }
        n += 1;
        alias = format!("{} ({})", base, n);
    }
    Ok(alias)
}

pub fn auto_migrate_first_business(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let default_db = state.default_db.clone();
    let (src, dst) = match should_auto_migrate_first_business(&default_db, app) {
        Some(v) => v,
        None => return Ok(()),
    };
    let migrate_res = super::migration::migrate_legacy_db(&src, &dst).or_else(|_| {
        std::fs::copy(&src, &dst)
            .map(|_| ())
            .map_err(|e| format!("copy 失败: {}", e))
    });
    if let Err(e) = migrate_res {
        let _ = std::fs::remove_file(&dst);
        return Err(e);
    }
    if let Err(e) = super::business::ensure_business_compatible(&dst) {
        eprintln!("[pmf] auto_migrate ensure_business_compatible failed: {}", e);
        return Ok(());
    }
    let alias = unique_alias_for(&default_db, "PromptDataBase")?;
    let id = uuid::Uuid::new_v4().to_string();
    let ts = chrono::Utc::now().timestamp();
    let mconn = Connection::open(&default_db).map_err(|e| e.to_string())?;
    // atomic insert with transaction
    mconn.execute("BEGIN IMMEDIATE", []).map_err(|e| e.to_string())?;
    let res: Result<(), String> = (|| {
        let exists: i64 = mconn.query_row(
            "SELECT COUNT(*) FROM db_registry WHERE path=?1 COLLATE NOCASE",
            rusqlite::params![dst.to_string_lossy().to_string()],
            |r| r.get(0),
        ).map_err(|e| e.to_string())?;
        if exists > 0 {
            return Err("该路径已注册".to_string());
        }
        mconn.execute(
            "INSERT INTO db_registry(id, path, alias, remark, status, created_at, last_opened_at, dim_count, module_count, favorite_count) VALUES (?1, ?2, ?3, NULL, 'available', ?4, ?5, 0, 0, 0)",
            rusqlite::params![id, dst.to_string_lossy().to_string(), alias, ts, ts],
        ).map_err(|e| e.to_string())?;
        mconn.execute(
            "INSERT OR REPLACE INTO app_settings(k,v) VALUES ('foreground_path', ?1)",
            rusqlite::params![dst.to_string_lossy().to_string()],
        ).map_err(|e| e.to_string())?;
        Ok(())
    })();
    match res {
        Ok(()) => {
            mconn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            let _ = refresh_registry_counts(&default_db, &dst);
            // sync AppState
            if let Ok(mut fg) = state.foreground.lock() { *fg = Some(dst.clone()); }
            eprintln!(
                "[pmf] 首个业务库已自动迁移: {} → {} (alias={})",
                src.display(), dst.display(), alias
            );
            Ok(())
        }
        Err(e) => {
            let _ = mconn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn unique_temp_dir(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("pmf_meta_test_{}_{}", tag, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn init_default_db_creates_three_tables() {
        let dir = unique_temp_dir("init");
        let db = dir.join("Default.db");
        init_default_db(&db).unwrap();
        let conn = Connection::open(&db).unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('db_registry','app_settings','temp_carry')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 3);
        let max: String = conn
            .query_row("SELECT v FROM app_settings WHERE k='max_active'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(max, "2");
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn init_default_db_idempotent() {
        let dir = unique_temp_dir("idem");
        let db = dir.join("Default.db");
        init_default_db(&db).unwrap();
        let conn = Connection::open(&db).unwrap();
        conn.execute(
            "INSERT INTO db_registry(id, path, alias, status, created_at) VALUES ('id1','/tmp/a.db','aliasA','available',1)",
            [],
        )
        .unwrap();
        drop(conn);
        init_default_db(&db).unwrap();
        let conn2 = Connection::open(&db).unwrap();
        let c: i64 = conn2
            .query_row("SELECT COUNT(*) FROM db_registry", [], |r| r.get(0))
            .unwrap();
        assert_eq!(c, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_state_from_meta_empty() {
        let dir = unique_temp_dir("load_empty");
        let db = dir.join("Default.db");
        init_default_db(&db).unwrap();
        let (fg, max, resident) = load_state_from_meta(&db).unwrap();
        assert!(fg.is_none());
        assert_eq!(max, 2);
        assert!(resident.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn temp_carry_one_shot() {
        let dir = unique_temp_dir("carry");
        let db = dir.join("Default.db");
        init_default_db(&db).unwrap();
        let conn = Connection::open(&db).unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO temp_carry(id, payload_json, updated_at) VALUES ('carry_v1','{\"a\":1}',1)",
            [],
        )
        .unwrap();
        drop(conn);
        let conn2 = Connection::open(&db).unwrap();
        let v: Option<String> = conn2
            .query_row("SELECT payload_json FROM temp_carry WHERE id='carry_v1'", [], |r| r.get(0))
            .ok();
        assert_eq!(v.as_deref(), Some("{\"a\":1}"));
        conn2.execute("DELETE FROM temp_carry WHERE id='carry_v1'", []).unwrap();
        let v2: Option<String> = conn2
            .query_row("SELECT payload_json FROM temp_carry WHERE id='carry_v1'", [], |r| r.get(0))
            .ok();
        assert!(v2.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
