//! Owns the `splash serve` lifecycle.
//!
//! - The child runs in its own process group (pgid = pid), so a stop reaches
//!   Splash's helper processes too, and a Ctrl+C in the terminal running
//!   `pnpm dev` does not kill the engine behind the app's back.
//! - Its stdout/stderr go to two files (not pipes) that are tailed. A pipe
//!   would break when the app quits or crashes (Splash's next log write
//!   fails, and its native engine dies of SIGPIPE); files let the server
//!   outlive the app and a later run re-attach and keep reading the log.
//! - Lines (split on `\n` and `\r`, so progress bars become lines) drive the
//!   phase machine in `logparse.rs`; a monitor task adds what logs cannot
//!   show: readiness (TCP connect <= 0.9 s, then `GET /ready`; Splash serves
//!   no HTTP before Ready), busy/recovering/released from `GET /status`,
//!   download progress, and liveness of servers we did not spawn.
//! - Stop sends SIGINT (Splash's documented way to stop serving), then
//!   SIGTERM, then SIGKILL, waiting in between.
//! - A pidfile in the app data dir records the server we spawned so a new
//!   app run can re-attach (`init_on_launch`, `adopt`) or stop it.
//! - Servers found through Splash's own port lock are shown as `external`
//!   and can be adopted or stopped (after checking the pid is Splash).
//!
//! Nothing here depends on a running Tauri app: events go through
//! [`EngineEvents`], so the tests below drive real processes without one.

use std::collections::VecDeque;
use std::ffi::OsString;
use std::io::{SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use nix::sys::signal::{kill, killpg, Signal};
use nix::unistd::{getpgid, Pid};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::process::Command;
use tokio::sync::watch;

use super::events::{
    now_ms, DownloadProgress, EngineEvents, EngineState, ExitSummary, ExternalServer, LogLine,
    LogStream, Owner, Phase, ReadyInfo,
};
use super::lockfile::{self, LockOwner, PidFile, PortStatus};
use super::logparse::{self, LogEvent};
use super::params::RenderedServe;
use crate::error::{AppError, AppResult};

const LOG_CAPACITY: usize = 4000;
const MAX_LINE_BYTES: usize = 16 * 1024;
/// Lines attached to a `failed` state.
pub const FAILURE_LINES: usize = 50;
const TAIL_INTERVAL: Duration = Duration::from_millis(100);
const MONITOR_INTERVAL: Duration = Duration::from_millis(750);
/// Splash binds early but listens only once Ready: a connect hangs until
/// then, so the probe must give up quickly.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(900);
const PIDFILE_NAME: &str = "engine.pid";

/// What to run. Built from a `ServeRequest` by the command layer; tests build
/// it directly with a stand-in program.
#[derive(Debug, Clone)]
pub struct SpawnSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub model: String,
    /// The port the server will listen on; must be free before spawning.
    pub port: u16,
    /// Probe `/ready` and `/status` on `port`. False for stand-ins.
    pub probe: bool,
    /// Sent to `/status` (which needs the key when one is set).
    pub api_key: Option<String>,
    /// The HF hub cache, for download progress.
    pub hf_cache: Option<PathBuf>,
    /// The rendered command (secrets redacted), for the UI and the pidfile.
    pub command: Option<RenderedServe>,
}

/// Supervisor behaviour the UI can change (`engine_configure`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SupervisorSettings {
    /// Restart after an unexpected exit of a server that had reached Ready.
    /// Never after a requested stop or a launcher error. Off by default.
    pub auto_restart: bool,
    /// At most this many automatic restarts ...
    pub max_restarts: u32,
    /// ... within this window.
    pub restart_window_secs: u64,
    /// First backoff; doubles per restart in the window, capped at 30 s.
    pub restart_backoff_ms: u64,
    /// Time between SIGINT and SIGTERM on a user stop.
    pub stop_grace_secs: u64,
    /// Leave a server we started running when the app quits.
    pub keep_running_on_quit: bool,
}

impl Default for SupervisorSettings {
    fn default() -> Self {
        Self {
            auto_restart: false,
            max_restarts: 3,
            restart_window_secs: 300,
            restart_backoff_ms: 1000,
            stop_grace_secs: 20,
            keep_running_on_quit: false,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct StopTimeouts {
    pub after_sigint: Duration,
    pub after_sigterm: Duration,
    pub after_sigkill: Duration,
}

impl StopTimeouts {
    /// For a user-requested stop: give Splash time to unload cleanly.
    pub fn graceful(grace_secs: u64) -> Self {
        Self {
            after_sigint: Duration::from_secs(grace_secs.max(1)),
            after_sigterm: Duration::from_secs(5),
            after_sigkill: Duration::from_secs(2),
        }
    }
    /// For app exit, where the window is already closing.
    pub const ON_EXIT: Self = Self {
        after_sigint: Duration::from_secs(4),
        after_sigterm: Duration::from_secs(2),
        after_sigkill: Duration::from_secs(1),
    };
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ExitInfo {
    code: Option<i32>,
    signal: Option<i32>,
}

enum Tracking {
    /// A child this app run spawned.
    Child {
        pid: u32,
        stop_requested: bool,
        ever_ready: bool,
        exit_rx: watch::Receiver<Option<ExitInfo>>,
    },
    /// A server found on a port (Splash lock or our old pidfile).
    Attached {
        pid: Option<u32>,
        port: u16,
        adopted: bool,
        previous_session: bool,
        stop_requested: bool,
        logs: Option<(PathBuf, PathBuf)>,
        api_key: Option<String>,
        done_tx: Option<watch::Sender<bool>>,
    },
}

struct DownloadWatch {
    generation: u64,
    blobs: PathBuf,
    baseline: u64,
}

struct Inner {
    state: EngineState,
    generation: u64,
    tracking: Option<Tracking>,
    /// `seq` of the first log line of the current generation.
    gen_first_seq: u64,
    logs: VecDeque<LogLine>,
    next_seq: u64,
    settings: SupervisorSettings,
    last_spec: Option<SpawnSpec>,
    restart_history: VecDeque<Instant>,
    restarts: u32,
    hf_cache: Option<PathBuf>,
    download: Option<DownloadWatch>,
}

struct Paths {
    /// App data dir: pidfile, logs. `None` in tests that do not need them.
    state_dir: Option<PathBuf>,
    /// Splash's runtime dir (port locks).
    runtime_dir: Option<PathBuf>,
    /// Where child output files go.
    log_dir: PathBuf,
    /// Every line of this app run, for "save log".
    session_log: Option<PathBuf>,
}

#[derive(Clone)]
pub struct Supervisor {
    inner: Arc<Mutex<Inner>>,
    /// Serializes `start` so two concurrent calls cannot both spawn.
    start_guard: Arc<Mutex<()>>,
    session_file: Arc<Mutex<Option<std::fs::File>>>,
    events: Arc<dyn EngineEvents>,
    http: reqwest::Client,
    paths: Arc<Paths>,
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Supervisor {
    pub fn with_dirs(
        events: Arc<dyn EngineEvents>,
        state_dir: Option<PathBuf>,
        runtime_dir: Option<PathBuf>,
    ) -> Self {
        let http = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap_or_default();
        let log_dir = match &state_dir {
            Some(dir) => dir.join("logs"),
            None => std::env::temp_dir().join(format!("splashboard-engine-{}", std::process::id())),
        };
        let session_log = state_dir
            .as_ref()
            .map(|_| log_dir.join(format!("session-{}.log", now_ms())));
        let session_file = session_log.as_ref().and_then(|path| {
            std::fs::create_dir_all(&log_dir).ok()?;
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .ok()
        });
        Self {
            inner: Arc::new(Mutex::new(Inner {
                state: EngineState::new(Phase::Stopped),
                generation: 0,
                tracking: None,
                gen_first_seq: 0,
                logs: VecDeque::with_capacity(LOG_CAPACITY),
                next_seq: 0,
                settings: SupervisorSettings::default(),
                last_spec: None,
                restart_history: VecDeque::new(),
                restarts: 0,
                hf_cache: None,
                download: None,
            })),
            start_guard: Arc::new(Mutex::new(())),
            session_file: Arc::new(Mutex::new(session_file)),
            events,
            http,
            paths: Arc::new(Paths {
                state_dir,
                runtime_dir,
                log_dir,
                session_log,
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        lock_recover(&self.inner)
    }

    pub fn state(&self) -> EngineState {
        self.lock().state.clone()
    }

    pub fn logs(&self) -> Vec<LogLine> {
        self.lock().logs.iter().cloned().collect()
    }

    pub fn settings(&self) -> SupervisorSettings {
        self.lock().settings
    }

    pub fn configure(&self, settings: SupervisorSettings) -> SupervisorSettings {
        self.lock().settings = settings;
        settings
    }

    /// The last spec started (for `engine_restart` without new options).
    pub fn last_spec(&self) -> Option<SpawnSpec> {
        self.lock().last_spec.clone()
    }

    fn pidfile_path(&self) -> Option<PathBuf> {
        self.paths.state_dir.as_ref().map(|d| d.join(PIDFILE_NAME))
    }

    /// Records whether the CLI exists: `stopped` <-> `not_installed` when
    /// nothing is running.
    pub fn note_install(&self, found: bool) {
        let changed = {
            let mut inner = self.lock();
            if inner.tracking.is_some() {
                None
            } else {
                match (&inner.state.phase, found) {
                    (Phase::Stopped, false) => {
                        inner.state.enter(Phase::NotInstalled);
                        Some(inner.state.clone())
                    }
                    (Phase::NotInstalled, true) => {
                        inner.state.enter(Phase::Stopped);
                        Some(inner.state.clone())
                    }
                    _ => None,
                }
            }
        };
        if let Some(state) = changed {
            self.events.state(&state);
        }
    }

    // ---------------------------------------------------------------- start

    /// Starts `spec` unless the port is taken. A port held by Splash's own
    /// lock is not an error: the server there is reported as `external` (and
    /// polled) so the UI can adopt or stop it. Must run inside Tokio.
    pub fn start(&self, spec: SpawnSpec) -> AppResult<EngineState> {
        let _guard = lock_recover(&self.start_guard);
        {
            let mut inner = self.lock();
            match &inner.tracking {
                Some(Tracking::Child { pid, .. }) => return Err(AppError::AlreadyRunning(*pid)),
                Some(Tracking::Attached {
                    adopted: true, pid, ..
                }) => return Err(AppError::AlreadyRunning(pid.unwrap_or_default())),
                _ => {}
            }
            inner.restarts = 0;
            inner.restart_history.clear();
        }
        self.start_unguarded(spec)
    }

    fn start_unguarded(&self, spec: SpawnSpec) -> AppResult<EngineState> {
        match lockfile::port_status(self.paths.runtime_dir.as_deref(), spec.port) {
            PortStatus::Free => self.spawn(spec),
            PortStatus::Splash(owner) => {
                self.push_system(format!(
                    "port {} is held by a running Splash server{}; not starting another",
                    spec.port,
                    owner
                        .as_ref()
                        .map(|o| format!(" (pid {}, model {})", o.pid, o.model))
                        .unwrap_or_default()
                ));
                Ok(self.observe_external(spec.port, owner, false, None, spec.api_key.clone()))
            }
            PortStatus::Busy => Err(AppError::PortInUse(spec.port)),
        }
    }

    fn spawn(&self, spec: SpawnSpec) -> AppResult<EngineState> {
        std::fs::create_dir_all(&self.paths.log_dir)?;
        let stdout_path = self
            .paths
            .log_dir
            .join(format!("serve-{}.stdout.log", spec.port));
        let stderr_path = self
            .paths
            .log_dir
            .join(format!("serve-{}.stderr.log", spec.port));
        let stdout_file = std::fs::File::create(&stdout_path)?;
        let stderr_file = std::fs::File::create(&stderr_path)?;

        {
            let mut inner = self.lock();
            inner.gen_first_seq = inner.next_seq;
        }
        let shown = spec
            .command
            .as_ref()
            .map(|c| c.command.clone())
            .unwrap_or_else(|| format!("{} {}", spec.program.display(), spec.args.join(" ")));
        self.push_system(format!("$ {shown}"));

        let mut command = Command::new(&spec.program);
        command
            .args(&spec.args)
            .env("PATH", augmented_path())
            .envs(spec.env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file))
            .process_group(0)
            .kill_on_drop(false);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let message = format!("could not start {}: {error}", spec.program.display());
                self.push_system(message.clone());
                let state = {
                    let mut inner = self.lock();
                    inner.generation += 1;
                    let lines = recent_lines(&inner, FAILURE_LINES);
                    inner.state.enter(Phase::Failed {
                        reason: message.clone(),
                        exit_code: None,
                        signal: None,
                        last_log_lines: lines,
                    });
                    inner.state.owner = Owner::None;
                    inner.state.pid = None;
                    inner.state.clone()
                };
                self.events.state(&state);
                return Err(AppError::Other(message));
            }
        };
        let Some(pid) = child.id() else {
            return Err(AppError::Other("the engine exited at once".into()));
        };
        let (exit_tx, exit_rx) = watch::channel(None);
        let (done_tx, done_rx) = watch::channel(false);
        let started_at = now_ms();

        let (generation, state) = {
            let mut inner = self.lock();
            inner.generation += 1;
            inner.tracking = Some(Tracking::Child {
                pid,
                stop_requested: false,
                ever_ready: false,
                exit_rx,
            });
            inner.hf_cache = spec.hf_cache.clone();
            inner.download = None;
            let restarts = inner.restarts;
            let mut state = EngineState::new(Phase::Starting);
            state.owner = Owner::App;
            state.pid = Some(pid);
            state.port = Some(spec.port);
            state.model = Some(spec.model.clone());
            state.started_at_ms = Some(started_at);
            state.command = spec.command.as_ref().map(RenderedServe::redacted);
            state.restarts = restarts;
            state.last_exit = inner.state.last_exit;
            inner.state = state;
            inner.last_spec = Some(spec.clone());
            (inner.generation, inner.state.clone())
        };

        if let Some(path) = self.pidfile_path() {
            let record = PidFile {
                pid,
                port: spec.port,
                model: spec.model.clone(),
                started_at_ms: started_at,
                stdout_log: Some(stdout_path.clone()),
                stderr_log: Some(stderr_path.clone()),
                command: spec.command.as_ref().map(|c| c.command.clone()),
            };
            if let Err(error) = lockfile::write_pidfile(&path, &record) {
                self.push_system(format!("could not write {}: {error}", path.display()));
            }
        }
        self.events.state(&state);

        let tails = [
            tokio::spawn(self.clone().tail(
                generation,
                stdout_path,
                LogStream::Stdout,
                done_rx.clone(),
            )),
            tokio::spawn(
                self.clone()
                    .tail(generation, stderr_path, LogStream::Stderr, done_rx),
            ),
        ];

        let this = self.clone();
        tokio::spawn(async move {
            let info = match child.wait().await {
                Ok(status) => {
                    use std::os::unix::process::ExitStatusExt;
                    ExitInfo {
                        code: status.code(),
                        signal: status.signal(),
                    }
                }
                Err(error) => {
                    this.push_system(format!("waiting for the engine failed: {error}"));
                    ExitInfo {
                        code: None,
                        signal: None,
                    }
                }
            };
            // Drain the last lines (often the error) before judging the exit.
            let _ = done_tx.send(true);
            for tail in tails {
                let _ = tail.await;
            }
            this.on_child_exit(generation, info);
            let _ = exit_tx.send(Some(info));
        });

        tokio::spawn(
            self.clone()
                .monitor(generation, spec.port, spec.probe, spec.api_key.clone()),
        );
        Ok(state)
    }

    // ------------------------------------------------------------ external

    /// Shows a server we did not spawn as `external` and watches it.
    pub fn observe_external(
        &self,
        port: u16,
        owner: Option<LockOwner>,
        previous_session: bool,
        logs: Option<(PathBuf, PathBuf)>,
        api_key: Option<String>,
    ) -> EngineState {
        let pid = owner.as_ref().map(|o| o.pid);
        let (generation, state) = {
            let mut inner = self.lock();
            inner.generation += 1;
            inner.gen_first_seq = inner.next_seq;
            inner.tracking = Some(Tracking::Attached {
                pid,
                port,
                adopted: false,
                previous_session,
                stop_requested: false,
                logs,
                api_key: api_key.clone(),
                done_tx: None,
            });
            let mut state = EngineState::new(Phase::External {
                splash: true,
                previous_session,
                ready: false,
            });
            state.owner = Owner::External;
            state.pid = pid;
            state.port = Some(port);
            state.model = owner.map(|o| o.model);
            state.last_exit = inner.state.last_exit;
            inner.state = state;
            (inner.generation, inner.state.clone())
        };
        self.events.state(&state);
        tokio::spawn(self.clone().monitor(generation, port, true, api_key));
        state
    }

    /// Adopts the external server (the one shown, or the Splash server on
    /// `port`): it becomes the engine the UI controls. Its log is followed
    /// when it was started by an earlier app run.
    pub async fn adopt(
        &self,
        port: Option<u16>,
        api_key: Option<String>,
    ) -> AppResult<EngineState> {
        let current_port = {
            let inner = self.lock();
            match &inner.tracking {
                Some(Tracking::Attached {
                    port: p,
                    adopted: false,
                    ..
                }) if port.is_none() || port == Some(*p) => Some(*p),
                Some(Tracking::Attached {
                    port: p,
                    adopted: true,
                    ..
                }) if port.is_none() || port == Some(*p) => return Ok(inner.state.clone()),
                Some(Tracking::Child { pid, .. }) => return Err(AppError::AlreadyRunning(*pid)),
                _ => None,
            }
        };
        if current_port.is_none() {
            let Some(port) = port else {
                return Err(AppError::NotRunning);
            };
            match lockfile::port_status(self.paths.runtime_dir.as_deref(), port) {
                PortStatus::Splash(owner) => {
                    self.observe_external(port, owner, false, None, api_key.clone());
                }
                PortStatus::Busy => return Err(AppError::PortInUse(port)),
                PortStatus::Free => return Err(AppError::NotRunning),
            }
        }

        let (generation, pid, logs) = {
            let inner = self.lock();
            match &inner.tracking {
                Some(Tracking::Attached { pid, logs, .. }) => {
                    (inner.generation, *pid, logs.clone())
                }
                _ => return Err(AppError::NotRunning),
            }
        };
        if let Some(pid) = pid {
            if !lockfile::is_splash_process(pid) {
                return Err(AppError::NotSplash(pid));
            }
        }

        let (done_tx, done_rx) = watch::channel(false);
        let state = {
            let mut inner = self.lock();
            if inner.generation != generation {
                return Err(AppError::NotRunning);
            }
            if let Some(Tracking::Attached {
                adopted,
                done_tx: slot,
                api_key: key,
                ..
            }) = inner.tracking.as_mut()
            {
                *adopted = true;
                *slot = Some(done_tx);
                if api_key.is_some() {
                    *key = api_key.clone();
                }
            }
            inner.state.owner = Owner::Adopted;
            inner.state.started_at_ms = None;
            inner.state.enter(Phase::Starting);
            inner.state.clone()
        };
        self.events.state(&state);
        self.push_system(format!(
            "adopted the Splash server on port {}{}",
            state.port.unwrap_or_default(),
            pid.map(|p| format!(" (pid {p})")).unwrap_or_default()
        ));
        if let Some((stdout, stderr)) = logs {
            tokio::spawn(
                self.clone()
                    .tail(generation, stdout, LogStream::Stdout, done_rx.clone()),
            );
            tokio::spawn(
                self.clone()
                    .tail(generation, stderr, LogStream::Stderr, done_rx),
            );
        }
        // Settle the phase now rather than one monitor tick later.
        if let Some(port) = state.port {
            if self.probe_ready(port).await == Some(true) {
                self.transition_if(generation, logparse::is_pre_ready, Phase::Ready);
            }
        }
        Ok(self.state())
    }

    /// Every port whose Splash lock is held, with what we know about it.
    pub async fn discover(&self) -> Vec<ExternalServer> {
        let Some(dir) = self.paths.runtime_dir.clone() else {
            return Vec::new();
        };
        let ours = self
            .pidfile_path()
            .and_then(|p| lockfile::read_pidfile(&p))
            .map(|p| p.pid);
        let mut out = Vec::new();
        for (port, owner) in lockfile::held_locks(&dir) {
            let pid = owner.as_ref().map(|o| o.pid);
            out.push(ExternalServer {
                port,
                pid,
                model: owner.as_ref().map(|o| o.model.clone()),
                lock_held: true,
                is_splash: pid.is_some_and(lockfile::is_splash_process),
                previous_session: pid.is_some() && pid == ours,
                ready: self.probe_ready(port).await == Some(true),
            });
        }
        out
    }

    /// On app launch: re-attach to the server an earlier run left (pidfile),
    /// else show any running Splash server, else `stopped`/`not_installed`.
    pub async fn init_on_launch(&self, installed: bool, api_key: Option<String>) -> EngineState {
        if self.lock().tracking.is_some() {
            return self.state();
        }
        if let Some(path) = self.pidfile_path() {
            if let Some(record) = lockfile::read_pidfile(&path) {
                if lockfile::pid_alive(record.pid) && lockfile::is_splash_process(record.pid) {
                    let logs = record.stdout_log.clone().zip(record.stderr_log.clone());
                    self.push_system(format!(
                        "found the Splash server started by an earlier session (pid {}, port {})",
                        record.pid, record.port
                    ));
                    return self.observe_external(
                        record.port,
                        Some(LockOwner {
                            pid: record.pid,
                            model: record.model,
                            port: record.port,
                        }),
                        true,
                        logs,
                        api_key,
                    );
                }
                lockfile::remove_pidfile(&path);
            }
        }
        if let Some(dir) = self.paths.runtime_dir.clone() {
            if let Some((port, owner)) = lockfile::held_locks(&dir).into_iter().next() {
                return self.observe_external(port, owner, false, None, api_key);
            }
        }
        self.note_install(installed);
        self.state()
    }

    // ----------------------------------------------------------------- stop

    /// Stops the engine we run (spawned or adopted); returns the final state.
    /// A pending automatic restart is cancelled. An external server that was
    /// not adopted is left alone (see [`Self::stop_external`]).
    pub async fn stop(&self, timeouts: StopTimeouts) -> EngineState {
        enum Target {
            Child(u32, watch::Receiver<Option<ExitInfo>>),
            Adopted(u32, u64),
        }
        let target = {
            let mut inner = self.lock();
            let generation = inner.generation;
            let target = match inner.tracking.as_mut() {
                None => {
                    if matches!(inner.state.phase, Phase::Failed { .. }) {
                        // Cancels a scheduled restart (it checks the generation).
                        inner.generation += 1;
                    }
                    return inner.state.clone();
                }
                Some(Tracking::Child {
                    pid,
                    stop_requested,
                    exit_rx,
                    ..
                }) => {
                    *stop_requested = true;
                    Target::Child(*pid, exit_rx.clone())
                }
                Some(Tracking::Attached {
                    pid: Some(pid),
                    adopted: true,
                    stop_requested,
                    ..
                }) => {
                    *stop_requested = true;
                    Target::Adopted(*pid, generation)
                }
                Some(Tracking::Attached { .. }) => return inner.state.clone(),
            };
            inner.state.enter(Phase::Stopping);
            self.events.state(&inner.state);
            target
        };

        match target {
            Target::Child(pid, mut exit_rx) => {
                let steps = [
                    (Signal::SIGINT, timeouts.after_sigint),
                    (Signal::SIGTERM, timeouts.after_sigterm),
                    (Signal::SIGKILL, timeouts.after_sigkill),
                ];
                for (signal, wait) in steps {
                    if exit_rx.borrow().is_some() {
                        break;
                    }
                    self.push_system(format!("sending {signal} to process group {pid}"));
                    if let Err(error) = killpg(Pid::from_raw(pid as i32), signal) {
                        if error != nix::errno::Errno::ESRCH {
                            self.push_system(format!("{signal} failed: {error}"));
                        }
                    }
                    let exited =
                        tokio::time::timeout(wait, exit_rx.wait_for(Option::is_some)).await;
                    if matches!(exited, Ok(Ok(_))) {
                        break;
                    }
                }
            }
            Target::Adopted(pid, generation) => {
                self.signal_until_gone(pid, timeouts).await;
                self.on_attached_exit(generation).await;
            }
        }
        self.state()
    }

    /// Stops the Splash server holding `port`'s lock (or the external one
    /// shown) without adopting it. The pid comes from Splash's lock file and
    /// must be a Splash process.
    pub async fn stop_external(
        &self,
        port: Option<u16>,
        timeouts: StopTimeouts,
    ) -> AppResult<EngineState> {
        let shown = {
            let inner = self.lock();
            match &inner.tracking {
                Some(Tracking::Attached { pid, port: p, .. })
                    if port.is_none() || port == Some(*p) =>
                {
                    Some((*pid, *p, inner.generation))
                }
                _ => None,
            }
        };
        let (pid, port, generation) = match shown {
            Some((Some(pid), port, generation)) => (pid, port, Some(generation)),
            _ => {
                let Some(port) = port.or_else(|| shown.map(|s| s.1)) else {
                    return Err(AppError::NotRunning);
                };
                let owner = self
                    .paths
                    .runtime_dir
                    .as_deref()
                    .map(|dir| lockfile::serve_lock_path(dir, port))
                    .filter(|path| lockfile::lock_is_held(path))
                    .and_then(|path| lockfile::read_lock_owner(&path))
                    .ok_or(AppError::NotRunning)?;
                (owner.pid, port, shown.map(|s| s.2))
            }
        };
        if !lockfile::is_splash_process(pid) {
            return Err(AppError::NotSplash(pid));
        }
        if let Some(generation) = generation {
            let mut inner = self.lock();
            if inner.generation == generation {
                if let Some(Tracking::Attached { stop_requested, .. }) = inner.tracking.as_mut() {
                    *stop_requested = true;
                }
                inner.state.enter(Phase::Stopping);
                self.events.state(&inner.state);
            }
        }
        self.push_system(format!(
            "stopping the Splash server on port {port} (pid {pid})"
        ));
        self.signal_until_gone(pid, timeouts).await;
        if let Some(generation) = generation {
            self.on_attached_exit(generation).await;
        }
        Ok(self.state())
    }

    /// SIGINT, SIGTERM, SIGKILL to a process we did not spawn, polling for
    /// its exit. Signals the group when the pid leads one (servers spawned
    /// by an earlier app run), else only the pid.
    async fn signal_until_gone(&self, pid: u32, timeouts: StopTimeouts) -> bool {
        let target = Pid::from_raw(pid as i32);
        let leads_group = getpgid(Some(target)).is_ok_and(|g| g == target);
        let steps = [
            (Signal::SIGINT, timeouts.after_sigint),
            (Signal::SIGTERM, timeouts.after_sigterm),
            (Signal::SIGKILL, timeouts.after_sigkill),
        ];
        for (signal, wait) in steps {
            if !lockfile::pid_alive(pid) {
                return true;
            }
            self.push_system(format!("sending {signal} to {pid}"));
            let sent = if leads_group {
                killpg(target, signal)
            } else {
                kill(target, signal)
            };
            if let Err(error) = sent {
                if error != nix::errno::Errno::ESRCH {
                    self.push_system(format!("{signal} failed: {error}"));
                }
            }
            let deadline = Instant::now() + wait;
            while Instant::now() < deadline {
                if !lockfile::pid_alive(pid) {
                    return true;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
        !lockfile::pid_alive(pid)
    }

    /// Blocking stop for app exit. Call from outside the async runtime (the
    /// Tauri `RunEvent::Exit` handler runs on the main thread). With
    /// `keep_running_on_quit` a server we spawned keeps running; its pidfile
    /// lets the next run re-attach.
    pub fn shutdown_blocking(&self) {
        {
            let inner = self.lock();
            let ours = matches!(inner.tracking, Some(Tracking::Child { .. }));
            if !ours || inner.settings.keep_running_on_quit {
                return;
            }
        }
        let this = self.clone();
        tauri::async_runtime::block_on(async move {
            this.stop(StopTimeouts::ON_EXIT).await;
        });
    }

    // ---------------------------------------------------------------- exits

    fn on_child_exit(&self, generation: u64, info: ExitInfo) {
        let (state, restart_in) = {
            let mut inner = self.lock();
            if inner.generation != generation {
                return;
            }
            let Some(Tracking::Child {
                stop_requested,
                ever_ready,
                ..
            }) = inner.tracking.take()
            else {
                return;
            };
            let summary = ExitSummary {
                code: info.code,
                signal: info.signal,
                requested: stop_requested,
                at_ms: now_ms(),
            };
            inner.state.last_exit = Some(summary);
            inner.state.owner = Owner::None;
            inner.state.pid = None;
            inner.download = None;
            let mut restart_in = None;
            if stop_requested {
                inner.state.enter(Phase::Stopped);
            } else {
                let lines = recent_lines(&inner, FAILURE_LINES);
                let reason = logparse::failure_reason(lines.iter().map(String::as_str))
                    .unwrap_or_else(|| describe_exit(info));
                let launcher_failure =
                    logparse::is_launcher_failure(lines.iter().map(String::as_str));
                inner.state.enter(Phase::Failed {
                    reason,
                    exit_code: info.code,
                    signal: info.signal,
                    last_log_lines: lines,
                });
                restart_in = plan_restart(&mut inner, ever_ready, launcher_failure);
            }
            (inner.state.clone(), restart_in)
        };
        if let Some(path) = self.pidfile_path() {
            lockfile::remove_pidfile(&path);
        }
        self.push_system(describe_exit(info));
        if let Some(delay) = restart_in {
            self.push_system(format!(
                "restarting in {:.1} s (automatic restart after a crash)",
                delay.as_secs_f64()
            ));
            tokio::spawn(self.clone().restart_after(delay, generation));
        }
        self.events.state(&state);
    }

    async fn restart_after(self, delay: Duration, generation: u64) {
        tokio::time::sleep(delay).await;
        let spec = {
            let mut inner = self.lock();
            let still_failed = inner.generation == generation
                && inner.tracking.is_none()
                && matches!(inner.state.phase, Phase::Failed { .. });
            let Some(spec) = inner.last_spec.clone().filter(|_| still_failed) else {
                return;
            };
            inner.restarts += 1;
            inner.restart_history.push_back(Instant::now());
            spec
        };
        let _guard = lock_recover(&self.start_guard);
        if let Err(error) = self.start_unguarded(spec) {
            self.push_system(format!("automatic restart failed: {error}"));
            let state = {
                let mut inner = self.lock();
                if inner.tracking.is_some() {
                    return;
                }
                let lines = recent_lines(&inner, FAILURE_LINES);
                inner.state.enter(Phase::Failed {
                    reason: format!("automatic restart failed: {error}"),
                    exit_code: None,
                    signal: None,
                    last_log_lines: lines,
                });
                inner.state.clone()
            };
            self.events.state(&state);
        }
    }

    async fn on_attached_exit(&self, generation: u64) {
        let state = {
            let mut inner = self.lock();
            if inner.generation != generation {
                return;
            }
            let Some(Tracking::Attached {
                adopted,
                stop_requested,
                previous_session,
                done_tx,
                ..
            }) = inner.tracking.take()
            else {
                return;
            };
            if let Some(done) = done_tx {
                let _ = done.send(true);
            }
            inner.state.owner = Owner::None;
            inner.state.pid = None;
            inner.state.last_exit = Some(ExitSummary {
                code: None,
                signal: None,
                requested: stop_requested,
                at_ms: now_ms(),
            });
            if adopted && !stop_requested {
                let lines = recent_lines(&inner, FAILURE_LINES);
                let reason = logparse::failure_reason(lines.iter().map(String::as_str))
                    .unwrap_or_else(|| "the adopted Splash server exited".to_string());
                inner.state.enter(Phase::Failed {
                    reason,
                    exit_code: None,
                    signal: None,
                    last_log_lines: lines,
                });
            } else {
                inner.state.enter(Phase::Stopped);
            }
            if previous_session {
                if let Some(path) = self.pidfile_path() {
                    lockfile::remove_pidfile(&path);
                }
            }
            inner.state.clone()
        };
        self.push_system("the Splash server exited".to_string());
        self.events.state(&state);
    }

    // -------------------------------------------------------------- monitor

    /// Readiness, `/status`, download progress and liveness, every 750 ms,
    /// until the generation changes or tracking ends.
    async fn monitor(self, generation: u64, port: u16, probe: bool, api_key: Option<String>) {
        loop {
            tokio::time::sleep(MONITOR_INTERVAL).await;
            let (phase, attached_pid, api_key) = {
                let inner = self.lock();
                if inner.generation != generation {
                    return;
                }
                match &inner.tracking {
                    None => return,
                    Some(Tracking::Child { .. }) => {
                        (inner.state.phase.clone(), None, api_key.clone())
                    }
                    Some(Tracking::Attached {
                        pid, api_key: key, ..
                    }) => (
                        inner.state.phase.clone(),
                        Some(*pid),
                        key.clone().or_else(|| api_key.clone()),
                    ),
                }
            };

            if let Some(pid) = attached_pid {
                let alive = match pid {
                    Some(pid) => lockfile::pid_alive(pid),
                    None => self.paths.runtime_dir.as_deref().is_some_and(|d| {
                        lockfile::lock_is_held(&lockfile::serve_lock_path(d, port))
                    }),
                };
                if !alive {
                    self.on_attached_exit(generation).await;
                    return;
                }
            }

            if matches!(phase, Phase::Downloading { .. }) {
                self.update_download(generation);
            }
            if !probe {
                continue;
            }
            match &phase {
                Phase::External { ready, .. } => {
                    let now_ready = self.probe_ready(port).await == Some(true);
                    if now_ready != *ready {
                        let mut next = phase.clone();
                        if let Phase::External { ready, .. } = &mut next {
                            *ready = now_ready;
                        }
                        self.transition_if(
                            generation,
                            |p| matches!(p, Phase::External { .. }),
                            next,
                        );
                    }
                }
                p if logparse::is_pre_ready(p) => {
                    if self.probe_ready(port).await == Some(true) {
                        self.transition_if(generation, logparse::is_pre_ready, Phase::Ready);
                    }
                }
                p if logparse::is_serving(p) => {
                    if let Some(signals) = self.poll_status(port, api_key.as_deref()).await {
                        if let Some(next) = derive_serving_phase(p, &signals) {
                            let name = p.name();
                            self.transition_if(generation, |q| q.name() == name, next);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// TCP connect (<= 0.9 s), then `GET /ready`. `None`: not listening.
    pub async fn probe_ready(&self, port: u16) -> Option<bool> {
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        match tokio::time::timeout(CONNECT_TIMEOUT, tokio::net::TcpStream::connect(addr)).await {
            Ok(Ok(stream)) => drop(stream),
            _ => return None,
        }
        let response = self
            .http
            .get(format!("http://127.0.0.1:{port}/ready"))
            .send()
            .await
            .ok()?;
        Some(response.status().is_success())
    }

    /// `/status` signals, or `/ready` alone when `/status` is refused
    /// (an adopted server whose API key we do not have).
    async fn poll_status(&self, port: u16, api_key: Option<&str>) -> Option<StatusSignals> {
        let mut request = self.http.get(format!("http://127.0.0.1:{port}/status"));
        if let Some(key) = api_key.filter(|k| !k.is_empty()) {
            request = request.bearer_auth(key);
        }
        if let Ok(response) = request.send().await {
            if response.status().is_success() {
                if let Ok(body) = response.json::<Value>().await {
                    return Some(StatusSignals::from_status(&body));
                }
            }
        }
        let ready = self.probe_ready(port).await?;
        Some(StatusSignals::from_ready(ready))
    }

    fn update_download(&self, generation: u64) {
        let watch = {
            let inner = self.lock();
            match &inner.download {
                Some(w) if w.generation == generation => (w.blobs.clone(), w.baseline),
                _ => return,
            }
        };
        let done = dir_bytes(&watch.0).saturating_sub(watch.1);
        let state = {
            let mut inner = self.lock();
            if inner.generation != generation {
                return;
            }
            let Phase::Downloading {
                progress: Some(progress),
            } = &mut inner.state.phase
            else {
                return;
            };
            let done = if progress.total_bytes > 0 {
                done.min(progress.total_bytes)
            } else {
                done
            };
            if progress.done_bytes == done {
                return;
            }
            progress.done_bytes = done;
            progress.fraction =
                (progress.total_bytes > 0).then(|| done as f64 / progress.total_bytes as f64);
            inner.state.clone()
        };
        self.events.state(&state);
    }

    fn transition_if(&self, generation: u64, expect: impl Fn(&Phase) -> bool, next: Phase) {
        let state = {
            let mut inner = self.lock();
            if inner.generation != generation
                || !expect(&inner.state.phase)
                || inner.state.phase == next
            {
                return;
            }
            if next == Phase::Ready && inner.state.ready_at_ms.is_none() {
                inner.state.ready_at_ms = Some(now_ms());
            }
            if next == Phase::Ready {
                if let Some(Tracking::Child { ever_ready, .. }) = inner.tracking.as_mut() {
                    *ever_ready = true;
                }
            }
            inner.state.enter(next);
            inner.state.clone()
        };
        self.events.state(&state);
    }

    // ----------------------------------------------------------------- logs

    async fn tail(
        self,
        generation: u64,
        path: PathBuf,
        stream: LogStream,
        done: watch::Receiver<bool>,
    ) {
        let mut file = None;
        for _ in 0..50 {
            match tokio::fs::File::open(&path).await {
                Ok(f) => {
                    file = Some(f);
                    break;
                }
                Err(_) => tokio::time::sleep(TAIL_INTERVAL).await,
            }
        }
        let Some(mut file) = file else {
            self.push_system(format!("could not open {}", path.display()));
            return;
        };
        let _ = file.seek(SeekFrom::Start(0)).await;
        let mut buf = vec![0u8; 16 * 1024];
        let mut line: Vec<u8> = Vec::new();
        let mut finishing = false;
        loop {
            match file.read(&mut buf).await {
                Ok(0) | Err(_) => {
                    if finishing {
                        break;
                    }
                    if *done.borrow() {
                        // One more pass picks up bytes written just before exit.
                        finishing = true;
                        continue;
                    }
                    tokio::time::sleep(TAIL_INTERVAL).await;
                }
                Ok(n) => {
                    for &byte in &buf[..n] {
                        if byte == b'\n' || byte == b'\r' {
                            self.flush_line(generation, stream, &mut line);
                        } else if line.len() < MAX_LINE_BYTES {
                            line.push(byte);
                        }
                    }
                }
            }
        }
        self.flush_line(generation, stream, &mut line);
    }

    fn flush_line(&self, generation: u64, stream: LogStream, line: &mut Vec<u8>) {
        if line.is_empty() {
            return;
        }
        let text = String::from_utf8_lossy(line).trim_end().to_string();
        line.clear();
        if !text.is_empty() {
            self.process_line(generation, stream, text);
        }
    }

    /// Records a child line and applies it to the phase machine.
    fn process_line(&self, generation: u64, stream: LogStream, text: String) {
        let event = logparse::parse_line(&text);
        let mut fetch: Option<(String, u64)> = None;
        let (entry, state) = {
            let mut inner = self.lock();
            let mut transition = None;
            let applies = inner.generation == generation
                && matches!(
                    inner.tracking,
                    Some(Tracking::Child { .. }) | Some(Tracking::Attached { adopted: true, .. })
                );
            if applies {
                if let LogEvent::Ready {
                    context,
                    context_tokens,
                    language_only,
                    url,
                    ..
                } = &event
                {
                    inner.state.ready_info = Some(ReadyInfo {
                        context: context.clone(),
                        context_tokens: *context_tokens,
                        language_only: *language_only,
                        url: url.clone(),
                    });
                    if inner.state.ready_at_ms.is_none() {
                        inner.state.ready_at_ms = Some(now_ms());
                    }
                    if let Some(Tracking::Child { ever_ready, .. }) = inner.tracking.as_mut() {
                        *ever_ready = true;
                    }
                }
                if let Some(next) = logparse::apply(&inner.state.phase, &event) {
                    let next = match next {
                        Phase::Failed {
                            reason,
                            exit_code,
                            signal,
                            ..
                        } => {
                            let mut lines = recent_lines(&inner, FAILURE_LINES - 1);
                            lines.push(text.clone());
                            Phase::Failed {
                                reason,
                                exit_code,
                                signal,
                                last_log_lines: lines,
                            }
                        }
                        other => other,
                    };
                    if let LogEvent::Fetching {
                        repo, total_bytes, ..
                    } = &event
                    {
                        fetch = Some((repo.clone(), *total_bytes));
                    }
                    transition = Some(next.name());
                    inner.state.enter(next);
                } else if let LogEvent::Fetching {
                    repo, total_bytes, ..
                } = &event
                {
                    // A second fetch (e.g. the draft model) while downloading.
                    if let Phase::Downloading { .. } = inner.state.phase {
                        inner.state.enter(Phase::Downloading {
                            progress: Some(DownloadProgress {
                                repo: repo.clone(),
                                files: match &event {
                                    LogEvent::Fetching { files, .. } => *files,
                                    _ => 0,
                                },
                                total_bytes: *total_bytes,
                                done_bytes: 0,
                                fraction: (*total_bytes > 0).then_some(0.0),
                            }),
                        });
                        fetch = Some((repo.clone(), *total_bytes));
                        transition = Some("downloading");
                    }
                }
            }
            let entry = record_line(&mut inner, stream, text, transition);
            let state = transition.map(|_| inner.state.clone());
            (entry, state)
        };
        self.after_record(&entry);
        if let Some(state) = state {
            self.events.state(&state);
        }
        if let Some((repo, _)) = fetch {
            self.start_download_watch(generation, &repo);
        }
    }

    fn start_download_watch(&self, generation: u64, repo: &str) {
        let cache = self.lock().hf_cache.clone().or_else(default_hf_cache);
        let Some(cache) = cache else {
            return;
        };
        let blobs = cache
            .join(format!("models--{}", repo.replace('/', "--")))
            .join("blobs");
        let baseline = dir_bytes(&blobs);
        self.lock().download = Some(DownloadWatch {
            generation,
            blobs,
            baseline,
        });
    }

    fn push_system(&self, line: String) {
        let entry = {
            let mut inner = self.lock();
            record_line(&mut inner, LogStream::System, line, None)
        };
        self.after_record(&entry);
    }

    fn after_record(&self, entry: &LogLine) {
        if let Some(file) = lock_recover(&self.session_file).as_mut() {
            let stream = match entry.stream {
                LogStream::Stdout => "stdout",
                LogStream::Stderr => "stderr",
                LogStream::System => "system",
            };
            let _ = writeln!(file, "[{stream}] {}", entry.line);
        }
        self.events.log(entry);
    }

    /// Writes every line of this app run (or the in-memory backlog when no
    /// session log exists) to `dest`.
    pub fn save_log(&self, dest: &Path) -> AppResult<()> {
        if let Some(src) = &self.paths.session_log {
            if let Some(file) = lock_recover(&self.session_file).as_mut() {
                let _ = file.flush();
            }
            if src.exists() {
                std::fs::copy(src, dest)?;
                return Ok(());
            }
        }
        let mut out = std::fs::File::create(dest)?;
        for line in self.logs() {
            let stream = match line.stream {
                LogStream::Stdout => "stdout",
                LogStream::Stderr => "stderr",
                LogStream::System => "system",
            };
            writeln!(out, "[{stream}] {}", line.line)?;
        }
        Ok(())
    }
}

fn record_line(
    inner: &mut Inner,
    stream: LogStream,
    line: String,
    phase: Option<&'static str>,
) -> LogLine {
    let entry = LogLine {
        seq: inner.next_seq,
        stream,
        line,
        ts_ms: now_ms(),
        phase,
    };
    inner.next_seq += 1;
    if inner.logs.len() == LOG_CAPACITY {
        inner.logs.pop_front();
    }
    inner.logs.push_back(entry.clone());
    entry
}

/// The last `n` lines of the current generation.
fn recent_lines(inner: &Inner, n: usize) -> Vec<String> {
    let first = inner.gen_first_seq;
    let lines: Vec<String> = inner
        .logs
        .iter()
        .filter(|l| l.seq >= first)
        .map(|l| l.line.clone())
        .collect();
    let skip = lines.len().saturating_sub(n);
    lines.into_iter().skip(skip).collect()
}

fn describe_exit(info: ExitInfo) -> String {
    match (info.code, info.signal) {
        (Some(code), _) => format!("Splash exited with code {code}"),
        (None, Some(signal)) => format!("Splash was terminated by signal {signal}"),
        _ => "Splash exited".to_string(),
    }
}

/// Whether (and when) to restart after an unexpected exit.
fn plan_restart(inner: &mut Inner, ever_ready: bool, launcher_failure: bool) -> Option<Duration> {
    let settings = inner.settings;
    if !settings.auto_restart || !ever_ready || launcher_failure || inner.last_spec.is_none() {
        return None;
    }
    let window = Duration::from_secs(settings.restart_window_secs);
    let now = Instant::now();
    while inner
        .restart_history
        .front()
        .is_some_and(|t| now.duration_since(*t) > window)
    {
        inner.restart_history.pop_front();
    }
    let recent = inner.restart_history.len() as u32;
    if recent >= settings.max_restarts {
        return None;
    }
    let backoff = settings
        .restart_backoff_ms
        .saturating_mul(1u64 << recent.min(10))
        .min(30_000);
    Some(Duration::from_millis(backoff))
}

/// Total size of the files directly in `dir` (HF `blobs/`, including
/// `.incomplete` downloads).
pub fn dir_bytes(dir: &Path) -> u64 {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter_map(|e| e.metadata().ok())
                .filter(|m| m.is_file())
                .map(|m| m.len())
                .sum()
        })
        .unwrap_or(0)
}

/// `$HF_HUB_CACHE`, `$HF_HOME/hub` or `~/.cache/huggingface/hub`.
pub fn default_hf_cache() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("HF_HUB_CACHE") {
        return Some(PathBuf::from(dir));
    }
    if let Some(home) = std::env::var_os("HF_HOME") {
        return Some(PathBuf::from(home).join("hub"));
    }
    dirs::home_dir().map(|h| h.join(".cache/huggingface/hub"))
}

/// What `/status` (or `/ready`) says about a listening server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusSignals {
    pub ready: bool,
    pub recovering: bool,
    /// Splash gave up relaunching its engine (`transport.stopped`).
    pub stopped: bool,
    pub error: Option<String>,
    /// Requests prefilling/decoding/queued/waiting; `None` if unknown.
    pub active: Option<u64>,
    /// Weights released (resident memory well below the weights); `None`
    /// if unknown.
    pub released: Option<bool>,
}

impl StatusSignals {
    pub fn from_ready(ready: bool) -> Self {
        Self {
            ready,
            recovering: !ready,
            stopped: false,
            error: None,
            active: None,
            released: None,
        }
    }

    pub fn from_status(body: &Value) -> Self {
        let num = |path: &[&str]| -> Option<u64> {
            let mut v = body;
            for key in path {
                v = v.get(*key)?;
            }
            v.as_u64().or_else(|| v.as_f64().map(|f| f.max(0.0) as u64))
        };
        let flag = |path: &[&str]| -> bool {
            let mut v = body;
            for key in path {
                match v.get(*key) {
                    Some(next) => v = next,
                    None => return false,
                }
            }
            v.as_bool().unwrap_or(false)
        };
        let scheduler: u64 = [
            "prefilling",
            "decoding",
            "queued",
            "waiting_resources",
            "waiting_prefix",
            "waiting_mask",
        ]
        .iter()
        .filter_map(|k| num(&["scheduler", k]))
        .sum();
        let pending = num(&["transport", "pending"]).unwrap_or(0);
        let has_scheduler = body.get("scheduler").is_some();
        let weights = num(&["memory_plan", "model", "memory", "target_weights_bytes"]).map(|t| {
            t + num(&["memory_plan", "model", "memory", "draft_weights_bytes"]).unwrap_or(0)
        });
        let current = num(&["memory_actual", "current_bytes"]);
        let released = match (weights, current) {
            (Some(w), Some(c)) if w > 0 => Some(c < w / 2),
            _ => None,
        };
        Self {
            ready: flag(&["ready"]),
            recovering: flag(&["transport", "recovering"]),
            stopped: flag(&["transport", "stopped"]),
            error: body
                .get("transport")
                .and_then(|t| t.get("error"))
                .and_then(Value::as_str)
                .map(str::to_string),
            active: has_scheduler.then_some(scheduler + pending),
            released,
        }
    }
}

/// The serving phase `/status` implies, or `None` to stay.
pub fn derive_serving_phase(current: &Phase, s: &StatusSignals) -> Option<Phase> {
    let next = if s.stopped {
        Phase::Failed {
            reason: s
                .error
                .clone()
                .unwrap_or_else(|| "Splash stopped restarting its engine".into()),
            exit_code: None,
            signal: None,
            last_log_lines: Vec::new(),
        }
    } else if s.recovering {
        match current {
            Phase::Recovering { .. } => return None,
            _ => Phase::Recovering {
                reason: s.error.clone(),
            },
        }
    } else if !s.ready {
        return None;
    } else {
        let busy = s.active.map(|a| a > 0);
        match current {
            Phase::Recovering { .. } => {
                if busy == Some(true) {
                    Phase::Busy
                } else {
                    Phase::Ready
                }
            }
            Phase::IdleReleased => match (busy, s.released) {
                (Some(true), _) => Phase::Restoring,
                (_, Some(false)) => Phase::Ready,
                _ => return None,
            },
            Phase::Restoring => match (busy, s.released) {
                (Some(true), Some(false)) => Phase::Busy,
                (_, Some(false)) | (Some(false), None) => Phase::Ready,
                _ => return None,
            },
            Phase::Ready | Phase::Busy => {
                if s.released == Some(true) && busy != Some(true) {
                    Phase::IdleReleased
                } else if busy == Some(true) {
                    Phase::Busy
                } else if busy == Some(false) {
                    Phase::Ready
                } else {
                    return None;
                }
            }
            _ => return None,
        }
    };
    (next != *current).then_some(next)
}

/// PATH with the Homebrew prefixes added: apps opened from Finder inherit
/// only /usr/bin:/bin:/usr/sbin:/sbin, which the splash launcher may outgrow.
pub fn augmented_path() -> OsString {
    let mut paths: Vec<PathBuf> = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/opt/homebrew/sbin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Some(existing) = std::env::var_os("PATH") {
        for p in std::env::split_paths(&existing) {
            if !paths.contains(&p) {
                paths.push(p);
            }
        }
    }
    for p in ["/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
        let p = PathBuf::from(p);
        if !paths.contains(&p) {
            paths.push(p);
        }
    }
    std::env::join_paths(paths).unwrap_or_default()
}

#[cfg(test)]
mod tests;
