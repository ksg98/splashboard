//! Concurrent pseudo-terminal sessions (portable-pty).
//!
//! Each session runs one program as the leader of a new session and process
//! group (portable-pty calls `setsid`), so signals go to the whole group:
//! `splash <agent>` execs the agent, which may start helpers of its own.
//!
//! Output is delivered as raw bytes to a [`PtySink`]; the exit is delivered
//! last, after the output has been drained.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{ErrorKind, Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use nix::sys::signal::{killpg, Signal};
use nix::unistd::Pid;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

use crate::error::{AppError, AppResult};

/// How long a killed session gets to exit after SIGHUP before SIGKILL.
const KILL_GRACE: Duration = Duration::from_secs(2);
/// How long the exit event waits for buffered output once the child exited.
/// A background grandchild can keep the terminal open indefinitely.
const DRAIN_TIMEOUT: Duration = Duration::from_millis(1000);
const READ_BUFFER: usize = 16 * 1024;
pub const MAX_DIMENSION: u16 = 2000;

/// Receives a session's output and its exit.
pub trait PtySink: Send + Sync + 'static {
    /// Returns false once the receiver is gone; later output is discarded
    /// (the session keeps draining so the program never blocks on a full pty).
    fn data(&self, bytes: &[u8]) -> bool;
    /// Called exactly once, after the last `data`.
    fn exit(&self, exit: PtyExit);
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyExit {
    /// The exit code (1 when ended by a signal), or `None` if waiting failed.
    pub code: Option<u32>,
    /// The signal's description when the program was ended by one.
    pub signal: Option<String>,
}

/// What to run. `program` must already be resolved (absolute, or found on
/// `env`'s PATH by portable-pty).
#[derive(Debug, Clone)]
pub struct SpawnSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    /// Must be an existing directory; `None` runs in the home folder.
    pub cwd: Option<PathBuf>,
    /// Applied on top of the app's environment, in order.
    pub env: Vec<(String, OsString)>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySessionInfo {
    pub id: u32,
    pub pid: Option<u32>,
    pub program: String,
    pub args: Vec<String>,
}

struct Session {
    info: PtySessionInfo,
    writer: SessionWriter,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    exited: Arc<AtomicBool>,
}

type Sessions = Arc<Mutex<HashMap<u32, Session>>>;

/// Owns every live session. Managed as Tauri state.
#[derive(Default)]
pub struct PtyManager {
    sessions: Sessions,
    next_id: AtomicU32,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn validate_size(cols: u16, rows: u16) -> AppResult<PtySize> {
    if cols == 0 || rows == 0 || cols > MAX_DIMENSION || rows > MAX_DIMENSION {
        return Err(AppError::InvalidRequest(format!(
            "terminal size {cols}x{rows} is out of range"
        )));
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn other(e: impl std::fmt::Display) -> AppError {
    AppError::Other(e.to_string())
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts `spec` in a new pseudo-terminal and returns the session id.
    pub fn spawn(&self, spec: SpawnSpec, sink: Arc<dyn PtySink>) -> AppResult<PtySessionInfo> {
        let size = validate_size(spec.cols, spec.rows)?;
        if let Some(cwd) = &spec.cwd {
            if !cwd.is_dir() {
                return Err(AppError::InvalidRequest(format!(
                    "working directory {} does not exist",
                    cwd.display()
                )));
            }
        }

        let pair = native_pty_system().openpty(size).map_err(other)?;
        let mut cmd = CommandBuilder::new(spec.program.as_os_str());
        cmd.args(&spec.args);
        match &spec.cwd {
            Some(cwd) => cmd.cwd(cwd.as_os_str()),
            None => {
                if let Some(home) = dirs::home_dir() {
                    cmd.cwd(home.as_os_str());
                }
            }
        }
        for (key, value) in &spec.env {
            cmd.env(key, value);
        }

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| {
            AppError::Other(format!("could not start {}: {e}", spec.program.display()))
        })?;
        // The child holds its own copy; keeping ours would stop EOF arriving.
        drop(pair.slave);

        let reader = pair.master.try_clone_reader().map_err(other)?;
        let writer = pair.master.take_writer().map_err(other)?;

        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let info = PtySessionInfo {
            id,
            pid: child.process_id(),
            program: spec.program.to_string_lossy().into_owned(),
            args: spec.args.clone(),
        };
        let exited = Arc::new(AtomicBool::new(false));
        lock(&self.sessions).insert(
            id,
            Session {
                info: info.clone(),
                writer: Arc::new(Mutex::new(writer)),
                master: Arc::new(Mutex::new(pair.master)),
                exited: exited.clone(),
            },
        );

        let (drained_tx, drained_rx) = mpsc::channel::<()>();
        let read_sink = sink.clone();
        let reader_thread = thread::Builder::new()
            .name(format!("pty-{id}-read"))
            .spawn(move || pump_output(reader, read_sink.as_ref(), drained_tx));
        if let Err(e) = reader_thread {
            let _ = child.kill();
            lock(&self.sessions).remove(&id);
            return Err(other(e));
        }

        let sessions = self.sessions.clone();
        let waiter = thread::Builder::new()
            .name(format!("pty-{id}-wait"))
            .spawn(move || {
                let status = child.wait();
                exited.store(true, Ordering::SeqCst);
                let _ = drained_rx.recv_timeout(DRAIN_TIMEOUT);
                lock(&sessions).remove(&id);
                sink.exit(match status {
                    Ok(s) => PtyExit {
                        code: Some(s.exit_code()),
                        signal: s.signal().map(str::to_string),
                    },
                    Err(e) => {
                        log::warn!("pty {id}: waiting for the program failed: {e}");
                        PtyExit {
                            code: None,
                            signal: None,
                        }
                    }
                });
            });
        if let Err(e) = waiter {
            // Without a waiter nobody would report the exit; stop the program.
            if let Some(pid) = info.pid {
                signal_group(pid, Signal::SIGKILL);
            }
            lock(&self.sessions).remove(&id);
            return Err(other(e));
        }
        Ok(info)
    }

    fn get<R>(&self, id: u32, f: impl FnOnce(&Session) -> R) -> AppResult<R> {
        lock(&self.sessions)
            .get(&id)
            .map(f)
            .ok_or_else(|| AppError::InvalidRequest(format!("no terminal session {id}")))
    }

    /// Sends keyboard input (or pasted text) to the program. May block while
    /// the program is not reading; see [`PtyManager::writer`].
    pub fn write(&self, id: u32, data: &[u8]) -> AppResult<()> {
        write_input(&self.writer(id)?, data)
    }

    /// The session's input handle, so a (possibly blocking) write can run
    /// off the async workers without holding the session map.
    pub fn writer(&self, id: u32) -> AppResult<SessionWriter> {
        self.get(id, |s| s.writer.clone())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> AppResult<()> {
        let size = validate_size(cols, rows)?;
        let master = self.get(id, |s| s.master.clone())?;
        let result = lock(&master).resize(size).map_err(other);
        result
    }

    /// Hangs up the session's process group, then kills it if it is still
    /// running after a grace period. The exit arrives through the sink.
    pub fn kill(&self, id: u32) -> AppResult<()> {
        let (pid, exited) = self.get(id, |s| (s.info.pid, s.exited.clone()))?;
        let Some(pid) = pid else {
            return Err(AppError::Other(format!("session {id} has no process id")));
        };
        signal_group(pid, Signal::SIGHUP);
        let _ = thread::Builder::new()
            .name(format!("pty-{id}-kill"))
            .spawn(move || {
                let deadline = Instant::now() + KILL_GRACE;
                while Instant::now() < deadline {
                    if exited.load(Ordering::SeqCst) {
                        return;
                    }
                    thread::sleep(Duration::from_millis(50));
                }
                if !exited.load(Ordering::SeqCst) {
                    signal_group(pid, Signal::SIGKILL);
                }
            });
        Ok(())
    }

    pub fn list(&self) -> Vec<PtySessionInfo> {
        let mut out: Vec<PtySessionInfo> = lock(&self.sessions)
            .values()
            .map(|s| s.info.clone())
            .collect();
        out.sort_by_key(|i| i.id);
        out
    }

    /// Ends every session; for app exit. Blocks for at most `grace`.
    pub fn kill_all(&self, grace: Duration) {
        let targets: Vec<(u32, Arc<AtomicBool>)> = lock(&self.sessions)
            .values()
            .filter_map(|s| s.info.pid.map(|pid| (pid, s.exited.clone())))
            .collect();
        if targets.is_empty() {
            return;
        }
        for (pid, _) in &targets {
            signal_group(*pid, Signal::SIGHUP);
        }
        let deadline = Instant::now() + grace;
        while Instant::now() < deadline && targets.iter().any(|(_, e)| !e.load(Ordering::SeqCst)) {
            thread::sleep(Duration::from_millis(25));
        }
        for (pid, exited) in &targets {
            if !exited.load(Ordering::SeqCst) {
                signal_group(*pid, Signal::SIGKILL);
            }
        }
    }
}

pub type SessionWriter = Arc<Mutex<Box<dyn Write + Send>>>;

/// Writes all of `data` to a session's input and flushes it.
pub fn write_input(writer: &SessionWriter, data: &[u8]) -> AppResult<()> {
    let mut writer = lock(writer);
    writer.write_all(data)?;
    writer.flush()?;
    Ok(())
}

fn signal_group(pid: u32, signal: Signal) {
    let Ok(raw) = i32::try_from(pid) else {
        return;
    };
    if let Err(e) = killpg(Pid::from_raw(raw), signal) {
        if e != nix::errno::Errno::ESRCH {
            log::warn!("could not send {signal} to process group {pid}: {e}");
        }
    }
}

fn pump_output(mut reader: Box<dyn Read + Send>, sink: &dyn PtySink, drained: mpsc::Sender<()>) {
    let mut buf = vec![0u8; READ_BUFFER];
    let mut deliver = true;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if deliver && !sink.data(&buf[..n]) {
                    deliver = false;
                }
            }
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            // macOS reports EIO on the master once the terminal's last user
            // has gone: that is the end of the output, not a failure.
            Err(_) => break,
        }
    }
    let _ = drained.send(());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Recorder {
        out: Mutex<Vec<u8>>,
        exit: Mutex<Option<PtyExit>>,
        exits: AtomicU32,
        data_after_exit: AtomicBool,
    }

    impl PtySink for Recorder {
        fn data(&self, bytes: &[u8]) -> bool {
            if lock(&self.exit).is_some() {
                self.data_after_exit.store(true, Ordering::SeqCst);
            }
            lock(&self.out).extend_from_slice(bytes);
            true
        }
        fn exit(&self, exit: PtyExit) {
            self.exits.fetch_add(1, Ordering::SeqCst);
            *lock(&self.exit) = Some(exit);
        }
    }

    impl Recorder {
        fn text(&self) -> String {
            String::from_utf8_lossy(&lock(&self.out)).into_owned()
        }
        fn wait_for(&self, what: impl Fn(&Self) -> bool, timeout: Duration) -> bool {
            let deadline = Instant::now() + timeout;
            while Instant::now() < deadline {
                if what(self) {
                    return true;
                }
                thread::sleep(Duration::from_millis(10));
            }
            what(self)
        }
        fn exited(&self) -> Option<PtyExit> {
            lock(&self.exit).clone()
        }
    }

    fn sh(script: &str) -> SpawnSpec {
        SpawnSpec {
            program: PathBuf::from("/bin/sh"),
            args: vec!["-c".into(), script.into()],
            cwd: None,
            env: vec![("TERM".into(), "xterm-256color".into())],
            cols: 80,
            rows: 24,
        }
    }

    const T: Duration = Duration::from_secs(10);

    #[test]
    fn spawn_streams_output_then_exit_code() {
        let manager = PtyManager::new();
        let rec = Arc::new(Recorder::default());
        let info = manager
            .spawn(sh("printf 'hello pty\\n'; exit 3"), rec.clone())
            .expect("spawn");
        assert!(info.id > 0);
        assert!(info.pid.is_some());
        assert!(rec.wait_for(|r| r.exited().is_some(), T), "no exit");
        assert!(rec.text().contains("hello pty"), "{:?}", rec.text());
        assert_eq!(rec.exited().and_then(|e| e.code), Some(3));
        assert_eq!(rec.exits.load(Ordering::SeqCst), 1);
        assert!(!rec.data_after_exit.load(Ordering::SeqCst));
        // The finished session is forgotten.
        assert!(manager.list().is_empty());
        assert!(manager.write(info.id, b"x").is_err());
    }

    #[test]
    fn write_is_echoed_by_the_program() {
        let manager = PtyManager::new();
        let rec = Arc::new(Recorder::default());
        let info = manager
            .spawn(sh("read line; printf 'got:%s\\n' \"$line\""), rec.clone())
            .expect("spawn");
        manager.write(info.id, b"splash\r").expect("write");
        assert!(rec.wait_for(|r| r.exited().is_some(), T), "no exit");
        assert!(rec.text().contains("got:splash"), "{:?}", rec.text());
        assert_eq!(rec.exited().and_then(|e| e.code), Some(0));
    }

    #[test]
    fn resize_reaches_the_program() {
        let manager = PtyManager::new();
        let rec = Arc::new(Recorder::default());
        // Waits for a line, then reports the terminal size.
        let info = manager
            .spawn(sh("read go; stty size"), rec.clone())
            .expect("spawn");
        manager.resize(info.id, 132, 40).expect("resize");
        manager.write(info.id, b"\r").expect("write");
        assert!(rec.wait_for(|r| r.exited().is_some(), T), "no exit");
        assert!(rec.text().contains("40 132"), "{:?}", rec.text());
    }

    #[test]
    fn env_and_cwd_are_applied() {
        let manager = PtyManager::new();
        let rec = Arc::new(Recorder::default());
        let mut spec = sh("printf '%s|' \"$SPLASH_PORT\"; pwd");
        spec.env.push(("SPLASH_PORT".into(), "8123".into()));
        spec.cwd = Some(PathBuf::from("/tmp"));
        manager.spawn(spec, rec.clone()).expect("spawn");
        assert!(rec.wait_for(|r| r.exited().is_some(), T), "no exit");
        let text = rec.text();
        assert!(text.contains("8123|"), "{text:?}");
        assert!(text.contains("/tmp"), "{text:?}");
    }

    #[test]
    fn kill_ends_a_running_session() {
        let manager = PtyManager::new();
        let rec = Arc::new(Recorder::default());
        let info = manager.spawn(sh("sleep 30"), rec.clone()).expect("spawn");
        assert_eq!(manager.list().len(), 1);
        manager.kill(info.id).expect("kill");
        assert!(rec.wait_for(|r| r.exited().is_some(), T), "no exit");
        let exit = rec.exited().expect("exit");
        assert!(exit.signal.is_some() || exit.code != Some(0), "{exit:?}");
        assert!(manager.list().is_empty());
    }

    #[test]
    fn kill_escalates_when_hangup_is_ignored() {
        let manager = PtyManager::new();
        let rec = Arc::new(Recorder::default());
        let info = manager
            .spawn(
                sh("trap '' HUP; printf ready; while :; do sleep 1; done"),
                rec.clone(),
            )
            .expect("spawn");
        assert!(rec.wait_for(|r| r.text().contains("ready"), T));
        manager.kill(info.id).expect("kill");
        assert!(
            rec.wait_for(|r| r.exited().is_some(), T),
            "no exit after SIGKILL"
        );
    }

    #[test]
    fn kill_all_ends_every_session() {
        let manager = PtyManager::new();
        let recs: Vec<Arc<Recorder>> = (0..3).map(|_| Arc::new(Recorder::default())).collect();
        for rec in &recs {
            manager.spawn(sh("sleep 30"), rec.clone()).expect("spawn");
        }
        assert_eq!(manager.list().len(), 3);
        manager.kill_all(Duration::from_millis(500));
        for rec in &recs {
            assert!(rec.wait_for(|r| r.exited().is_some(), T), "no exit");
        }
    }

    #[test]
    fn sessions_are_independent() {
        let manager = PtyManager::new();
        let a = Arc::new(Recorder::default());
        let b = Arc::new(Recorder::default());
        let ia = manager.spawn(sh("read l; echo A$l"), a.clone()).expect("a");
        let ib = manager.spawn(sh("read l; echo B$l"), b.clone()).expect("b");
        assert_ne!(ia.id, ib.id);
        manager.write(ib.id, b"2\r").expect("write b");
        manager.write(ia.id, b"1\r").expect("write a");
        assert!(a.wait_for(|r| r.exited().is_some(), T));
        assert!(b.wait_for(|r| r.exited().is_some(), T));
        assert!(a.text().contains("A1") && !a.text().contains("B2"));
        assert!(b.text().contains("B2") && !b.text().contains("A1"));
    }

    #[test]
    fn rejects_bad_size_and_missing_cwd() {
        let manager = PtyManager::new();
        let rec = Arc::new(Recorder::default());
        let mut spec = sh("true");
        spec.cols = 0;
        assert!(manager.spawn(spec, rec.clone()).is_err());
        let mut spec = sh("true");
        spec.cwd = Some(PathBuf::from("/definitely/not/here"));
        assert!(manager.spawn(spec, rec.clone()).is_err());
        assert!(manager.resize(999, 10, 10).is_err());
        assert!(manager.kill(999).is_err());
    }

    #[test]
    fn missing_program_is_an_error() {
        let manager = PtyManager::new();
        let rec = Arc::new(Recorder::default());
        let mut spec = sh("");
        spec.program = PathBuf::from("/nonexistent/program");
        assert!(manager.spawn(spec, rec).is_err());
    }
}
