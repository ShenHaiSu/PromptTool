use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

// ------------------------------------------------------------------
// Helpers — data dir / default export dir
// ------------------------------------------------------------------

/// 默认导出目录 = data_dir_for(app).join("output")
pub fn default_export_dir_for(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(super::migration::data_dir_for(app)?.join("output"))
}

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

/// 归一导出目录：
/// - 去首尾空白
/// - 空串 → 回落 default_export_dir_for
/// - 相对路径视作相对 data_dir_for 拼接
/// - 若父目录存在则 canonicalize 父目录以还原 Windows 真实大小写
fn normalize_export_dir(input: &str, app: &AppHandle) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return default_export_dir_for(app);
    }
    let mut raw = PathBuf::from(trimmed);
    // relative inputs historically may carry "data/" prefix — strip to avoid data/data/output
    if !raw.is_absolute() {
        let s = raw.to_string_lossy().replace('\\', "/");
        if s == "data" {
            raw = PathBuf::from("");
            if raw.as_os_str().is_empty() {
                return default_export_dir_for(app);
            }
        } else if s.starts_with("data/") {
            raw = PathBuf::from(&s["data/".len()..]);
        }
        if raw.as_os_str().is_empty() {
            return default_export_dir_for(app);
        }
        let base = super::migration::data_dir_for(app)?;
        raw = base.join(raw);
    }
    // Parent canonicalize to restore real casing, fallback to lexical
    let normalized = if raw.exists() {
        raw.canonicalize()
            .map_err(|e| format!("无法规范化路径 '{}': {}", raw.display(), e))?
    } else if let Some(parent) = raw.parent() {
        if parent.exists() {
            if let Ok(canon) = parent.canonicalize() {
                if let Some(file) = raw.file_name() {
                    let mut out = canon;
                    out.push(file);
                    lexical_normalize(&out)
                } else {
                    lexical_normalize(&raw)
                }
            } else {
                lexical_normalize(&raw)
            }
        } else {
            lexical_normalize(&raw)
        }
    } else {
        lexical_normalize(&raw)
    };
    Ok(normalized)
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

#[tauri::command]
pub fn db_reveal_in_explorer(_app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    if p.as_os_str().is_empty() {
        return Err("路径不能为空".to_string());
    }
    // Prefer opener crate's reveal if available; fallback to opener plugin
    // Use std::process for minimal dependency: rely on tauri_plugin_opener's open_path via app if needed.
    // Here we try `opener` crate behavior via `tauri_plugin_opener::open_path` is not directly accessible
    // without AppHandle opener state, so we use `open` crate fallback: just open the directory.
    #[cfg(target_os = "windows")]
    {
        let target = if p.is_file() {
            // explorer /select, "file"
            let arg = format!("/select,\"{}\"", p.display());
            std::process::Command::new("explorer")
                .arg(arg)
                .spawn()
                .map_err(|e| format!("无法打开所在文件夹: {}", e))?;
            return Ok(());
        } else {
            p.clone()
        };
        std::process::Command::new("explorer")
            .arg(target.as_os_str())
            .spawn()
            .map_err(|e| format!("无法打开所在文件夹: {}", e))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Best-effort: open with xdg-open / open
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener)
            .arg(p.as_os_str())
            .spawn()
            .map_err(|e| format!("无法打开所在文件夹: {}", e))?;
        Ok(())
    }
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
