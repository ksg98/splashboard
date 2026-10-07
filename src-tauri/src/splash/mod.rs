//! The Splash engine supervisor: find the CLI, launch `splash serve`, follow
//! its logs and lifecycle phases, attach to servers it did not start, and
//! stop it (also when the app quits).
//!
//! Layout, so later work can extend one piece at a time:
//! - `params.rs`     — catalog-driven `ServeRequest` -> argv/env/command
//!   (the shared contract with `src/lib/params`)
//! - `logparse.rs`   — log line grammar and the phase reducer (pure)
//! - `lockfile.rs`   — Splash's port locks, our pidfile, process checks
//! - `supervisor.rs` — process lifecycle, logs, probes (Tauri-free, tested)
//! - `detect.rs`     — locating the CLI, version, libexec, Homebrew
//! - `system.rs`     — macOS, chip, memory, Metal working set
//! - `secrets.rs`    — the HF token handed to Splash as env
//! - `events.rs`     — state/log payloads and the `engine://*` event names
//! - `commands.rs`   — the `engine_*` Tauri commands

pub mod commands;
pub mod detect;
pub mod events;
pub mod lockfile;
pub mod logparse;
pub mod params;
pub mod secrets;
pub mod supervisor;
pub mod system;

use std::sync::Arc;

use tauri::{AppHandle, Manager};

pub use supervisor::Supervisor;

use crate::transport::SplashTransport;

/// Creates the app's supervisor (pidfile and logs under the app data dir)
/// and, in the background, re-attaches to a server an earlier run left or
/// reports a Splash server already running.
pub fn setup(app: &AppHandle, events: Arc<dyn events::EngineEvents>) -> Supervisor {
    let state_dir = app.path().app_data_dir().ok();
    let supervisor = Supervisor::with_dirs(events, state_dir, lockfile::splash_runtime_dir());
    let init = supervisor.clone();
    let api_key = app
        .try_state::<SplashTransport>()
        .and_then(|t| t.config().api_key);
    tauri::async_runtime::spawn(async move {
        let installed = detect::find_splash(None).is_some();
        init.init_on_launch(installed, api_key).await;
    });
    supervisor
}
