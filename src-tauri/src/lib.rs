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
            // --- Need04: Default.db + AppState ---
            let data_dir = match commands::migration::data_dir_for(&app.handle()) {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("[pmf] data_dir_for failed: {}", e);
                    return Ok(());
                }
            };
            let default_db = data_dir.join("Default.db");
            if let Err(e) = init_default_db(&default_db) {
                eprintln!("[pmf] init_default_db failed: {}", e);
                if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|x| x.to_path_buf())) {
                    let _ = std::fs::write(dir.join("init_default_db_error.log"), format!("[pmf] init_default_db failed: {}
", e));
                }
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
            commands::translation::db_batch_update_display_names,
            commands::translation::db_batch_update_display_names_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
