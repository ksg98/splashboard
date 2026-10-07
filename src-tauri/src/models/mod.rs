//! Models without a terminal: the catalog, installed models, downloads with
//! progress, verification, removal and the Hugging Face token
//! (docs/terminal-parity.md section 2.2).
//!
//! - `ids.rs`       — model ID validation, selection links, pin folders (ported from Splash)
//! - `hfcache.rs`   — reading the Hugging Face hub cache
//! - `catalog.rs`   — official/suggested/documented models, Hub sizes, GGUF variants
//! - `installed.rs` — installations under Splash's models folder + supported cache repos
//! - `progress.rs`  — download progress measured on disk
//! - `download.rs`  — `install/models.py prepare|verify` as cancellable jobs
//! - `remove.rs`    — dry-run and removal, confined to the models folder and hub cache
//! - `locks.rs`     — Splash's flock-based locks
//! - `token.rs`     — the Hugging Face token file (never returned or logged)
//! - `commands.rs`  — the `models_*` / `hf_token_*` Tauri commands
//!
//! Events: `models://progress` ([`progress::ModelProgress`]) and
//! `models://log` ([`download::ModelLog`]). Frontend: `src/lib/models/`.

pub mod catalog;
pub mod commands;
pub mod download;
pub mod hfcache;
pub mod ids;
pub mod installed;
pub mod locks;
pub mod progress;
pub mod remove;
pub mod token;
