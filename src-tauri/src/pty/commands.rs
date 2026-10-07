//! Tauri commands for terminal sessions and connector detection. The frontend
//! wrapper is `src/lib/terminal/pty.ts`.
//!
//! The webview renders model output, so these commands never run an arbitrary
//! program: `pty_spawn` accepts only the splash CLI and the agent binaries (by
//! name, resolved on the login PATH), and the environment a caller adds may
//! not change how those programs load code (see [`check_env`]).

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use super::connectors::{self, ConnectorDetection, AGENTS};
use super::login_env;
use super::manager::{write_input, PtyExit, PtyManager, PtySessionInfo, PtySink, SpawnSpec};
use crate::error::{AppError, AppResult};

/// Programs `pty_spawn` may start.
pub const ALLOWED_PROGRAMS: &[&str] = &["splash", "claude", "opencode", "codex", "hermes", "pi"];

/// Variables a caller may not set: they change which code a program loads.
const BLOCKED_ENV_PREFIXES: &[&str] = &["DYLD_", "LD_", "PYTHON", "NODE_OPTIONS", "NODE_PATH"];
const BLOCKED_ENV_KEYS: &[&str] = &[
    "PATH", "BASH_ENV", "ENV", "ZDOTDIR", "SHELL", "PERL5OPT", "RUBYOPT",
];

/// Messages on a session's channel: output as raw bytes (an `ArrayBuffer` in
/// JS), then one JSON `{ "event": "exit", "code", "signal" }`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum PtyEvent {
    Exit(PtyExit),
}

struct ChannelSink(Channel<InvokeResponseBody>);

impl PtySink for ChannelSink {
    fn data(&self, bytes: &[u8]) -> bool {
        self.0.send(InvokeResponseBody::Raw(bytes.to_vec())).is_ok()
    }

    fn exit(&self, exit: PtyExit) {
        match serde_json::to_string(&PtyEvent::Exit(exit)) {
            Ok(json) => {
                let _ = self.0.send(InvokeResponseBody::Json(json));
            }
            Err(e) => log::warn!("could not encode a terminal exit: {e}"),
        }
    }
}

/// Keyboard input: text (UTF-8) or raw bytes (xterm's binary mouse reports).
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum PtyInput {
    Text(String),
    Bytes(Vec<u8>),
}

impl PtyInput {
    fn into_bytes(self) -> Vec<u8> {
        match self {
            PtyInput::Text(s) => s.into_bytes(),
            PtyInput::Bytes(b) => b,
        }
    }
}

/// Rejects environment variables that would let a caller inject code.
pub fn check_env(env: &HashMap<String, String>) -> AppResult<()> {
    for (key, value) in env {
        let invalid =
            key.is_empty() || key.contains('=') || key.contains('\0') || value.contains('\0');
        if invalid {
            return Err(AppError::InvalidRequest(format!(
                "invalid environment variable {key:?}"
            )));
        }
        let upper = key.to_ascii_uppercase();
        if BLOCKED_ENV_KEYS.contains(&upper.as_str())
            || BLOCKED_ENV_PREFIXES.iter().any(|p| upper.starts_with(p))
        {
            return Err(AppError::InvalidRequest(format!(
                "the environment variable {key} cannot be set for a terminal session"
            )));
        }
    }
    Ok(())
}

fn check_args(args: &[String]) -> AppResult<()> {
    if args.iter().any(|a| a.contains('\0')) {
        return Err(AppError::InvalidRequest(
            "arguments may not contain NUL".into(),
        ));
    }
    Ok(())
}

/// The full environment a session starts with: login PATH, terminal
/// defaults, then the caller's variables (sorted, for a stable order).
pub fn session_env(env: HashMap<String, String>, path: &OsString) -> Vec<(String, OsString)> {
    let mut out: Vec<(String, OsString)> = vec![("PATH".into(), path.clone())];
    for (k, v) in login_env::terminal_defaults(|k| std::env::var_os(k)) {
        if !env.contains_key(k) {
            out.push((k.to_string(), OsString::from(v)));
        }
    }
    let mut caller: Vec<(String, String)> = env.into_iter().collect();
    caller.sort();
    out.extend(caller.into_iter().map(|(k, v)| (k, OsString::from(v))));
    out
}

/// Resolves an allowlisted program name to its executable.
pub fn resolve_program(program: &str) -> AppResult<PathBuf> {
    if !ALLOWED_PROGRAMS.contains(&program) {
        return Err(AppError::InvalidRequest(format!(
            "{program:?} cannot be run in a terminal session; allowed: {}",
            ALLOWED_PROGRAMS.join(", ")
        )));
    }
    if program == "splash" {
        return connectors::find_splash().ok_or(AppError::SplashNotFound);
    }
    login_env::which(program).ok_or_else(|| {
        AppError::InvalidRequest(format!("{program} is not installed or is not on your PATH"))
    })
}

#[allow(clippy::too_many_arguments)]
async fn spawn_allowed(
    manager: &PtyManager,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
    on_event: Channel<InvokeResponseBody>,
) -> AppResult<PtySessionInfo> {
    check_args(&args)?;
    check_env(&env)?;
    // The first call runs the login shell; keep it off the async workers.
    let (resolved, path) = tokio::task::spawn_blocking(move || {
        resolve_program(&program).map(|p| (p, login_env::login_path().clone()))
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))??;
    let spec = SpawnSpec {
        program: resolved,
        args,
        cwd: cwd.filter(|c| !c.is_empty()).map(PathBuf::from),
        env: session_env(env, &path),
        cols,
        rows,
    };
    manager.spawn(spec, Arc::new(ChannelSink(on_event)))
}

/// Starts an allowlisted program (`splash` or an agent binary) in a new
/// terminal. Output and the exit arrive on `onEvent`.
/// JS: `invoke('pty_spawn', { program, args, cwd?, env, cols, rows, onEvent })`
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn pty_spawn(
    manager: State<'_, PtyManager>,
    program: String,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    cols: u16,
    rows: u16,
    on_event: Channel<InvokeResponseBody>,
) -> AppResult<u32> {
    let info = spawn_allowed(
        &manager,
        program,
        args.unwrap_or_default(),
        cwd,
        env.unwrap_or_default(),
        cols,
        rows,
        on_event,
    )
    .await?;
    Ok(info.id)
}

/// Runs `splash <args...>` in a new terminal: agent connectors
/// (`splash claude ...`) and the "run any splash command" escape hatch.
/// JS: `invoke('pty_spawn_splash', { args, cwd?, env, cols, rows, onEvent })`
#[tauri::command]
pub async fn pty_spawn_splash(
    manager: State<'_, PtyManager>,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    cols: u16,
    rows: u16,
    on_event: Channel<InvokeResponseBody>,
) -> AppResult<u32> {
    let info = spawn_allowed(
        &manager,
        "splash".into(),
        args,
        cwd,
        env.unwrap_or_default(),
        cols,
        rows,
        on_event,
    )
    .await?;
    Ok(info.id)
}

/// JS: `invoke('pty_write', { id, data })`, `data` a string or a byte array.
#[tauri::command]
pub async fn pty_write(manager: State<'_, PtyManager>, id: u32, data: PtyInput) -> AppResult<()> {
    let writer = manager.writer(id)?;
    let bytes = data.into_bytes();
    // A program that is not reading can block the write; keep that off the
    // async workers.
    tokio::task::spawn_blocking(move || write_input(&writer, &bytes))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

/// JS: `invoke('pty_resize', { id, cols, rows })`
#[tauri::command]
pub async fn pty_resize(
    manager: State<'_, PtyManager>,
    id: u32,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    manager.resize(id, cols, rows)
}

/// Hangs up the session (SIGKILL after 2 s). The exit arrives on its channel.
/// JS: `invoke('pty_kill', { id })`
#[tauri::command]
pub async fn pty_kill(manager: State<'_, PtyManager>, id: u32) -> AppResult<()> {
    manager.kill(id)
}

/// JS: `invoke('pty_list')`
#[tauri::command]
pub async fn pty_list(manager: State<'_, PtyManager>) -> AppResult<Vec<PtySessionInfo>> {
    Ok(manager.list())
}

/// Which agents are installed, with versions, on the login PATH.
/// JS: `invoke('connectors_detect')`
#[tauri::command]
pub async fn connectors_detect() -> AppResult<ConnectorDetection> {
    let (path, splash) = tokio::task::spawn_blocking(|| {
        (login_env::login_path().clone(), connectors::find_splash())
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;
    let cwd = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let agents = connectors::detect_all(&path, &cwd).await;
    debug_assert_eq!(agents.len(), AGENTS.len());
    Ok(ConnectorDetection {
        agents,
        splash_path: splash.map(|p| p.to_string_lossy().into_owned()),
        search_path: path.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn allows_connector_env() {
        let ok = env(&[
            ("SPLASH_PORT", "8000"),
            ("NO_PROXY", "127.0.0.1,localhost"),
            ("no_proxy", "127.0.0.1,localhost"),
            ("SPLASH_API_KEY", "k"),
            ("OPENCODE_CONFIG_CONTENT", "{\"a\":1}"),
            ("HERMES_HOME", "/tmp/h"),
            ("PI_CODING_AGENT_DIR", "/tmp/p"),
            ("CLAUDE_CODE_MAX_OUTPUT_TOKENS", "64000"),
        ]);
        assert!(check_env(&ok).is_ok());
    }

    #[test]
    fn blocks_code_loading_env() {
        for key in [
            "DYLD_INSERT_LIBRARIES",
            "LD_PRELOAD",
            "PYTHONPATH",
            "PYTHONSTARTUP",
            "NODE_OPTIONS",
            "PATH",
            "path",
            "BASH_ENV",
            "ZDOTDIR",
        ] {
            assert!(check_env(&env(&[(key, "x")])).is_err(), "{key}");
        }
        assert!(check_env(&env(&[("", "x")])).is_err());
        assert!(check_env(&env(&[("A=B", "x")])).is_err());
        assert!(check_env(&env(&[("A", "x\0y")])).is_err());
    }

    #[test]
    fn only_allowlisted_programs_resolve() {
        for program in [
            "/bin/sh",
            "sh",
            "bash",
            "../splash",
            "/opt/homebrew/bin/splash",
            "",
        ] {
            let err = resolve_program(program).expect_err(program);
            assert_eq!(err.kind(), "invalidRequest", "{program}");
        }
    }

    #[test]
    fn session_env_puts_path_first_and_caller_wins() {
        let out = session_env(
            env(&[("TERM", "dumb"), ("SPLASH_PORT", "8001")]),
            &OsString::from("/x/bin"),
        );
        assert_eq!(out[0], ("PATH".to_string(), OsString::from("/x/bin")));
        let terms: Vec<_> = out.iter().filter(|(k, _)| k == "TERM").collect();
        assert_eq!(terms.len(), 1);
        assert_eq!(terms[0].1, OsString::from("dumb"));
        assert!(out.iter().any(|(k, v)| k == "SPLASH_PORT" && v == "8001"));
        assert!(out.iter().any(|(k, _)| k == "COLORTERM"));
    }

    #[test]
    fn exit_event_serializes_for_the_frontend() {
        let json = serde_json::to_value(PtyEvent::Exit(PtyExit {
            code: Some(130),
            signal: None,
        }))
        .expect("json");
        assert_eq!(
            json,
            serde_json::json!({ "event": "exit", "code": 130, "signal": null })
        );
    }

    #[test]
    fn input_accepts_text_or_bytes() {
        let text: PtyInput = serde_json::from_value(serde_json::json!("ls\r")).expect("text");
        assert_eq!(text.into_bytes(), b"ls\r".to_vec());
        let bytes: PtyInput =
            serde_json::from_value(serde_json::json!([27, 91, 77, 200])).expect("bytes");
        assert_eq!(bytes.into_bytes(), vec![27, 91, 77, 200]);
    }
}
