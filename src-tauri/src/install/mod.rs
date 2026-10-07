//! Installing, upgrading and removing Splash through Homebrew, without a
//! terminal (docs/terminal-parity.md section 2.1).
//!
//! - `error.rs`    — [`OpError`], the error both `install_*` and `models_*`
//!   commands return (`{ kind, message, command?, url? }`)
//! - `runner.rs`   — a streamed child process in its own process group, with
//!   cancel (SIGINT -> SIGTERM -> SIGKILL); shared with model downloads
//! - `brew.rs`     — Homebrew and Splash detection, `brew info`, GitHub
//!   releases, version comparison, running servers
//! - `job.rs`      — `brew install|upgrade|uninstall` as one cancellable job
//!   streaming `install://progress`
//! - `commands.rs` — the `install_*` Tauri commands
//!
//! Frontend: `src/lib/install/`.

pub mod brew;
pub mod commands;
pub mod error;
pub mod job;
pub mod runner;

#[cfg(test)]
pub(crate) mod testutil;

pub use error::{OpError, OpResult};

/// Milliseconds since the Unix epoch.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}
