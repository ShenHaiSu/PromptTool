use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

// ------------------------------------------------------------------
// Helpers — data dir / default export dir
// ------------------------------------------------------------------

/// 默认导出目录：need07 新语义——空配置走 Documents/…/exports，
/// 老默认 data/output 有文件则保留（resolve_export_dir 内部决策）。
pub fn default_export_dir_for(app: &AppHandle) -> Result<PathBuf, String> {
    super::path_resolve::resolve_export_dir(app, "")
}

#[allow(dead_code)]
fn lexical_normalize(p: &Path) -> PathBuf {
    // need07 T13: 收敛为中枢调用，留一行转发避免行为漂移
    super::path_resolve::lexical_normalize(p)
}

/// 归一导出目录（need07）：
/// - 去首尾空白；空串 → 新/老默认决策（resolve_export_dir）
/// - 相对路径视作相对 active data_dir 拼接；绝对先脱壳
/// - 末端经 canonical_stripped，永不返回 \\?\ 前缀
fn normalize_export_dir(input: &str, app: &AppHandle) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return default_export_dir_for(app);
    }
    let raw = super::path_resolve::strip_verbatim(Path::new(trimmed));
    if !raw.is_absolute() {
        let s = raw.to_string_lossy().replace('\\', "/");
        let rel = if s == "data" {
            PathBuf::from("")
        } else if let Some(st) = s.strip_prefix("data/") {
            PathBuf::from(st)
        } else {
            raw
        };
        if rel.as_os_str().is_empty() {
            return default_export_dir_for(app);
        }
        let base = super::path_resolve::resolve_data_dir(app)
            .map(|r| PathBuf::from(r.active))
            .unwrap_or(super::migration::data_dir_for(app)?);
        return super::path_resolve::canonical_stripped(&base.join(rel));
    }
    super::path_resolve::canonical_stripped(&raw)
}

fn format_local_filename() -> String {
    let now = chrono::Local::now();
    format!(
        "pmf-library-{:04}{:02}{:02}-{:02}{:02}{:02}.json",
        now.year(),
        now.month(),
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    )
}

// Use trait to avoid extra chrono import juggling; implement via Local
use chrono::Datelike;
use chrono::Timelike;

fn unique_filename_in(dir: &Path, stem: &str) -> PathBuf {
    // stem is full filename; if exists, append -1/-2
    let candidate = dir.join(stem);
    if !candidate.exists() {
        return PathBuf::from(stem);
    }
    let dot = stem.rfind('.');
    let (base, ext) = if let Some(idx) = dot {
        (&stem[..idx], &stem[idx..])
    } else {
        (stem, "")
    };
    for i in 1..100 {
        let name = format!("{}-{}{}", base, i, ext);
        let p = dir.join(&name);
        if !p.exists() {
            return PathBuf::from(name);
        }
    }
    // fallback: millisecond suffix
    let ms = chrono::Local::now().timestamp_millis() % 1000;
    PathBuf::from(format!("{}-{}{}", base, ms, ext))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    // If path has no extension, with_extension replaces; use string concat to be safe
    let tmp = if path.extension().is_some() {
        tmp
    } else {
        PathBuf::from(format!("{}.tmp", path.display()))
    };
    // Ensure parent exists (already created, but belt-and-suspenders)
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建目录 '{}': {}", parent.display(), e))?;
    }
    std::fs::write(&tmp, bytes)
        .map_err(|e| format!("写入临时文件失败 '{}': {}", tmp.display(), e))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("文件重命名失败: {}", e))?;
    Ok(())
}

// ------------------------------------------------------------------
// Commands
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportToDirResult {
    pub path: String,
    pub json: String,
    pub filename: String,
}

#[tauri::command]
pub fn db_get_default_export_dir(app: AppHandle) -> Result<String, String> {
    Ok(default_export_dir_for(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn db_export_library_to_dir(app: AppHandle, dir: String) -> Result<ExportToDirResult, String> {
    let dir_path = normalize_export_dir(&dir, &app)?;
    std::fs::create_dir_all(&dir_path)
        .map_err(|e| format!("目录不存在且无法创建 '{}': {}", dir_path.display(), e))?;
    // quick writable probe (atomic_write will also fail, but probe gives clearer message)
    let probe = dir_path.join(".pmf_write_probe.tmp");
    match std::fs::write(&probe, b"probe") {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
        }
        Err(e) => {
            return Err(format!("目录不可写 '{}': {}", dir_path.display(), e));
        }
    }
    let conn = super::meta::open_active_conn(&app)?;
    let payload = super::db::export_library(&conn)?;
    let json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    let stem = format_local_filename();
    let filename_buf = unique_filename_in(&dir_path, &stem);
    let filename = filename_buf.to_string_lossy().to_string();
    let full_path = dir_path.join(&filename_buf);
    atomic_write(&full_path, json.as_bytes())?;
    Ok(ExportToDirResult {
        path: full_path.to_string_lossy().to_string(),
        json,
        filename,
    })
}

/// need07 重写：占位符拦截 → 脱壳 → 相对拼 active → ensure 保活 →
/// Windows 文件用 explorer 双参数 `/select,` + 路径，目录直接打开；
/// spawn 失败回退 `tauri_plugin_opener::open_path`。相对/占位符永不透传 explorer。
#[tauri::command]
pub fn db_reveal_in_explorer(app: AppHandle, path: String) -> Result<(), String> {
    use super::path_resolve::{display_path, ensure_dir, resolve_data_dir, strip_verbatim};
    let input = path.trim();
    if input.is_empty() {
        return Err("路径不能为空".to_string());
    }
    if input.starts_with('<') {
        return Err("路径尚未解析（收到占位符），请先配置具体目录".to_string());
    }
    let raw = strip_verbatim(Path::new(input));
    let target = if raw.is_absolute() {
        raw
    } else {
        let active = PathBuf::from(resolve_data_dir(&app)?.active);
        active.join(raw)
    };
    // 文件保活其 parent，目录保活自身；打开逻辑收敛中枢 reveal_target
    if target.is_file() {
        let parent = target.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| target.clone());
        ensure_dir(&parent)?;
    } else {
        ensure_dir(&target)?;
    }
    eprintln!("[pmf] reveal {}", display_path(&target));
    super::path_resolve::reveal_target(&target)
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf as PB;

    #[test]
    fn lexical_normalize_cleans_dots() {
        let p = PB::from("a/./b/../c//d");
        let n = lexical_normalize(&p);
        assert_eq!(n, PB::from("a/c/d"));
    }

    #[test]
    fn unique_filename_no_collision() {
        let dir = std::env::temp_dir().join(format!("pmf_export_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let name = unique_filename_in(&dir, "pmf-library-20260829-153022.json");
        assert_eq!(name, PB::from("pmf-library-20260829-153022.json"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unique_filename_with_collision_increments() {
        let dir = std::env::temp_dir().join(format!("pmf_export_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let stem = "pmf-library-20260829-153022.json";
        std::fs::write(dir.join(stem), b"a").unwrap();
        let n1 = unique_filename_in(&dir, stem);
        assert_eq!(n1, PB::from("pmf-library-20260829-153022-1.json"));
        std::fs::write(dir.join(n1.clone()), b"b").unwrap();
        let n2 = unique_filename_in(&dir, stem);
        assert_eq!(n2, PB::from("pmf-library-20260829-153022-2.json"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_to_dir_creates_dir_and_writes_valid_json() {
        // Use a temp directory as export target with a real DB connection
        let dir = std::env::temp_dir().join(format!("pmf_export_e2e_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_dir = std::env::temp_dir().join(format!("pmf_export_db_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&db_dir).unwrap();
        let db_path = db_dir.join("pmf.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(include_str!("../../resources/schema.sql")).unwrap();
        let ts = chrono::Utc::now().timestamp();
        conn.execute_batch(&format!(
            "INSERT INTO dimensions (id,key,name_cn,sort_order,is_multi_select,is_enabled,created_at,updated_at,is_deleted) VALUES ('dim_top','top','上装',6,0,1,{ts},{ts},0);"
        ))
        .unwrap();
        conn.execute_batch(&format!(
            "INSERT INTO modules (id,dimension_id,content_en,display_name,weight,is_enabled,is_nsfw,usage_count,created_at,updated_at,is_deleted) VALUES ('mod_top_01','dim_top','white shirt','白衬衫',1.0,1,0,0,{ts},{ts},0);"
        ))
        .unwrap();
        // Directly test payload + atomic write without AppHandle
        let payload = super::super::db::export_library(&conn).unwrap();
        let json = serde_json::to_string_pretty(&payload).unwrap();
        // Validate JSON structure
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["format"], "pmf-library");
        // unique filename + atomic write
        let stem = "pmf-library-20260829-153022.json";
        let fname = unique_filename_in(&dir, stem);
        let full = dir.join(&fname);
        atomic_write(&full, json.as_bytes()).unwrap();
        assert!(full.exists());
        let back = std::fs::read_to_string(&full).unwrap();
        let v2: serde_json::Value = serde_json::from_str(&back).unwrap();
        assert_eq!(v2["format"], "pmf-library");
        assert_eq!(v2["counts"]["modules"], 1);
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&db_dir);
    }

    #[test]
    fn format_local_filename_matches_template() {
        let name = format_local_filename();
        assert!(name.starts_with("pmf-library-"));
        assert!(name.ends_with(".json"));
        // length: pmf-library- (12) + 8 date + 1 dash + 6 time + 5 .json = 32
        assert_eq!(name.len(), 32);
    }
}
