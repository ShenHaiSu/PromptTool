use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::meta::{mark_registry_missing, refresh_registry_counts, AppState};

// ------------------------------------------------------------------
// Path helpers
// ------------------------------------------------------------------

fn lexical_normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            c => out.push(c.as_os_str()),
        }
    }
    out
}

pub fn normalize_business_path(input: &str, app: &AppHandle) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("业务库路径不能为空".to_string());
    }
    let raw = PathBuf::from(trimmed);
    // Compat: frontend historically used "data/PromptDataBase.db" while data_dir_for is already exe/data
    // so "data/xxx" joined would become exe/data/data/xxx — strip leading "data" component for relative inputs
    let raw_adjusted = if !raw.is_absolute() {
        let s = raw.to_string_lossy().replace('\\', "/");
        if s == "data" {
            PathBuf::from("")
        } else if s.starts_with("data/") {
            PathBuf::from(&s["data/".len()..])
        } else {
            raw
        }
    } else {
        raw
    };
    if raw_adjusted.as_os_str().is_empty() {
        return Err("业务库路径不能为空".to_string());
    }
    let abs = if raw_adjusted.is_absolute() {
        raw_adjusted
    } else {
        super::migration::data_dir_for(app)?.join(raw_adjusted)
    };
    let normalized = if abs.exists() {
        abs.canonicalize()
            .map_err(|e| format!("无法规范化路径 '{}': {}", abs.display(), e))?
    } else {
        // Prefer parent canonicalization to get real casing on Windows, fallback to lexical
        if let Some(parent) = abs.parent() {
            if parent.exists() {
                if let Ok(canon_parent) = parent.canonicalize() {
                    if let Some(file) = abs.file_name() {
                        let mut out = canon_parent;
                        out.push(file);
                        lexical_normalize(&out)
                    } else {
                        lexical_normalize(&abs)
                    }
                } else {
                    lexical_normalize(&abs)
                }
            } else {
                lexical_normalize(&abs)
            }
        } else {
            lexical_normalize(&abs)
        }
    };
    let ext_ok = normalized
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("db"))
        .unwrap_or(false);
    if !ext_ok {
        return Err("业务库文件必须以 .db 结尾".to_string());
    }
    Ok(normalized)
}

// ------------------------------------------------------------------
// Business compat check
// ------------------------------------------------------------------

pub fn ensure_business_compatible(path: &Path) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    let has_dim: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dimensions'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if has_dim == 0 {
        return Err("该 .db 不是本软件的提示词库（未找到 dimensions 表）".to_string());
    }
    super::migration::migrate_if_needed(&conn)?;
    Ok(())
}

fn is_path_registered(
    default_db: &Path,
    path: &Path,
    exclude: Option<&Path>,
) -> Result<bool, String> {
    let conn = Connection::open(default_db).map_err(|e| e.to_string())?;
    let path_str = path.to_string_lossy().to_string();
    let count: i64 = if let Some(ex) = exclude {
        conn.query_row(
            "SELECT COUNT(*) FROM db_registry WHERE path=?1 COLLATE NOCASE AND path<>?2 COLLATE NOCASE",
            rusqlite::params![path_str, ex.to_string_lossy().to_string()],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM db_registry WHERE path=?1 COLLATE NOCASE",
            rusqlite::params![path_str],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    };
    Ok(count > 0)
}

fn is_alias_taken(
    default_db: &Path,
    alias: &str,
    exclude_path: Option<&Path>,
) -> Result<bool, String> {
    let conn = Connection::open(default_db).map_err(|e| e.to_string())?;
    let count: i64 = if let Some(p) = exclude_path {
        conn.query_row(
            "SELECT COUNT(*) FROM db_registry WHERE alias=?1 COLLATE NOCASE AND path<>?2 COLLATE NOCASE",
            rusqlite::params![alias, p.to_string_lossy().to_string()],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM db_registry WHERE alias=?1 COLLATE NOCASE",
            rusqlite::params![alias],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    };
    Ok(count > 0)
}

fn query_registry_status(default_db: &Path, path: &Path) -> Result<Option<String>, String> {
    let conn = Connection::open(default_db).map_err(|e| e.to_string())?;
    let v: Option<String> = conn
        .query_row(
            "SELECT status FROM db_registry WHERE path=?1 COLLATE NOCASE",
            rusqlite::params![path.to_string_lossy().to_string()],
            |r| r.get(0),
        )
        .ok();
    Ok(v)
}

fn query_registry_alias_remark(
    default_db: &Path,
    path: &Path,
) -> Result<(String, Option<String>), String> {
    let conn = Connection::open(default_db).map_err(|e| e.to_string())?;
    let (alias, remark): (String, Option<String>) = conn
        .query_row(
            "SELECT alias, remark FROM db_registry WHERE path=?1 COLLATE NOCASE",
            rusqlite::params![path.to_string_lossy().to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok((alias, remark))
}

fn query_registry_full(
    default_db: &Path,
    path: &Path,
) -> Result<(String, String, Option<String>, String), String> {
    let conn = Connection::open(default_db).map_err(|e| e.to_string())?;
    let (id, alias, remark, status): (String, String, Option<String>, String) = conn
        .query_row(
            "SELECT id, alias, remark, status FROM db_registry WHERE path=?1 COLLATE NOCASE",
            rusqlite::params![path.to_string_lossy().to_string()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok((id, alias, remark, status))
}

fn count_path_refs(default_db: &Path, path: &Path) -> Result<i64, String> {
    let conn = Connection::open(default_db).map_err(|e| e.to_string())?;
    let c: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM db_registry WHERE path=?1 COLLATE NOCASE",
            rusqlite::params![path.to_string_lossy().to_string()],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(c)
}

fn create_business_file(path: &Path, app: &AppHandle, with_seed: bool) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    let is_new = {
        let c: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dimensions'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(1);
        c == 0
    };
    if is_new {
        conn.execute_batch(super::migration::schema_sql())
            .map_err(|e| e.to_string())?;
    }
    super::migration::migrate_if_needed(&conn)?;
    super::migration::ensure_dimensions(&conn)?;
    if with_seed {
        let _ = super::migration::import_sample_prompts(&conn, app);
        let _ = super::migration::mark_nsfw_modules(&conn);
        let _ = super::migration::disable_deprecated_gender(&conn);
    }
    // Ensure rules exist even without seed
    super::migration::seed_rules_if_empty(&conn)?;
    Ok(())
}

// ------------------------------------------------------------------
// Commands
// ------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateResult {
    pub exists: bool,
    pub valid: bool,
    pub message: String,
    pub normalized_path: String,
}

#[tauri::command]
pub fn db_validate_business(app: AppHandle, path: String) -> Result<ValidateResult, String> {
    let normalized = normalize_business_path(&path, &app)?;
    let exists = normalized.exists();
    if !exists {
        return Ok(ValidateResult {
            exists: false,
            valid: true,
            message: "待新建".to_string(),
            normalized_path: normalized.to_string_lossy().to_string(),
        });
    }
    ensure_business_compatible(&normalized)?;
    Ok(ValidateResult {
        exists: true,
        valid: true,
        message: "合法业务库".to_string(),
        normalized_path: normalized.to_string_lossy().to_string(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResult {
    pub normalized_path: String,
    pub alias: String,
}

#[tauri::command]
pub fn db_create_business(
    app: AppHandle,
    path: String,
    alias: String,
    remark: Option<String>,
    with_seed: bool,
) -> Result<CreateResult, String> {
    let normalized = normalize_business_path(&path, &app)?;
    let alias_trimmed = alias.trim().to_string();
    if alias_trimmed.is_empty() || alias_trimmed.len() > 32 {
        return Err("别名长度需为 1–32 个字符".to_string());
    }
    let remark_val = remark
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if let Some(r) = &remark_val {
        if r.len() > 200 {
            return Err("备注长度不能超过 200 个字符".to_string());
        }
    }

    let state = app.state::<AppState>();
    let default_db = state.default_db.clone();

    if is_path_registered(&default_db, &normalized, None)? {
        return Err("该路径已注册，请直接在列表中切换".to_string());
    }
    if is_alias_taken(&default_db, &alias_trimmed, None)? {
        return Err("别名已存在，请换一个名称".to_string());
    }

    if normalized.exists() {
        ensure_business_compatible(&normalized)?;
    } else {
        create_business_file(&normalized, &app, with_seed)?;
    }

    let id = uuid::Uuid::new_v4().to_string();
    let ts = chrono::Utc::now().timestamp();
    let mconn = Connection::open(&default_db).map_err(|e| e.to_string())?;
    // Atomic insert: BEGIN IMMEDIATE + re-check
    mconn.execute("BEGIN IMMEDIATE", []).map_err(|e| e.to_string())?;
    let tx_res: Result<(), String> = (|| {
        let cnt: i64 = mconn
            .query_row(
                "SELECT COUNT(*) FROM db_registry WHERE path=?1 COLLATE NOCASE",
                rusqlite::params![normalized.to_string_lossy().to_string()],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if cnt > 0 {
            return Err("该路径已注册，请直接在列表中切换".to_string());
        }
        let alias_cnt: i64 = mconn
            .query_row(
                "SELECT COUNT(*) FROM db_registry WHERE alias=?1 COLLATE NOCASE",
                rusqlite::params![alias_trimmed],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if alias_cnt > 0 {
            return Err("别名已存在，请换一个名称".to_string());
        }
        mconn.execute(
            "INSERT INTO db_registry(id, path, alias, remark, status, created_at, last_opened_at, dim_count, module_count, favorite_count) VALUES (?1, ?2, ?3, ?4, 'available', ?5, ?6, 0, 0, 0)",
            rusqlite::params![
                id,
                normalized.to_string_lossy().to_string(),
                alias_trimmed,
                remark_val,
                ts,
                ts
            ],
        )
        .map_err(|e| e.to_string())?;
        mconn.execute(
            "INSERT OR REPLACE INTO app_settings(k,v) VALUES ('foreground_path', ?1)",
            rusqlite::params![normalized.to_string_lossy().to_string()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })();
    match tx_res {
        Ok(()) => {
            mconn.execute("COMMIT", []).map_err(|e| e.to_string())?;
        }
        Err(e) => {
            let _ = mconn.execute("ROLLBACK", []);
            return Err(e);
        }
    }
    drop(mconn);
    let _ = refresh_registry_counts(&default_db, &normalized);

    {
        let old_fg = state.foreground.lock().map_err(|e| e.to_string())?.clone();
        *state.foreground.lock().map_err(|e| e.to_string())? = Some(normalized.clone());
        let max = *state.max_active.lock().map_err(|e| e.to_string())?;
        let mut resident = state.resident.lock().map_err(|e| e.to_string())?;
        if let Some(old) = old_fg {
            if old.to_string_lossy().to_ascii_lowercase() != normalized.to_string_lossy().to_ascii_lowercase() {
                resident.retain(|p| p.to_string_lossy().to_ascii_lowercase() != old.to_string_lossy().to_ascii_lowercase());
                resident.push_front(old);
            }
        }
        // dedup resident by lower
        {
            let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
            resident.retain(|p| seen.insert(p.to_string_lossy().to_ascii_lowercase()));
        }
        while resident.len() > max.saturating_sub(1) {
            resident.pop_back();
        }
        resident.retain(|p| p.exists());
    }

    Ok(CreateResult {
        normalized_path: normalized.to_string_lossy().to_string(),
        alias: alias_trimmed,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AliasCheck {
    pub available: bool,
    pub message: String,
}

#[tauri::command]
pub fn db_check_alias(app: AppHandle, alias: String) -> Result<AliasCheck, String> {
    let t = alias.trim().to_string();
    if t.is_empty() {
        return Ok(AliasCheck {
            available: false,
            message: "别名不能为空".to_string(),
        });
    }
    if t.len() > 32 {
        return Ok(AliasCheck {
            available: false,
            message: "别名长度不能超过 32".to_string(),
        });
    }
    let state = app.state::<AppState>();
    let taken = is_alias_taken(&state.default_db, &t, None)?;
    if taken {
        Ok(AliasCheck {
            available: false,
            message: "别名已存在".to_string(),
        })
    } else {
        Ok(AliasCheck {
            available: true,
            message: "可用".to_string(),
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchResult {
    pub normalized_path: String,
}

#[tauri::command]
pub fn db_switch_active(app: AppHandle, path: String) -> Result<SwitchResult, String> {
    let normalized = normalize_business_path(&path, &app)?;
    if !normalized.exists() {
        let state = app.state::<AppState>();
        let _ = mark_registry_missing(&state.default_db, &normalized);
        return Err(format!("文件不存在: {}", normalized.display()));
    }
    ensure_business_compatible(&normalized)?;
    let state = app.state::<AppState>();
    let default_db = state.default_db.clone();
    if let Some(status) = query_registry_status(&default_db, &normalized)? {
        if status == "missing" {
            return Err("该数据库已标记为 missing，请先修复路径或重建".to_string());
        }
    } else {
        return Err("该路径未注册，请先通过创建/关联完成注册".to_string());
    }
    let ts = chrono::Utc::now().timestamp();
    let mconn = Connection::open(&default_db).map_err(|e| e.to_string())?;
    mconn
        .execute(
            "UPDATE db_registry SET status='available', last_opened_at=?1 WHERE path=?2 COLLATE NOCASE",
            rusqlite::params![ts, normalized.to_string_lossy().to_string()],
        )
        .map_err(|e| e.to_string())?;
    mconn
        .execute(
            "INSERT OR REPLACE INTO app_settings(k,v) VALUES ('foreground_path', ?1)",
            rusqlite::params![normalized.to_string_lossy().to_string()],
        )
        .map_err(|e| e.to_string())?;
    drop(mconn);
    let _ = refresh_registry_counts(&default_db, &normalized);
    {
        let old_fg = state.foreground.lock().map_err(|e| e.to_string())?.clone();
        *state.foreground.lock().map_err(|e| e.to_string())? = Some(normalized.clone());
        let max = *state.max_active.lock().map_err(|e| e.to_string())?;
        let mut resident = state.resident.lock().map_err(|e| e.to_string())?;
        if let Some(old) = old_fg {
            if old.to_string_lossy().to_ascii_lowercase() != normalized.to_string_lossy().to_ascii_lowercase() {
                resident.retain(|p| p.to_string_lossy().to_ascii_lowercase() != old.to_string_lossy().to_ascii_lowercase());
                resident.push_front(old);
            }
        }
        {
            let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
            resident.retain(|p| seen.insert(p.to_string_lossy().to_ascii_lowercase()));
        }
        while resident.len() > max.saturating_sub(1) {
            resident.pop_back();
        }
        resident.retain(|p| p.exists());
    }
    Ok(SwitchResult {
        normalized_path: normalized.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn db_repair_path(
    app: AppHandle,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let old_norm = normalize_business_path(&old_path, &app)?;
    let new_norm = normalize_business_path(&new_path, &app)?;
    ensure_business_compatible(&new_norm)?;
    let state = app.state::<AppState>();
    let default_db = state.default_db.clone();
    if is_path_registered(&default_db, &new_norm, Some(&old_norm))? {
        return Err("该路径已被其他库注册".to_string());
    }
    // Lookup id for old_path
    let (old_id, _, _, _) = query_registry_full(&default_db, &old_norm)
        .map_err(|_| "原路径未找到对应注册记录".to_string())?;
    let ts = chrono::Utc::now().timestamp();
    let mconn = Connection::open(&default_db).map_err(|e| e.to_string())?;
    let changed = mconn
        .execute(
            "UPDATE db_registry SET path=?1, status='available', last_opened_at=?2 WHERE id=?3",
            rusqlite::params![
                new_norm.to_string_lossy().to_string(),
                ts,
                old_id
            ],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("原路径未找到对应注册记录".to_string());
    }
    let fg: Option<String> = mconn
        .query_row("SELECT v FROM app_settings WHERE k='foreground_path'", [], |r| r.get(0))
        .ok();
    if fg.as_deref().map(|s| s.to_ascii_lowercase()) == Some(old_norm.to_string_lossy().to_ascii_lowercase()) {
        mconn
            .execute(
                "INSERT OR REPLACE INTO app_settings(k,v) VALUES ('foreground_path', ?1)",
                rusqlite::params![new_norm.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
        *state.foreground.lock().map_err(|e| e.to_string())? = Some(new_norm.clone());
    } else if fg.as_deref().map(|s| s.to_ascii_lowercase()) == Some(new_norm.to_string_lossy().to_ascii_lowercase()) {
        // already foreground, keep
    }
    drop(mconn);
    let _ = refresh_registry_counts(&default_db, &new_norm);
    Ok(())
}

#[tauri::command]
pub fn db_rebuild_missing(
    app: AppHandle,
    path: String,
    with_seed: bool,
) -> Result<(), String> {
    let normalized = normalize_business_path(&path, &app)?;
    let state = app.state::<AppState>();
    let default_db = state.default_db.clone();
    let status = query_registry_status(&default_db, &normalized)?;
    if status.as_deref() != Some("missing") {
        return Err("该库未处于 missing 状态，无需重建".to_string());
    }
    if normalized.exists() {
        return Err("原路径已有文件，请先移除或改名".to_string());
    }
    let (alias, _remark) = query_registry_alias_remark(&default_db, &normalized)?;
    create_business_file(&normalized, &app, with_seed)?;
    let ts = chrono::Utc::now().timestamp();
    let mconn = Connection::open(&default_db).map_err(|e| e.to_string())?;
    mconn
        .execute(
            "UPDATE db_registry SET status='available', last_opened_at=?1 WHERE path=?2 COLLATE NOCASE",
            rusqlite::params![ts, normalized.to_string_lossy().to_string()],
        )
        .map_err(|e| e.to_string())?;
    drop(mconn);
    let _ = refresh_registry_counts(&default_db, &normalized);
    let _ = alias;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveResult {
    pub was_foreground: bool,
    pub next_foreground: Option<String>,
}

#[tauri::command]
pub fn db_remove_registry(app: AppHandle, path: String) -> Result<RemoveResult, String> {
    let normalized = normalize_business_path(&path, &app)?;
    let state = app.state::<AppState>();
    let default_db = state.default_db.clone();
    let (id, _alias, _remark, status) = query_registry_full(&default_db, &normalized)
        .map_err(|_| "该路径未注册".to_string())?;

    // Reference count check before deleting file
    let refs = count_path_refs(&default_db, &normalized).unwrap_or(1);
    let should_delete_file = status == "available" && normalized.exists() && refs <= 1;

    if should_delete_file {
        if let Ok(conn) = Connection::open(&normalized) {
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        }
        std::fs::remove_file(&normalized)
            .map_err(|e| format!("删除文件失败 '{}': {}", normalized.display(), e))?;
        let wal = {
            let s = normalized.to_string_lossy().to_string();
            PathBuf::from(format!("{}-wal", s))
        };
        let shm = PathBuf::from(format!("{}-shm", normalized.to_string_lossy()));
        let journal = PathBuf::from(format!("{}-journal", normalized.to_string_lossy()));
        let _ = std::fs::remove_file(wal);
        let _ = std::fs::remove_file(shm);
        let _ = std::fs::remove_file(journal);
        // Also try with_extension variants
        let _ = std::fs::remove_file(normalized.with_extension("db-wal"));
        let _ = std::fs::remove_file(normalized.with_extension("db-shm"));
    } else if status == "available" && normalized.exists() && refs > 1 {
        // Shared file — only unregister, keep file
        eprintln!("[pmf] remove_registry: path {} is shared by {} rows, keeping file", normalized.display(), refs);
    }
    let mconn = Connection::open(&default_db).map_err(|e| e.to_string())?;
    mconn
        .execute(
            "DELETE FROM db_registry WHERE id=?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
    let fg: Option<String> = mconn
        .query_row("SELECT v FROM app_settings WHERE k='foreground_path'", [], |r| r.get(0))
        .ok();
    let was_foreground = fg.as_deref().map(|s| s.to_ascii_lowercase()) == Some(normalized.to_string_lossy().to_ascii_lowercase());
    let next_foreground: Option<String> = if was_foreground {
        let mut stmt = mconn
            .prepare("SELECT path FROM db_registry WHERE status='available' COLLATE NOCASE ORDER BY last_opened_at DESC LIMIT 1")
            .map_err(|e| e.to_string())?;
        let next: Option<String> = stmt.query_row([], |r| r.get(0)).ok();
        if let Some(ref p) = next {
            mconn
                .execute(
                    "INSERT OR REPLACE INTO app_settings(k,v) VALUES ('foreground_path', ?1)",
                    rusqlite::params![p],
                )
                .map_err(|e| e.to_string())?;
            *state.foreground.lock().map_err(|e| e.to_string())? = Some(PathBuf::from(p));
        } else {
            mconn
                .execute("DELETE FROM app_settings WHERE k='foreground_path'", [])
                .map_err(|e| e.to_string())?;
            *state.foreground.lock().map_err(|e| e.to_string())? = None;
        }
        state
            .resident
            .lock()
            .map_err(|e| e.to_string())?
            .retain(|p| p.to_string_lossy().to_ascii_lowercase() != normalized.to_string_lossy().to_ascii_lowercase());
        next
    } else {
        state
            .resident
            .lock()
            .map_err(|e| e.to_string())?
            .retain(|p| p.to_string_lossy().to_ascii_lowercase() != normalized.to_string_lossy().to_ascii_lowercase());
        None
    };
    Ok(RemoveResult {
        was_foreground,
        next_foreground,
    })
}

#[tauri::command]
pub fn db_update_registry_meta(
    app: AppHandle,
    path: String,
    alias: Option<String>,
    remark: Option<String>,
) -> Result<(), String> {
    let normalized = normalize_business_path(&path, &app)?;
    let state = app.state::<AppState>();
    let default_db = state.default_db.clone();
    // Resolve id first
    let (id, _, _, _) = query_registry_full(&default_db, &normalized)
        .map_err(|_| "该路径未注册".to_string())?;
    if let Some(a) = &alias {
        let t = a.trim();
        if t.is_empty() || t.len() > 32 {
            return Err("别名长度需为 1–32".to_string());
        }
        if is_alias_taken(&default_db, t, Some(&normalized))? {
            return Err("别名已存在".to_string());
        }
    }
    let mconn = Connection::open(&default_db).map_err(|e| e.to_string())?;
    if let Some(a) = alias {
        let t = a.trim().to_string();
        mconn
            .execute(
                "UPDATE db_registry SET alias=?1 WHERE id=?2",
                rusqlite::params![t, id],
            )
            .map_err(|e| e.to_string())?;
    }
    if let Some(r) = remark {
        let v = if r.trim().is_empty() {
            None
        } else {
            if r.trim().len() > 200 {
                return Err("备注长度不能超过 200".to_string());
            }
            Some(r.trim().to_string())
        };
        mconn
            .execute(
                "UPDATE db_registry SET remark=?1 WHERE id=?2",
                rusqlite::params![v, id],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lexical_normalize_cleans() {
        let p = PathBuf::from("a/./b/../c//d.db");
        let n = lexical_normalize(&p);
        assert_eq!(n, PathBuf::from("a/c/d.db"));
    }
}
