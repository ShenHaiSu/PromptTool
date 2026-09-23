// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod commands;

use std::collections::VecDeque;

use commands::meta::{auto_migrate_first_business, init_default_db, load_state_from_meta, AppState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // --- Need07: 双 base 数据目录（exe/data 可写即用，否则回退 app_data_dir） ---
            let report = match commands::path_resolve::resolve_data_dir(&app.handle()) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[pmf] resolve_data_dir failed: {}", e);
                    return Ok(());
                }
            };
            eprintln!("[pmf] data_dir active={} base={} writable={}", report.active, report.base, report.writable);
            let default_db = std::path::PathBuf::from(report.active).join("Default.db");
            if let Err(e) = init_default_db(&default_db) {
                eprintln!("[pmf] init_default_db failed: {}", e);
                if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|x| x.to_path_buf())) {
                    let _ = std::fs::write(dir.join("init_default_db_error.log"), format!("[pmf] init_default_db failed: {}\n", e));
                }
            }
            // --- Need07: 注册表路径无感迁移 v1→v2（失败不阻断启动，只日志） ---
            if let Err(e) = commands::meta::migrate_path_schema_v2(&default_db) {
                eprintln!("[pmf] migrate_path_schema_v2 skipped: {}", e);
            }
            // Legacy init_db for single-DB compat is no longer auto-run; keep pmf.db migration via auto_migrate
            let (fg, max_active, resident) = load_state_from_meta(&default_db).unwrap_or((None, 2, VecDeque::new()));
            app.manage(AppState {
                default_db: default_db.clone(),
                foreground: std::sync::Mutex::new(fg),
                resident: std::sync::Mutex::new(resident),
                max_active: std::sync::Mutex::new(max_active),
            });
            if let Err(e) = auto_migrate_first_business(&app.handle()) {
                eprintln!("[pmf] auto_migrate_first_business: {}", e);
            }

            // --- Need05: 生图队列 state（image_queue.json + secrets 启动加载） ---
            app.manage(commands::image_queue::queue::init_state(&app.handle()));

            // Legacy single-DB fallback init (kept for backward compat, not default)
            // If foreground is None and pmf.db exists but PromptDataBase not, init_db can seed pmf.db for dev usage
            // Not auto-running init_db to avoid creating pmf.db confusion; Default.db is source of truth.

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db::db_get_dimensions,
            commands::db::db_get_modules_by_dimension,
            commands::db::db_get_all_modules_grouped,
            commands::db::db_search_modules,
            commands::db::db_create_module,
            commands::db::db_update_module,
            commands::db::db_soft_delete_module,
            commands::db::db_create_dimension,
            commands::db::db_update_dimension,
            commands::db::db_soft_delete_dimension,
            commands::db::db_migrate_dimension,
            commands::db::db_save_assembly,
            commands::db::db_save_assembly_from_ir,
            commands::db::db_list_recent,
            commands::db::db_list_favorites,
            commands::db::db_search_assemblies,
            commands::db::db_get_assembly_items,
            commands::db::db_load_selected_items,
            commands::db::db_toggle_favorite,
            commands::db::db_rename_assembly,
            commands::db::db_soft_delete_assembly,
            commands::db::db_save_template,
            commands::db::db_list_templates,
            commands::db::db_apply_template,
            commands::db::db_soft_delete_template,
            commands::db::db_export_csv,
            commands::db::db_export_library,
            commands::db::db_import_library,
            commands::db::db_import_library_text,
            commands::segment::db_import_segments,
            commands::segment::db_import_segments_text,
            commands::batch::db_batch_create_modules,
            commands::batch::db_batch_create_modules_text,
            commands::migration::db_import_legacy_db,
            commands::rules::db_list_rules,
            commands::rules::db_create_rule,
            commands::rules::db_update_rule,
            commands::rules::db_delete_rule,
            commands::rules::db_toggle_rule,
            commands::meta::db_get_active_info,
            commands::meta::db_list_registry,
            commands::meta::db_set_max_active,
            commands::meta::db_set_temp_carry,
            commands::meta::db_get_temp_carry,
            commands::business::db_validate_business,
            commands::business::db_create_business,
            commands::business::db_check_alias,
            commands::business::db_switch_active,
            commands::business::db_repair_path,
            commands::business::db_rebuild_missing,
            commands::business::db_remove_registry,
            commands::business::db_update_registry_meta,
            commands::export::db_get_default_export_dir,
            commands::export::db_export_library_to_dir,
            commands::export::db_reveal_in_explorer,
            // --- Need07: 路径探针 2 + 输出目录打开/解析 2 ---
            commands::path_resolve::path_get_bases,
            commands::path_resolve::path_migrate_status,
            commands::translation::db_batch_update_display_names,
            commands::translation::db_batch_update_display_names_text,
            // --- Need05: 生图队列 10 命令 + need06 解析入口 1 命令 ---
            commands::image_queue::queue::iq_set_config,
            commands::image_queue::queue::iq_get_config,
            commands::image_queue::queue::iq_test_connection,
            commands::image_queue::queue::iq_enqueue,
            commands::image_queue::queue::iq_start,
            commands::image_queue::queue::iq_stop,
            commands::image_queue::queue::iq_retry,
            commands::image_queue::queue::iq_remove,
            commands::image_queue::queue::iq_clear_finished,
            commands::image_queue::queue::iq_list,
            commands::image_queue::queue::iq_read_image_meta,
            commands::image_queue::queue::iq_get_resolved_output_dir,
            commands::image_queue::queue::iq_open_output_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
