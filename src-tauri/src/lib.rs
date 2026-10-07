//! Splashboard's Rust side: the Splash HTTP transport (`transport`), the
//! engine supervisor (`splash`), and the Tauri wiring below.

mod error;
mod install;
mod models;
mod pty;
mod splash;
mod transport;

use std::sync::Arc;

use tauri::{Manager, RunEvent};

use splash::events::TauriEngineEvents;
use splash::Supervisor;
use transport::SplashTransport;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let transport = SplashTransport::new().expect("could not create the HTTP client");

    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(transport)
        .manage(pty::PtyManager::new())
        .setup(|app| {
            let events = Arc::new(TauriEngineEvents::new(app.handle().clone()));
            app.manage(splash::setup(app.handle(), events));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            transport::commands::splash_request,
            transport::commands::splash_stream,
            transport::commands::splash_stream_cancel,
            transport::commands::splash_config_get,
            transport::commands::splash_config_set,
            splash::commands::engine_detect,
            splash::commands::engine_start,
            splash::commands::engine_stop,
            splash::commands::engine_state,
            splash::commands::engine_logs,
            splash::commands::engine_render,
            splash::commands::engine_restart,
            splash::commands::engine_save_log,
            splash::commands::engine_adopt,
            splash::commands::engine_stop_external,
            splash::commands::engine_discover,
            splash::commands::engine_configure,
            pty::commands::pty_spawn,
            pty::commands::pty_spawn_splash,
            pty::commands::pty_write,
            pty::commands::pty_resize,
            pty::commands::pty_kill,
            pty::commands::pty_list,
            pty::commands::connectors_detect,
            install::commands::install_status,
            install::commands::install_check_latest,
            install::commands::install_homebrew_command,
            install::commands::install_run,
            install::commands::install_cancel,
            install::commands::install_active,
            models::commands::models_catalog,
            models::commands::models_catalog_refresh_official,
            models::commands::models_repo_variants,
            models::commands::models_installed,
            models::commands::models_download,
            models::commands::models_download_cancel,
            models::commands::models_jobs,
            models::commands::models_verify,
            models::commands::models_remove_plan,
            models::commands::models_remove,
            models::commands::models_disk_space,
            models::commands::hf_token_status,
            models::commands::hf_token_save,
            models::commands::hf_token_remove,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Splashboard");

    app.run(|handle, event| {
        // Never leave a model server running after the app quits.
        if let RunEvent::Exit = event {
            // Agent terminals first: they talk to the server.
            if let Some(ptys) = handle.try_state::<pty::PtyManager>() {
                ptys.kill_all(std::time::Duration::from_millis(500));
            }
            if let Some(supervisor) = handle.try_state::<Supervisor>() {
                supervisor.shutdown_blocking();
            }
        }
    });
}
