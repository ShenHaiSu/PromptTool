 use std::collections::VecDeque;
 use std::path::{Path, PathBuf};
 use std::sync::Mutex;
 use chrono::TimeZone;
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
// ------------------------------------------------------------------
// need07: path_schema v2 无感迁移（只洗字符串，不搬文件）
// ------------------------------------------------------------------

/// 注册表路径洗白 v1→v2：脱壳 `\\?\`、盘符大写、按 `norm_key` 去重、补前台。
/// 返回 `(washed, deduped)`；幂等（已 v2 直接 `Ok((0,0))`）。
/// 全程单事务，失败 `ROLLBACK` + 保留 `.bak`，调用方记日志继续启动（不断服）。
pub fn migrate_path_schema_v2(default_db: &Path) -> Result<(i64, i64), String> {
    use super::path_resolve::{canonical_stripped, display_path, norm_key, strip_verbatim};
    let conn = Connection::open(default_db).map_err(|e| e.to_string())?;
    let version: Option<String> = conn
        .query_row(
            "SELECT v FROM app_settings WHERE k='path_schema_version'",
            [],
            |r| r.get(0),
        )
        .ok();
    if version.as_deref() == Some("2") {
        return Ok((0, 0));
    }
    // 1. 备份（失败则中止迁移、原库照常启动）
    let ts = chrono::Utc::now().timestamp();
    let bak = PathBuf::from(format!("{}.bak-{}", default_db.display(), ts));
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    std::fs::copy(default_db, &bak)
        .map_err(|e| format!("迁移备份失败 '{}': {}", bak.display(), e))?;
    // 2. 事务内逐行 wash
    conn.execute("BEGIN IMMEDIATE", []).map_err(|e| e.to_string())?;
    let work: Result<(i64, i64), String> = (|| {
        let mut stmt = conn
            .prepare("SELECT id, path, last_opened_at, dim_count, module_count, favorite_count FROM db_registry")
            .map_err(|e| e.to_string())?;
        let rows: Vec<(String, String, Option<i64>, i64, i64, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);
        // wash：存在则 canonical+脱壳，不存在则词法脱壳；盘符大写
        let wash = |raw: &str| -> String {
            let p = PathBuf::from(raw.trim());
            match canonical_stripped(&p) {
                Ok(v) => display_path(&v),
                Err(_) => display_path(&strip_verbatim(&p)),
            }
        };
        // 按 norm_key 分组
        let mut groups: std::collections::HashMap<String, Vec<(String, String, Option<i64>, i64, i64, i64)>> =
            std::collections::HashMap::new();
        for r in &rows {
            let washed = wash(&r.1);
            groups.entry(norm_key(Path::new(&washed))).or_default().push((
                r.0.clone(),
                washed,
                r.2,
                r.3,
                r.4,
                r.5,
            ));
        }
        let mut washed: i64 = 0;
        let mut deduped: i64 = 0;
        for members in groups.values() {
            if members.len() > 1 {
                // 保留 last_opened_at 最大者（无则 id 最小者），计数取最大者
                let mut sorted = members.clone();
                sorted.sort_by(|a, b| b.2.unwrap_or(-1).cmp(&a.2.unwrap_or(-1)).then(a.0.cmp(&b.0)));
                let keep = &sorted[0];
                let (max_dim, max_mod, max_fav) = sorted.iter().fold((0i64, 0i64, 0i64), |acc, m| {
                    (acc.0.max(m.3), acc.1.max(m.4), acc.2.max(m.5))
                });
                conn.execute(
                    "UPDATE db_registry SET path=?1, dim_count=?2, module_count=?3, favorite_count=?4 WHERE id=?5",
                    rusqlite::params![keep.1, max_dim, max_mod, max_fav, keep.0],
                )
                .map_err(|e| e.to_string())?;
                washed += 1;
                for m in sorted.iter().skip(1) {
                    conn.execute("DELETE FROM db_registry WHERE id=?1", rusqlite::params![m.0])
                        .map_err(|e| e.to_string())?;
                    deduped += 1;
                }
            } else {
                let m = &members[0];
                let orig = rows.iter().find(|r| r.0 == m.0).map(|r| r.1.clone()).unwrap_or_default();
                if m.1 != orig {
                    conn.execute("UPDATE db_registry SET path=?1 WHERE id=?2", rusqlite::params![m.1, m.0])
                        .map_err(|e| e.to_string())?;
                    washed += 1;
                }
            }
        }
        // 前台 wash；无对应行且文件存在 → 自动补注册；不存在 → 保留不清空
        let fg: Option<String> = conn
            .query_row("SELECT v FROM app_settings WHERE k='foreground_path'", [], |r| r.get(0))
            .ok();
        if let Some(f) = fg {
            let wf = wash(&f);
            if wf != f {
                conn.execute(
                    "INSERT OR REPLACE INTO app_settings(k,v) VALUES ('foreground_path', ?1)",
                    rusqlite::params![wf],
                )
                .map_err(|e| e.to_string())?;
                washed += 1;
            }
            let cnt: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM db_registry WHERE path=?1 COLLATE NOCASE",
                    rusqlite::params![wf],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if cnt == 0 {
                if PathBuf::from(&wf).exists() {
                    let stem = Path::new(&wf)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("Imported");
                    let mut alias = stem.to_string();
                    let mut n = 1;
                    loop {
                        let c: i64 = conn
                            .query_row(
                                "SELECT COUNT(*) FROM db_registry WHERE alias=?1 COLLATE NOCASE",
                                rusqlite::params![alias],
                                |r| r.get(0),
                            )
                            .unwrap_or(1);
                        if c == 0 {
                            break;
                        }
                        n += 1;
                        alias = format!("{}-{}", stem, n);
                    }
                    let now = chrono::Utc::now().timestamp();
                    conn.execute(
                        "INSERT INTO db_registry(id, path, alias, remark, status, created_at, last_opened_at, dim_count, module_count, favorite_count) VALUES (?1, ?2, ?3, NULL, 'available', ?4, ?5, 0, 0, 0)",
                        rusqlite::params![uuid::Uuid::new_v4().to_string(), wf, alias, now, now],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
        conn.execute(
            "INSERT OR REPLACE INTO app_settings(k,v) VALUES ('path_schema_version', '2')",
            [],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO app_settings(k,v) VALUES ('path_migrate_washed', ?1)",
            rusqlite::params![washed.to_string()],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO app_settings(k,v) VALUES ('path_migrate_deduped', ?1)",
            rusqlite::params![deduped.to_string()],
        )
        .map_err(|e| e.to_string())?;
        Ok((washed, deduped))
    })();
    match work {
        Ok((w, d)) => {
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            let _ = refresh_missing_status(default_db);
            eprintln!("[pmf] path-migrate v1→v2 washed={} deduped={}", w, d);
            Ok((w, d))
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(format!("{}（已回滚，可用 {}.bak-* 恢复）", e, default_db.display()))
        }
    }
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
            let p = super::path_resolve::strip_verbatim(std::path::Path::new(s.trim()));
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
           .map(|p| super::path_resolve::norm_key(p))
            .unwrap_or_default();
        let limit = (max_active as i64) - if fg_path.is_some() { 1 } else { 0 };
        if limit > 0 {
            if let Ok(mut stmt) = conn.prepare(
                "SELECT path FROM db_registry WHERE status='available' ORDER BY last_opened_at DESC LIMIT ?1",
            ) {
                if let Ok(rows) = stmt.query_map(rusqlite::params![limit], |r| r.get::<_, String>(0)) {
                    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
                    for r in rows.flatten() {
                       let lower = super::path_resolve::norm_key(std::path::Path::new(&r));
                        if lower == fg_lower {
                            continue;
                        }
                        if !seen.insert(lower.clone()) {
                            continue;
                        }
                        let p = PathBuf::from(&r);
                       if p.exists() && fg_path.as_ref().map(|fp| super::path_resolve::norm_key(fp) != lower).unwrap_or(true) {
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
    // need07 读侧再脱壳一次：防手工改库/旧备份恢复带 \\?\ 前缀
    let raw: String = r.get(1)?;
    let clean = super::path_resolve::display_path(std::path::Path::new(&raw));
    Ok(RegistryRow {
        id: r.get(0)?,
        path: clean,
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
       seen_lower.insert(super::path_resolve::norm_key(std::path::Path::new(&fg.path)));
    }
    for p in &resident_paths {
       let lower = super::path_resolve::norm_key(p);
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
               let lower = super::path_resolve::norm_key(std::path::Path::new(&r.path));
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
       resident.retain(|p| seen.insert(super::path_resolve::norm_key(p)));
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
 // need01 需求3：生成统计 ledger（主库持久化，跨业务库）
 // ------------------------------------------------------------------

 #[derive(Debug, Clone)]
 pub struct LedgerEntry {
     pub id: String,
     pub task_id: String,
     pub source: String,
     pub status: String,
     pub elapsed_ms: i64,
     pub size: String,
     pub ratio: String,
     pub pixels: i64,
     pub filename: Option<String>,
     pub prompt_hash: Option<String>,
     pub created_at: i64,
     pub finished_at: i64,
 }

 pub const LEDGER_DDL: &str = "CREATE TABLE IF NOT EXISTS generation_ledger (id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, source TEXT NOT NULL DEFAULT 'queue' CHECK (source IN ('queue','single')), status TEXT NOT NULL CHECK (status IN ('succeeded','failed','cancelled')), elapsed_ms INTEGER NOT NULL DEFAULT 0, size TEXT NOT NULL DEFAULT '1K', ratio TEXT NOT NULL DEFAULT '1:1', pixels INTEGER NOT NULL DEFAULT 0, filename TEXT, prompt_hash TEXT, created_at INTEGER NOT NULL, finished_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS idx_ledger_finished ON generation_ledger(finished_at); CREATE INDEX IF NOT EXISTS idx_ledger_status ON generation_ledger(status); CREATE INDEX IF NOT EXISTS idx_ledger_source ON generation_ledger(source);";

 pub fn ensure_ledger_table(conn: &Connection) -> Result<(), String> {
     conn.execute_batch(LEDGER_DDL).map_err(|e| e.to_string())?;
     Ok(())
 }

 pub fn record_ledger(db_path: &Path, e: LedgerEntry) -> Result<(), String> {
     let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
     conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").map_err(|e| e.to_string())?;
     ensure_ledger_table(&conn)?;
     let source = if e.source == "single" { "single" } else { "queue" };
     let status = match e.status.as_str() {
         "succeeded" | "failed" | "cancelled" => e.status.as_str(),
         _ => return Err(format!("非法 ledger status：{}", e.status)),
     };
     conn.execute(
         "INSERT OR IGNORE INTO generation_ledger(id, task_id, source, status, elapsed_ms, size, ratio, pixels, filename, prompt_hash, created_at, finished_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
         rusqlite::params![e.id, e.task_id, source, status, e.elapsed_ms, e.size, e.ratio, e.pixels, e.filename, e.prompt_hash, e.created_at, e.finished_at],
     ).map_err(|e| e.to_string())?;
     Ok(())
 }

 fn parse_ymd(s: &str) -> Result<chrono::NaiveDate, String> {
     chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").map_err(|_| format!("日期格式须为 yyyy-MM-dd：{}", s))
 }

 fn day_start_ts(date: chrono::NaiveDate) -> i64 {
     date.and_hms_opt(0, 0, 0).map(|d| chrono::Local.from_local_datetime(&d).single().map(|l| l.timestamp()).unwrap_or(d.and_utc().timestamp())).unwrap_or(0)
 }

 #[derive(Debug, Serialize, Clone)]
 #[serde(rename_all = "camelCase")]
 pub struct LedgerSummary {
     pub total: i64,
     pub succeeded: i64,
     pub failed: i64,
     pub pixels: i64,
     pub avg_elapsed_ms: f64,
 }

 #[derive(Debug, Serialize, Clone)]
 #[serde(rename_all = "camelCase")]
 pub struct LedgerDailyRow {
     pub day: String,
     pub total: i64,
     pub succeeded: i64,
     pub pixels: i64,
 }

 #[derive(Debug, Serialize, Clone)]
 #[serde(rename_all = "camelCase")]
 pub struct LedgerHourlyRow {
     pub hour: i64,
     pub total: i64,
     pub succeeded: i64,
     pub pixels: i64,
 }

 fn open_meta_ledger(app: &AppHandle) -> Result<Connection, String> {
     let state = app.state::<AppState>();
     let conn = Connection::open(&state.default_db).map_err(|e| e.to_string())?;
     conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").map_err(|e| e.to_string())?;
     ensure_ledger_table(&conn)?;
     Ok(conn)
 }

 #[tauri::command]
 pub fn stats_ledger_summary(app: AppHandle, from: String, to: String) -> Result<LedgerSummary, String> {
     let conn = open_meta_ledger(&app)?;
     let d_from = parse_ymd(&from)?;
     let d_to = parse_ymd(&to)?;
     let start = day_start_ts(d_from);
     let end = day_start_ts(d_to) + 86400;
     let (total, succeeded, failed, pixels): (i64, i64, i64, Option<i64>) = conn.query_row(
         "SELECT COUNT(*), SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END), SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END), SUM(pixels) FROM generation_ledger WHERE finished_at >= ?1 AND finished_at < ?2",
         rusqlite::params![start, end],
         |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
     ).map_err(|e| e.to_string())?;
     let avg: Option<f64> = conn.query_row(
         "SELECT AVG(elapsed_ms) FROM generation_ledger WHERE finished_at >= ?1 AND finished_at < ?2 AND status='succeeded'",
         rusqlite::params![start, end],
         |r| r.get(0),
     ).map_err(|e| e.to_string())?;
     Ok(LedgerSummary { total, succeeded, failed, pixels: pixels.unwrap_or(0), avg_elapsed_ms: avg.unwrap_or(0.0) })
 }

 #[tauri::command]
 pub fn stats_ledger_daily(app: AppHandle, from: String, to: String) -> Result<Vec<LedgerDailyRow>, String> {
     let conn = open_meta_ledger(&app)?;
     let d_from = parse_ymd(&from)?;
     let d_to = parse_ymd(&to)?;
     let start = day_start_ts(d_from);
     let end = day_start_ts(d_to) + 86400;
     let mut map: std::collections::HashMap<String, (i64, i64, i64)> = std::collections::HashMap::new();
     {
         let mut stmt = conn.prepare(
             "SELECT date(finished_at, 'unixepoch', 'localtime') AS d, COUNT(*), SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END), SUM(pixels) FROM generation_ledger WHERE finished_at >= ?1 AND finished_at < ?2 GROUP BY d",
         ).map_err(|e| e.to_string())?;
         let rows = stmt.query_map(rusqlite::params![start, end], |r| {
             let d: String = r.get(0)?;
             let c: i64 = r.get(1)?;
             let s: i64 = r.get(2)?;
             let p: Option<i64> = r.get(3)?;
             Ok((d, c, s, p.unwrap_or(0)))
         }).map_err(|e| e.to_string())?;
         for r in rows { let (d, c, s, p) = r.map_err(|e| e.to_string())?; map.insert(d, (c, s, p)); }
     }
     let mut out = Vec::new();
     let mut cur = d_from;
     let mut guard = 0;
     while cur <= d_to && guard < 366 {
         let key = cur.format("%Y-%m-%d").to_string();
         let (t, s, p) = map.get(&key).cloned().unwrap_or((0, 0, 0));
         out.push(LedgerDailyRow { day: key, total: t, succeeded: s, pixels: p });
         cur = cur.succ_opt().unwrap_or(cur);
         guard += 1;
     }
     Ok(out)
 }

 #[tauri::command]
 pub fn stats_ledger_hourly(app: AppHandle, day: String) -> Result<Vec<LedgerHourlyRow>, String> {
     let conn = open_meta_ledger(&app)?;
     let d = parse_ymd(&day)?;
     let start = day_start_ts(d);
     let end = start + 86400;
     let mut buckets = vec![(0i64, 0i64, 0i64); 24];
     {
         let mut stmt = conn.prepare(
             "SELECT CAST(strftime('%H', finished_at, 'unixepoch', 'localtime') AS INTEGER) AS h, COUNT(*), SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END), SUM(pixels) FROM generation_ledger WHERE finished_at >= ?1 AND finished_at < ?2 GROUP BY h",
         ).map_err(|e| e.to_string())?;
         let rows = stmt.query_map(rusqlite::params![start, end], |r| {
             let h: i64 = r.get(0)?;
             let c: i64 = r.get(1)?;
             let s: i64 = r.get(2)?;
             let p: Option<i64> = r.get(3)?;
             Ok((h, c, s, p.unwrap_or(0)))
         }).map_err(|e| e.to_string())?;
         for r in rows {
             let (h, c, s, p) = r.map_err(|e| e.to_string())?;
             if (0..24).contains(&h) { buckets[h as usize] = (c, s, p); }
         }
     }
     Ok(buckets.into_iter().enumerate().map(|(h, (t, s, p))| LedgerHourlyRow { hour: h as i64, total: t, succeeded: s, pixels: p }).collect())
 }
 
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

    #[test]
    fn b8_migrate_washes_verbatim_and_dedupes() {
        // fixture：真实文件 a.db（\\?\ + 普通重复行）+ 不存在的 b.db + 前台
        // 期望 washed=3（行1/行3/前台）deduped=1（保留 last_opened 最大者 B），重跑幂等
        let dir = unique_temp_dir("migv2");
        let db = dir.join("Default.db");
        init_default_db(&db).unwrap();
        let real_a = dir.join("a.db");
        std::fs::write(&real_a, b"fake-db").unwrap();
        let verb_a = format!(r"\\?\{}", real_a.display());
        let real_b = dir.join("b.db"); // 不建文件，测词法脱壳分支
        let verb_b = format!(r"\\?\{}", real_b.display());
        let conn = Connection::open(&db).unwrap();
        conn.execute(
            "INSERT INTO db_registry(id, path, alias, status, created_at, last_opened_at) VALUES ('id1',?1,'A','available',1,10)",
            rusqlite::params![verb_a],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO db_registry(id, path, alias, status, created_at, last_opened_at) VALUES ('id2',?1,'B','available',1,20)",
            rusqlite::params![real_a.to_string_lossy().to_string()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO db_registry(id, path, alias, status, created_at, last_opened_at) VALUES ('id3',?1,'C','available',1,5)",
            rusqlite::params![verb_b],
        )
        .unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO app_settings(k,v) VALUES ('foreground_path', ?1)",
            rusqlite::params![verb_a],
        )
        .unwrap();
        drop(conn);
        let (w, d) = migrate_path_schema_v2(&db).unwrap();
        assert_eq!((w, d), (3, 1), "washed=行2+前台1，deduped=重复1");
        let conn2 = Connection::open(&db).unwrap();
        let paths: Vec<String> = {
            let mut s = conn2.prepare("SELECT path FROM db_registry ORDER BY alias").unwrap();
            s.query_map([], |r| r.get(0)).unwrap().collect::<Result<Vec<_>, _>>().unwrap()
        };
        assert_eq!(paths.len(), 2);
        assert!(paths.iter().all(|p| !p.contains(r"\\?\")));
        // 去重保留 last_opened_at 最大者（id2/B）；canonicalize 可能还原 8.3 短路径，
        // 故按别名查行，再断言路径干净且文件存在
        let kept_path: String = conn2
            .query_row("SELECT path FROM db_registry WHERE alias='B'", [], |r| r.get(0))
            .unwrap();
        assert!(!kept_path.contains(r"\\?\"));
        assert!(std::path::Path::new(&kept_path).exists());
        let fg: String = conn2
            .query_row("SELECT v FROM app_settings WHERE k='foreground_path'", [], |r| r.get(0))
            .unwrap();
        assert!(!fg.contains(r"\\?\"));
        let ver: String = conn2
            .query_row("SELECT v FROM app_settings WHERE k='path_schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, "2");
        drop(conn2);
        // 幂等重跑
        let (w2, d2) = migrate_path_schema_v2(&db).unwrap();
        assert_eq!((w2, d2), (0, 0));
        // .bak 存在
        let bak_exists = std::fs::read_dir(&dir).unwrap().any(|e| {
            e.map(|x| x.file_name().to_string_lossy().contains(".bak-")).unwrap_or(false)
        });
        assert!(bak_exists);
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&dir);
    }

     #[test]
     fn b9_migrate_failure_keeps_db_and_bak() {
         // 失败注入：缺 db_registry 表 → SELECT 失败 → Err，且原库不动、有 .bak
         let dir = unique_temp_dir("migfail");
         let db = dir.join("Default.db");
         let conn = Connection::open(&db).unwrap();
         conn.execute_batch("CREATE TABLE app_settings(k TEXT PRIMARY KEY, v TEXT NOT NULL);").unwrap();
         conn.execute("INSERT INTO app_settings(k,v) VALUES ('max_active','2')", []).unwrap();
         drop(conn);
         let before = std::fs::read(&db).unwrap();
         let res = migrate_path_schema_v2(&db);
         assert!(res.is_err(), "缺表应迁移失败");
         let after = std::fs::read(&db).unwrap();
         assert_eq!(before, after, "原库必须 unchanged");
         let bak_exists = std::fs::read_dir(&dir).unwrap().any(|e| {
             e.map(|x| x.file_name().to_string_lossy().contains(".bak-")).unwrap_or(false)
         });
         assert!(bak_exists);
         let _ = std::fs::remove_dir_all(&dir);
     }
     #[test]
     fn ledger_table_created_and_insert_ignore() {
         // 需求3：主库 ledger 建表幂等 + INSERT OR IGNORE 防重试 double-count。
         let dir = unique_temp_dir("ledger");
         let db = dir.join("Default.db");
         init_default_db(&db).unwrap();
         let conn = Connection::open(&db).unwrap();
         let n: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='generation_ledger'", [], |r| r.get(0)).unwrap();
         assert_eq!(n, 1);
         drop(conn);
         let mk = |task_id: &str| LedgerEntry {
             id: uuid::Uuid::new_v4().to_string(), task_id: task_id.to_string(), source: "queue".to_string(),
             status: "succeeded".to_string(), elapsed_ms: 1200, size: "1K".to_string(), ratio: "1:1".to_string(),
             pixels: 1048576, filename: Some("a.png".to_string()), prompt_hash: Some("abcd1234".to_string()),
             created_at: 1_758_000_000, finished_at: 1_758_000_100,
         };
         record_ledger(&db, mk("task-1")).unwrap();
         // 同 task_id 重复记账被 IGNORE（仍 1 行）。
         record_ledger(&db, mk("task-1")).unwrap();
         record_ledger(&db, LedgerEntry { task_id: "single:xxx".to_string(), source: "single".to_string(), status: "succeeded".to_string(), ..mk("single:xxx") }).unwrap();
         let conn2 = Connection::open(&db).unwrap();
         let c: i64 = conn2.query_row("SELECT COUNT(*) FROM generation_ledger", [], |r| r.get(0)).unwrap();
         assert_eq!(c, 2);
         let px: i64 = conn2.query_row("SELECT SUM(pixels) FROM generation_ledger", [], |r| r.get(0)).unwrap();
         assert_eq!(px, 2097152);
         let _ = std::fs::remove_dir_all(&dir);
     }
     #[test]
     fn ledger_rejects_bad_status() {
         let dir = unique_temp_dir("ledger_bad");
         let db = dir.join("Default.db");
         init_default_db(&db).unwrap();
         let e = LedgerEntry {
             id: "x".to_string(), task_id: "t".to_string(), source: "queue".to_string(), status: "bogus".to_string(),
             elapsed_ms: 0, size: "1K".to_string(), ratio: "1:1".to_string(), pixels: 0, filename: None,
             prompt_hash: None, created_at: 1, finished_at: 2,
         };
         assert!(record_ledger(&db, e).is_err());
         let _ = std::fs::remove_dir_all(&dir);
     }
 }
