//! need07 路径中枢（方案B）：存储/展示/比较三规则 + 数据目录双 base 回退。
//!
//! - 零新依赖：只用 `app.path()` + 手写 `strip_verbatim`。
//! - 纯函数（无 `AppHandle`，可单测）+ 薄适配层（需 `AppHandle`）分离。
//! - 入库/返给前端的路径永不含 `\\?\` 前缀；日志一律 `display_path`。

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

// ------------------------------------------------------------------
// 纯函数
// ------------------------------------------------------------------

/// 去 verbatim 前缀（与前端 `stripVerbatim` 同规则，前后端单测互相锁定）：
/// - `\\?\UNC\server\share\a` → `\\server\share\a`
/// - `\\?\D:\a` → `D:\a`
/// - `\\?\GLOBALROOT\...` → 原样（罕见，不动）
/// - 其他 → 原样
pub fn strip_verbatim(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{}", rest));
    }
    if s.starts_with(r"\\?\") {
        // GLOBALROOT 罕见，保持不动
        if s.starts_with(r"\\?\GLOBALROOT\") {
            return p.to_path_buf();
        }
        return PathBuf::from(&s[r"\\?\".len()..]);
    }
    p.to_path_buf()
}

/// 展示形态：脱壳 + lossy。供日志/报错/探针/前端回包。
pub fn display_path(p: &Path) -> String {
    strip_verbatim(p).to_string_lossy().to_string()
}

/// 比较键：脱壳 → 小写 → `/` 统一。替换裸 `to_ascii_lowercase` 直比。
///
/// 注：设计文档写 “Windows 小写 / Unix 原样”，此处有意全平台小写——
/// 旧代码本就全平台 `to_ascii_lowercase` 比较，保持行为兼容，
/// 且 Linux 开发机单测 B3 同样可断言。
pub fn norm_key(p: &Path) -> String {
    strip_verbatim(p)
        .to_string_lossy()
        .replace('\\', "/")
        .to_lowercase()
}

/// 词法归一（收敛 business/export/queue 三处重复实现）。
pub fn lexical_normalize(p: &Path) -> PathBuf {
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

/// 盘符大写（`d:\a` → `D:\a`，UNC/相对路径不动）。
pub fn uppercase_drive(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    let b = s.as_bytes();
    if b.len() >= 3 && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/') && (b[0] as char).is_ascii_lowercase() {
        let mut out = String::with_capacity(s.len());
        out.push((b[0] as char).to_ascii_uppercase());
        out.push_str(&s[1..]);
        return PathBuf::from(out);
    }
    p.to_path_buf()
}

/// 存在 → `canonicalize` + 脱壳 + 盘符大写；缺失 → 父 canonical + 脱壳；
/// 都不存在 → 词法归一（永不返回 `\\?\` 前缀）。
pub fn canonical_stripped(p: &Path) -> Result<PathBuf, String> {
    if p.exists() {
        let c = p
            .canonicalize()
            .map_err(|e| format!("无法规范化路径 '{}': {}", p.display(), e))?;
        return Ok(uppercase_drive(&strip_verbatim(&c)));
    }
    if let Some(parent) = p.parent() {
        if parent.exists() {
            if let Ok(canon_parent) = parent.canonicalize() {
                let canon_parent = uppercase_drive(&strip_verbatim(&canon_parent));
                if let Some(file) = p.file_name() {
                    let mut out = canon_parent;
                    out.push(file);
                    return Ok(uppercase_drive(&strip_verbatim(&lexical_normalize(&out))));
                }
                return Ok(uppercase_drive(&strip_verbatim(&lexical_normalize(p))));
            }
        }
    }
    Ok(uppercase_drive(&strip_verbatim(&lexical_normalize(p))))
}

/// 老默认（`data/output/images`）是否含文件（无感保留判断用）。
pub fn legacy_has_files(dir: &Path) -> bool {
    match std::fs::read_dir(dir) {
        Ok(mut it) => it.any(|e| e.is_ok()),
        Err(_) => false,
    }
}

/// 生图输出新默认值：
/// - `legacy_has_files == true` → 老默认（不搬家，只提示保留）
/// - 否则 `doc/Prompt Modular Factory/images`（`doc == None` 则回退老默认）
pub fn default_image_dir_for(
    data_dir: &Path,
    doc_dir: Option<&Path>,
    legacy_has_files: bool,
) -> PathBuf {
    let legacy = data_dir.join("output").join("images");
    if legacy_has_files {
        return legacy;
    }
    match doc_dir {
        Some(doc) => doc.join("Prompt Modular Factory").join("images"),
        None => legacy,
    }
}

/// 词库导出新默认值（规则同生图输出，落点 `exports` / 老 `output`）。
pub fn default_export_dir_for(
    data_dir: &Path,
    doc_dir: Option<&Path>,
    legacy_has_files: bool,
) -> PathBuf {
    let legacy = data_dir.join("output");
    if legacy_has_files {
        return legacy;
    }
    match doc_dir {
        Some(doc) => doc.join("Prompt Modular Factory").join("exports"),
        None => legacy,
    }
}

// ------------------------------------------------------------------
// 薄适配层（需 AppHandle）
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveReport {
    pub active: String,
    pub exe_data: String,
    pub app_data: Option<String>,
    pub base: String,
    pub writable: bool,
}

fn probe_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".pmf_write_probe.tmp");
    match std::fs::write(&probe, b"probe") {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn document_dir_of(app: &AppHandle) -> Option<PathBuf> {
    app.path().document_dir().ok()
}

/// 双 base 解析：`exe/data` 可写即用（95% 老用户 + 开发期）；
/// 失败（Program Files 非管理员）回退 `app_data_dir`，并搬一次旧 `Default.db`。
pub fn resolve_data_dir(app: &AppHandle) -> Result<ResolveReport, String> {
    let exe_data = super::migration::data_dir_for(app)?;
    if probe_writable(&exe_data) {
        return Ok(ResolveReport {
            active: display_path(&exe_data),
            exe_data: display_path(&exe_data),
            app_data: app
                .path()
                .app_data_dir()
                .ok()
                .map(|p| display_path(&p)),
            base: "exe".to_string(),
            writable: true,
        });
    }
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| {
            format!(
                "exe 数据目录不可写（{}），且无法获取系统数据目录（{}）",
                exe_data.display(),
                e
            )
        })?;
    if !probe_writable(&app_data) {
        return Err(format!(
            "数据目录均不可写：exe={} appdata={}",
            exe_data.display(),
            app_data.display()
        ));
    }
    // 旧 Default.db 搬一次（新位置无、旧位置有）
    let new_db = app_data.join("Default.db");
    let old_db = exe_data.join("Default.db");
    if !new_db.exists() && old_db.exists() {
        if super::migration::migrate_legacy_db(&old_db, &new_db).is_ok() {
            eprintln!(
                "[pmf] Default.db 已迁移: {} → {}",
                old_db.display(),
                new_db.display()
            );
        }
    }
    eprintln!(
        "[pmf] data_dir active={} base=appdata writable=true",
        app_data.display()
    );
    Ok(ResolveReport {
        active: display_path(&app_data),
        exe_data: display_path(&exe_data),
        app_data: Some(display_path(&app_data)),
        base: "appdata".to_string(),
        writable: true,
    })
}

/// `create_dir_all` + 写探针保活。目录不存在不再直接丢给 explorer。
pub fn ensure_dir(p: &Path) -> Result<PathBuf, String> {
    if p.as_os_str().is_empty() {
        return Err("路径不能为空".to_string());
    }
    std::fs::create_dir_all(p)
        .map_err(|e| format!("无法创建目录 '{}': {}", display_path(p), e))?;
    let probe = p.join(".pmf_write_probe.tmp");
    match std::fs::write(&probe, b"probe") {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            Ok(p.to_path_buf())
        }
        Err(e) => Err(format!("目录不可写 '{}': {}", display_path(p), e)),
    }
}

/// 生图输出解析：空/`<>`占位 → 新/老默认决策；相对拼 active；绝对直用。
pub fn resolve_image_dir(app: &AppHandle, input: &str) -> Result<PathBuf, String> {
    let active = PathBuf::from(resolve_data_dir(app)?.active.clone());
    // active 是 display 形态字符串，转回 PathBuf（无 \\?\，可直接用）
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed.starts_with('<') {
        let legacy = active.join("output").join("images");
        let has = legacy_has_files(&legacy);
        return Ok(default_image_dir_for(&active, document_dir_of(app).as_deref(), has));
    }
    let raw = strip_verbatim(Path::new(trimmed));
    let joined = if raw.is_absolute() {
        raw
    } else {
        // 兼容历史 data/ 前缀
        let s = raw.to_string_lossy().replace('\\', "/");
        let rel = if s == "data" {
            PathBuf::new()
        } else if let Some(st) = s.strip_prefix("data/") {
            PathBuf::from(st)
        } else {
            raw
        };
        if rel.as_os_str().is_empty() {
            let legacy = active.join("output").join("images");
            let has = legacy_has_files(&legacy);
            return Ok(default_image_dir_for(&active, document_dir_of(app).as_deref(), has));
        }
        active.join(rel)
    };
    Ok(uppercase_drive(&strip_verbatim(&lexical_normalize(&joined))))
}

/// 词库导出解析（规则同生图输出，落点 exports/output）。
pub fn resolve_export_dir(app: &AppHandle, input: &str) -> Result<PathBuf, String> {
    let active = PathBuf::from(resolve_data_dir(app)?.active.clone());
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed.starts_with('<') {
        let legacy = active.join("output");
        let has = legacy_has_files(&legacy);
        return Ok(default_export_dir_for(&active, document_dir_of(app).as_deref(), has));
    }
    let raw = strip_verbatim(Path::new(trimmed));
    let joined = if raw.is_absolute() {
        raw
    } else {
        let s = raw.to_string_lossy().replace('\\', "/");
        let rel = if s == "data" {
            PathBuf::new()
        } else if let Some(st) = s.strip_prefix("data/") {
            PathBuf::from(st)
        } else {
            raw
        };
        if rel.as_os_str().is_empty() {
            let legacy = active.join("output");
            let has = legacy_has_files(&legacy);
            return Ok(default_export_dir_for(&active, document_dir_of(app).as_deref(), has));
        }
        active.join(rel)
    };
    Ok(uppercase_drive(&strip_verbatim(&lexical_normalize(&joined))))
}

// ------------------------------------------------------------------
// 探针命令（调试 + 验收）
// ------------------------------------------------------------------

#[tauri::command]
pub fn path_get_bases(app: AppHandle) -> Result<ResolveReportBases, String> {
    let r = resolve_data_dir(&app)?;
    Ok(ResolveReportBases {
        exe_dir: display_path(
            &std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|x| x.to_path_buf()))
                .unwrap_or_default(),
        ),
        exe_data: r.exe_data,
        active_data: r.active,
        doc_dir: document_dir_of(&app).map(|p| display_path(&p)),
        base: r.base,
        writable: r.writable,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveReportBases {
    pub exe_dir: String,
    pub exe_data: String,
    pub active_data: String,
    pub doc_dir: Option<String>,
    pub base: String,
    pub writable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateStatus {
    pub version: String,
    pub washed: i64,
    pub deduped: i64,
}

#[tauri::command]
pub fn path_migrate_status(app: AppHandle) -> Result<MigrateStatus, String> {
    let state = app.state::<super::meta::AppState>();
    let conn =
        rusqlite::Connection::open(&state.default_db).map_err(|e| e.to_string())?;
    let version: Option<String> = conn
        .query_row(
            "SELECT v FROM app_settings WHERE k='path_schema_version'",
            [],
            |r| r.get(0),
        )
        .ok();
    let washed: Option<String> = conn
        .query_row(
            "SELECT v FROM app_settings WHERE k='path_migrate_washed'",
            [],
            |r| r.get(0),
        )
        .ok();
    let deduped: Option<String> = conn
        .query_row(
            "SELECT v FROM app_settings WHERE k='path_migrate_deduped'",
            [],
            |r| r.get(0),
        )
        .ok();
    Ok(MigrateStatus {
        version: version.unwrap_or_else(|| "1".to_string()),
        washed: washed.and_then(|s| s.parse().ok()).unwrap_or(0),
        deduped: deduped.and_then(|s| s.parse().ok()).unwrap_or(0),
    })
}
 // ------------------------------------------------------------------
 // 打开目录（explorer 双参数 + opener 兜底，供 export/queue 复用）
 // ------------------------------------------------------------------

 /// 打开/选中路径：Windows 下文件 → `explorer /select,` + 路径（两个参数！），
 /// 目录 → 直接打开；`spawn` 失败回退 `tauri_plugin_opener::open_path`。
 /// 调用前请 `ensure_dir` 保活（文件保活其 parent）。
 pub fn reveal_target(target: &Path) -> Result<(), String> {
     #[cfg(target_os = "windows")]
     {
         if target.is_file() {
             match std::process::Command::new("explorer")
                 .arg("/select,")
                 .arg(target.as_os_str())
                 .spawn()
             {
                 Ok(_) => return Ok(()),
                 Err(e) => {
                     let parent = target.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| target.to_path_buf());
                     tauri_plugin_opener::open_path(&parent, None::<&str>).map_err(|oe| {
                         format!("无法打开所在文件夹 '{}': {} / 兜底亦失败: {}", display_path(target), e, oe)
                     })?;
                     return Ok(());
                 }
             }
         }
         match std::process::Command::new("explorer").arg(target.as_os_str()).spawn() {
             Ok(_) => Ok(()),
             Err(e) => {
                 tauri_plugin_opener::open_path(target, None::<&str>).map_err(|oe| {
                     format!("无法打开所在文件夹 '{}': {} / 兜底亦失败: {}", display_path(target), e, oe)
                 })?;
                 Ok(())
             }
         }
     }
     #[cfg(not(target_os = "windows"))]
     {
         let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
         std::process::Command::new(opener)
             .arg(target.as_os_str())
             .spawn()
             .map_err(|e| format!("无法打开所在文件夹 '{}': {}", display_path(target), e))?;
         Ok(())
     }
 }

// ------------------------------------------------------------------
// Tests（06 §1 B1–B7）
// ------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn b1_strip_verbatim_drive() {
        assert_eq!(
            strip_verbatim(Path::new(r"\\?\D:\a.db")),
            PathBuf::from(r"D:\a.db")
        );
        // 普通路径原样
        assert_eq!(
            strip_verbatim(Path::new(r"D:\a.db")),
            PathBuf::from(r"D:\a.db")
        );
    }

    #[test]
    fn b2_strip_verbatim_unc() {
        assert_eq!(
            strip_verbatim(Path::new(r"\\?\UNC\s\sh\a")),
            PathBuf::from(r"\\s\sh\a")
        );
    }

    #[test]
    fn b3_norm_key_unifies_verbatim_and_separators() {
        assert_eq!(
            norm_key(Path::new(r"\\?\D:\A.db")),
            norm_key(Path::new("d:/a.db"))
        );
        assert_eq!(
            norm_key(Path::new(r"D:\X\Y.db")),
            norm_key(Path::new("d:/x/y.db"))
        );
    }

    #[test]
    fn b4_canonical_stripped_existing_file() {
        let dir = std::env::temp_dir().join(format!("pmf_path_b4_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.db");
        std::fs::write(&f, b"x").unwrap();
        let out = canonical_stripped(&f).unwrap();
        assert!(
            !out.to_string_lossy().contains(r"\\?\"),
            "实际：{}",
            out.display()
        );
        assert!(out.exists());
        // 文件仍可 open
        assert!(std::fs::read(&out).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn b5_default_image_dir_legacy_kept() {
        let data = Path::new("/tmp/pmf_need07_data");
        let doc = Path::new("/tmp/pmf_need07_doc");
        assert_eq!(
            default_image_dir_for(data, Some(doc), true),
            data.join("output").join("images")
        );
    }

    #[test]
    fn b6_default_image_dir_doc_first() {
        let data = Path::new("/tmp/pmf_need07_data");
        let doc = Path::new("/tmp/pmf_need07_doc");
        assert_eq!(
            default_image_dir_for(data, Some(doc), false),
            doc.join("Prompt Modular Factory").join("images")
        );
    }

    #[test]
    fn b7_default_fallback_without_doc() {
        let data = Path::new("/tmp/pmf_need07_data");
        assert_eq!(
            default_image_dir_for(data, None, false),
            data.join("output").join("images")
        );
        assert_eq!(
            default_export_dir_for(data, None, false),
            data.join("output")
        );
    }

    #[test]
    fn export_default_doc_first_and_legacy() {
        let data = Path::new("/tmp/pmf_need07_data");
        let doc = Path::new("/tmp/pmf_need07_doc");
        assert_eq!(
            default_export_dir_for(data, Some(doc), false),
            doc.join("Prompt Modular Factory").join("exports")
        );
        assert_eq!(
            default_export_dir_for(data, Some(doc), true),
            data.join("output")
        );
    }
}
