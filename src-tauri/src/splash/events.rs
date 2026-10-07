//! Engine state and log types, and how they reach the UI.
//!
//! Tauri events (frontend: `src/lib/splash/engine.ts`):
//! - `engine://state` with an [`EngineState`] payload on every change.
//! - `engine://log` with a [`LogLine`] payload for each stdout/stderr line.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::params::RenderedServe;

pub const EVENT_STATE: &str = "engine://state";
pub const EVENT_LOG: &str = "engine://log";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    /// The Hugging Face repo being fetched (from the `Fetching` line).
    pub repo: String,
    pub files: u32,
    /// Announced size of the files still to fetch.
    pub total_bytes: u64,
    /// Bytes added to the HF cache since the `Fetching` line.
    pub done_bytes: u64,
    /// 0..=1, or `None` when the total is unknown.
    pub fraction: Option<f64>,
}

/// The lifecycle phase. Serialized flat into [`EngineState`] as
/// `phase: "<snake_case>"` plus the variant's own fields.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "phase",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Phase {
    /// No `splash` CLI was found.
    NotInstalled,
    /// Nothing is running (initial state, or after a requested stop).
    Stopped,
    /// Spawned; the launcher is checking/installing the model.
    Starting,
    /// The installer is fetching files (`Fetching N file(s), X GB ...`).
    Downloading { progress: Option<DownloadProgress> },
    /// `Loading · <model>` until the weights are in memory.
    LoadingWeights,
    /// `Weights loaded in` / `Kernel policy`: kernels and warmup, no HTTP yet.
    Warming,
    /// Listening; `/ready` 200; nothing in flight.
    Ready,
    /// Requests are prefilling/decoding/queued (from `/status`).
    Busy,
    /// `Weights released after 600 s without a request` (1.2).
    IdleReleased,
    /// A request arrived while released; weights are being restored.
    Restoring,
    /// The native engine failed and Splash is relaunching it (`/ready` 503).
    Recovering { reason: Option<String> },
    /// A stop was requested; waiting for the process to exit.
    Stopping,
    /// Exited unexpectedly, could not start, or Splash gave up on its engine.
    Failed {
        reason: String,
        exit_code: Option<i32>,
        signal: Option<i32>,
        last_log_lines: Vec<String>,
    },
    /// A server this app did not start holds the port (see `external`).
    External {
        /// True when Splash's own port lock is held (vs. any other program).
        splash: bool,
        /// Started by an earlier Splashboard session (our pidfile).
        previous_session: bool,
        /// `/ready` answered 200 at the last probe.
        ready: bool,
    },
}

impl Phase {
    pub fn name(&self) -> &'static str {
        match self {
            Phase::NotInstalled => "not_installed",
            Phase::Stopped => "stopped",
            Phase::Starting => "starting",
            Phase::Downloading { .. } => "downloading",
            Phase::LoadingWeights => "loading_weights",
            Phase::Warming => "warming",
            Phase::Ready => "ready",
            Phase::Busy => "busy",
            Phase::IdleReleased => "idle_released",
            Phase::Restoring => "restoring",
            Phase::Recovering { .. } => "recovering",
            Phase::Stopping => "stopping",
            Phase::Failed { .. } => "failed",
            Phase::External { .. } => "external",
        }
    }
}

/// Who runs the server the state describes.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Owner {
    /// Nothing is running.
    None,
    /// Spawned by this app run.
    App,
    /// Started elsewhere (or by an earlier app run) and adopted: polled and
    /// stoppable, but its exit code is unknown.
    Adopted,
    /// Seen on the port, not adopted.
    External,
}

/// Parsed from the `Ready · <model> · context <N> · <url>` line.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadyInfo {
    pub context: Option<String>,
    pub context_tokens: Option<u64>,
    pub language_only: bool,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExitSummary {
    pub code: Option<i32>,
    pub signal: Option<i32>,
    /// True when the app asked it to stop.
    pub requested: bool,
    pub at_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineState {
    #[serde(flatten)]
    pub phase: Phase,
    /// Same value as `phase`; kept for older readers.
    pub status: &'static str,
    pub owner: Owner,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub model: Option<String>,
    /// When the current phase was entered.
    pub since_ms: u64,
    pub started_at_ms: Option<u64>,
    pub ready_at_ms: Option<u64>,
    pub ready_info: Option<ReadyInfo>,
    /// The command that was run (secrets redacted); `None` when not ours.
    pub command: Option<RenderedServe>,
    /// Automatic restarts after crashes in this run.
    pub restarts: u32,
    pub last_exit: Option<ExitSummary>,
}

impl EngineState {
    pub fn new(phase: Phase) -> Self {
        Self {
            status: phase.name(),
            phase,
            owner: Owner::None,
            pid: None,
            port: None,
            model: None,
            since_ms: now_ms(),
            started_at_ms: None,
            ready_at_ms: None,
            ready_info: None,
            command: None,
            restarts: 0,
            last_exit: None,
        }
    }

    /// Moves to `phase`, keeping the rest. `since_ms` only changes when the
    /// phase name changes (progress updates keep it).
    pub fn enter(&mut self, phase: Phase) {
        if phase.name() != self.phase.name() {
            self.since_ms = now_ms();
        }
        self.status = phase.name();
        self.phase = phase;
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
    /// Lines the supervisor writes itself (the command line, signals sent).
    System,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    /// Monotonic per app run; lets the UI merge the backlog with live events.
    pub seq: u64,
    pub stream: LogStream,
    pub line: String,
    pub ts_ms: u64,
    /// Set when this line moved the engine to a new phase (its name).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<&'static str>,
}

/// A Splash server found through its port lock (`serve-<port>.lock`).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalServer {
    pub port: u16,
    pub pid: Option<u32>,
    pub model: Option<String>,
    /// The lock is held (a live `splash serve` owns the port).
    pub lock_held: bool,
    /// The pid's command line is a Splash server or launcher.
    pub is_splash: bool,
    /// Started by an earlier Splashboard session (our pidfile).
    pub previous_session: bool,
    /// `/ready` answered 200.
    pub ready: bool,
}

/// Where the supervisor reports to. Tauri in the app, a recorder in tests.
pub trait EngineEvents: Send + Sync + 'static {
    fn state(&self, state: &EngineState);
    fn log(&self, line: &LogLine);
}

pub struct TauriEngineEvents {
    app: AppHandle,
}

impl TauriEngineEvents {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl EngineEvents for TauriEngineEvents {
    fn state(&self, state: &EngineState) {
        if let Err(error) = self.app.emit(EVENT_STATE, state) {
            log::warn!("could not emit {EVENT_STATE}: {error}");
        }
    }

    fn log(&self, line: &LogLine) {
        // Ignored on failure: there is no one to tell.
        let _ = self.app.emit(EVENT_LOG, line);
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_serializes_flat_with_phase_fields() {
        let mut state = EngineState::new(Phase::Stopped);
        state.enter(Phase::Failed {
            reason: "boom".into(),
            exit_code: Some(1),
            signal: None,
            last_log_lines: vec!["error: boom".into()],
        });
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["phase"], "failed");
        assert_eq!(json["status"], "failed");
        assert_eq!(json["reason"], "boom");
        assert_eq!(json["exitCode"], 1);
        assert_eq!(json["lastLogLines"][0], "error: boom");
        assert_eq!(json["owner"], "none");

        state.enter(Phase::IdleReleased);
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["phase"], "idle_released");
        assert!(json.get("reason").is_none());

        state.enter(Phase::Downloading { progress: None });
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["phase"], "downloading");
        assert!(json["progress"].is_null());
    }

    #[test]
    fn log_line_phase_is_optional() {
        let line = LogLine {
            seq: 1,
            stream: LogStream::Stdout,
            line: "x".into(),
            ts_ms: 2,
            phase: None,
        };
        let json = serde_json::to_value(&line).unwrap();
        assert!(json.get("phase").is_none());
        assert_eq!(json["tsMs"], 2);
    }
}
