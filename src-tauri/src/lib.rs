// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod commands;

use commands::migration::init_db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Err(e) = init_db(&app.handle()) {
                eprintln!("[pmf] init_db failed: {}", e);
                // 落盘日志（release 下无控制台，此为唯一可见出口）
                if let Ok(exe) = std::env::current_exe() {
                    if let Some(dir) = exe.parent() {
                        let _ = std::fs::write(
                            dir.join("init_db_error.log"),
                            format!("[pmf] init_db failed: {}\n", e),
                        );
                    }
                }
            }
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
            commands::migration::db_import_legacy_db
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
