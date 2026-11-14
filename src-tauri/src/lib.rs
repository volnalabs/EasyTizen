//! EasyTizen application shell (desktop and Android). The React frontend can only call the
//! typed commands registered below; it never starts processes or touches arbitrary paths.

mod api;
mod builtin;
mod history;
mod migrate;
mod sdk_engine;
mod sdk_installer;
mod settings;
mod toolchain;
mod updates;

use easytizen_core::cancel::CancelToken;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub data_dir: std::path::PathBuf,
    pub cache_dir: std::path::PathBuf,
    pub settings: Mutex<settings::Settings>,
    pub ops: Mutex<HashMap<String, CancelToken>>,
    /// Certificate passwords entered during this session. Memory only — never persisted.
    pub passwords: Mutex<HashMap<String, String>>,
}

pub fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub fn now_secs() -> i64 {
    (now_millis() / 1000) as i64
}

/// Removes working copies a crashed or killed session may have left behind.
fn clean_stale_work_files(data_dir: &std::path::Path, cache_dir: &std::path::Path) {
    for dir in [
        data_dir.join("signed-packages"),
        cache_dir.join("signed-packages"),
        cache_dir.join("picked"),
        cache_dir.join("import"),
    ] {
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());
    // Self-update is wired up only in builds that carry the project's update key; the
    // frontend cannot reach the updater plugin directly (no capability grants it).
    #[cfg(desktop)]
    if let Some(key) = updates::pubkey() {
        context.config_mut().plugins.0.insert(
            "updater".into(),
            serde_json::json!({ "pubkey": key, "endpoints": [updates::MANIFEST_URL] }),
        );
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    #[cfg(mobile)]
    {
        builder = builder.plugin(updates::android::plugin());
    }
    builder
        .manage(updates::UpdateState::default())
        .setup(|app| {
            let dir = app.path().app_data_dir().expect("app data dir");
            migrate::migrate_legacy_data(&dir);
            std::fs::create_dir_all(&dir).ok();
            let cache = app
                .path()
                .app_cache_dir()
                .unwrap_or_else(|_| dir.join("cache"));
            std::fs::create_dir_all(&cache).ok();
            clean_stale_work_files(&dir, &cache);
            let settings = settings::load(&dir);
            app.manage(AppState {
                data_dir: dir,
                cache_dir: cache,
                settings: Mutex::new(settings),
                ops: Mutex::new(HashMap::new()),
                passwords: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api::app_info,
            api::get_settings,
            api::save_preferences,
            api::set_engine,
            api::complete_onboarding,
            api::cancel_operation,
            api::remove_device,
            api::rename_device,
            api::toolchain_status,
            api::find_existing_sdk,
            api::set_sdk_path,
            api::sdk_preflight,
            api::install_samsung_sdk,
            api::scan_tvs,
            api::connect_tv,
            api::disconnect_tv,
            api::open_package,
            api::verify_package,
            api::set_extra_package_checks,
            api::create_certificate,
            api::import_certificate,
            api::remove_certificate,
            api::install_package,
            api::uninstall_app,
            api::get_history,
            api::clear_history,
            api::diagnostics_report,
            api::save_text_file,
            api::check_for_update,
            updates::update_check,
            updates::update_download,
            updates::update_apply,
            updates::update_open_permission_settings,
            api::open_external,
        ])
        .run(context)
        .expect("error while running EasyTizen");
}
