//! Embedded terminals: pseudo-terminal sessions for coding agents
//! (`splash claude|opencode|codex|hermes|pi`) and any `splash` command, so no
//! Terminal.app is needed.
//!
//! - `login_env`: the user's login-shell PATH (Finder-launched apps lack it).
//! - `manager`: concurrent PTY sessions, output over a sink, kill-on-exit.
//! - `connectors`: which agents are installed, with versions.
//! - `commands`: the Tauri commands (`pty_*`, `connectors_detect`).

pub mod commands;
pub mod connectors;
pub mod login_env;
pub mod manager;

pub use manager::PtyManager;
