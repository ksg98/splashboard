//! A non-interactive child process whose output is streamed line by line,
//! that can be cancelled. Used for `brew`, the model installer and its
//! verifier.
//!
//! The child runs in its own process group with stdin closed, so cancel
//! reaches everything it started (brew's curl, huggingface_hub workers):
//! SIGINT first (Python exits with 130, partial downloads resume next time),
//! then SIGTERM, then SIGKILL.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use nix::sys::signal::{killpg, Signal};
use nix::unistd::Pid;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::{mpsc, watch};

/// What to run.
#[derive(Debug, Clone, Default)]
pub struct RunSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    /// Added to (or replacing) the inherited environment. PATH is always set
    /// to [`augmented_path`] unless given here.
    pub env: Vec<(String, String)>,
}

impl RunSpec {
    pub fn new(program: impl Into<PathBuf>, args: &[&str]) -> Self {
        Self {
            program: program.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
            ..Self::default()
        }
    }

    /// The command line for logs. Never contains secrets: those travel in env.
    pub fn display(&self) -> String {
        std::iter::once(self.program.display().to_string())
            .chain(self.args.iter().cloned())
            .collect::<Vec<_>>()
            .join(" ")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stream {
    Stdout,
    Stderr,
    /// Lines Splashboard writes itself (the command line, cancel notices).
    System,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOutcome {
    pub code: Option<i32>,
    pub signal: Option<i32>,
    /// Cancel was requested while it ran.
    pub cancelled: bool,
}

impl RunOutcome {
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }
}

/// Receives output while the child runs. `tick` is called every
/// `tick_interval` (for polling progress) until it exits.
pub trait RunObserver: Send {
    fn line(&mut self, stream: Stream, line: &str);
    fn tick(&mut self) {}
}

impl<F: FnMut(Stream, &str) + Send> RunObserver for F {
    fn line(&mut self, stream: Stream, line: &str) {
        self(stream, line)
    }
}

/// A cancel switch shared between a job and the command that cancels it.
#[derive(Debug, Clone)]
pub struct CancelToken {
    sender: Arc<watch::Sender<bool>>,
}

impl Default for CancelToken {
    fn default() -> Self {
        Self::new()
    }
}

impl CancelToken {
    pub fn new() -> Self {
        let (sender, _) = watch::channel(false);
        Self {
            sender: Arc::new(sender),
        }
    }

    pub fn cancel(&self) {
        self.sender.send_replace(true);
    }

    pub fn is_cancelled(&self) -> bool {
        *self.sender.borrow()
    }

    pub async fn cancelled(&self) {
        let mut receiver = self.sender.subscribe();
        // Err only if the sender is gone, which `self` prevents.
        let _ = receiver.wait_for(|v| *v).await;
    }
}

/// How long each stop signal gets before the next one.
#[derive(Debug, Clone, Copy)]
pub struct StopGrace {
    pub after_sigint: Duration,
    pub after_sigterm: Duration,
}

impl StopGrace {
    pub const DEFAULT: StopGrace = StopGrace {
        after_sigint: Duration::from_secs(8),
        after_sigterm: Duration::from_secs(5),
    };
}

/// PATH for children: Homebrew's prefixes first (an app opened from Finder
/// has only /usr/bin:/bin:/usr/sbin:/sbin), then whatever was inherited.
pub fn augmented_path() -> String {
    let inherited =
        std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".into());
    let mut parts: Vec<String> = vec![
        "/opt/homebrew/bin".into(),
        "/opt/homebrew/sbin".into(),
        "/usr/local/bin".into(),
    ];
    for part in inherited.split(':') {
        if !part.is_empty() && !parts.iter().any(|p| p == part) {
            parts.push(part.to_string());
        }
    }
    parts.join(":")
}

/// Splits a byte stream into lines on `\n` and `\r` (progress bars redraw
/// with `\r`), dropping empty lines.
#[derive(Debug, Default)]
pub struct LineSplitter {
    pending: Vec<u8>,
}

impl LineSplitter {
    /// Longest line kept; anything longer is cut there.
    const MAX_LINE: usize = 64 * 1024;

    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        let mut out = Vec::new();
        for &byte in bytes {
            if byte == b'\n' || byte == b'\r' {
                self.flush_into(&mut out);
            } else if self.pending.len() < Self::MAX_LINE {
                self.pending.push(byte);
            }
        }
        out
    }

    pub fn finish(&mut self) -> Option<String> {
        let mut out = Vec::new();
        self.flush_into(&mut out);
        out.pop()
    }

    fn flush_into(&mut self, out: &mut Vec<String>) {
        if !self.pending.is_empty() {
            let line = String::from_utf8_lossy(&self.pending)
                .trim_end()
                .to_string();
            self.pending.clear();
            if !line.is_empty() {
                out.push(line);
            }
        }
    }
}

async fn pump<R: AsyncRead + Unpin>(
    mut reader: R,
    stream: Stream,
    sender: mpsc::UnboundedSender<(Stream, String)>,
) {
    let mut splitter = LineSplitter::default();
    let mut buffer = vec![0u8; 16 * 1024];
    loop {
        match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                for line in splitter.push(&buffer[..n]) {
                    if sender.send((stream, line)).is_err() {
                        return;
                    }
                }
            }
        }
    }
    if let Some(line) = splitter.finish() {
        let _ = sender.send((stream, line));
    }
}

/// Signals the process group, escalating, until `exited` is set.
fn spawn_escalation(pgid: i32, grace: StopGrace, exited: Arc<AtomicBool>) {
    tokio::spawn(async move {
        let group = Pid::from_raw(pgid);
        let steps = [
            (Signal::SIGINT, grace.after_sigint),
            (Signal::SIGTERM, grace.after_sigterm),
            (Signal::SIGKILL, Duration::ZERO),
        ];
        for (signal, wait) in steps {
            if exited.load(Ordering::SeqCst) {
                return;
            }
            if killpg(group, signal).is_err() {
                return; // The group is gone.
            }
            tokio::time::sleep(wait).await;
        }
    });
}

/// Runs `spec` to completion, sending each output line to `observer`.
/// Cancelling `cancel` stops the child's whole process group.
pub async fn run(
    spec: &RunSpec,
    cancel: &CancelToken,
    grace: StopGrace,
    tick_interval: Option<Duration>,
    observer: &mut dyn RunObserver,
) -> std::io::Result<RunOutcome> {
    use std::os::unix::process::ExitStatusExt;

    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true);
    if !spec.env.iter().any(|(k, _)| k == "PATH") {
        command.env("PATH", augmented_path());
    }
    for (key, value) in &spec.env {
        command.env(key, value);
    }
    if let Some(cwd) = &spec.cwd {
        command.current_dir(cwd);
    }
    let mut child = command.spawn()?;
    let pgid = child.id().map(|id| id as i32);

    let (sender, mut receiver) = mpsc::unbounded_channel();
    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(pump(stdout, Stream::Stdout, sender.clone()));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(pump(stderr, Stream::Stderr, sender.clone()));
    }
    drop(sender);

    let exited = Arc::new(AtomicBool::new(false));
    let mut cancelled = false;
    let mut pipes_open = true;
    let mut ticker = tick_interval.map(tokio::time::interval);
    let status = loop {
        tokio::select! {
            next = receiver.recv(), if pipes_open => match next {
                Some((stream, line)) => observer.line(stream, &line),
                None => pipes_open = false,
            },
            _ = cancel.cancelled(), if !cancelled => {
                cancelled = true;
                observer.line(Stream::System, "Cancelling…");
                if let Some(pgid) = pgid {
                    spawn_escalation(pgid, grace, exited.clone());
                }
            }
            _ = async {
                match ticker.as_mut() {
                    Some(t) => { t.tick().await; }
                    None => std::future::pending::<()>().await,
                }
            } => observer.tick(),
            status = child.wait() => break status?,
        }
    };
    exited.store(true, Ordering::SeqCst);

    // Drain what the pipes still hold. A grandchild that kept them open must
    // not hold the job forever.
    let drain = async {
        while let Some((stream, line)) = receiver.recv().await {
            observer.line(stream, &line);
        }
    };
    let _ = tokio::time::timeout(Duration::from_secs(2), drain).await;

    Ok(RunOutcome {
        code: status.code(),
        signal: status.signal(),
        cancelled,
    })
}

/// Runs to completion and returns stdout + stderr, with a timeout. For quick
/// commands (`brew info`, `device-check`).
pub async fn capture(
    spec: &RunSpec,
    timeout: Duration,
) -> std::io::Result<(RunOutcome, String, String)> {
    let cancel = CancelToken::new();
    let mut stdout = String::new();
    let mut stderr = String::new();
    let grace = StopGrace {
        after_sigint: Duration::from_secs(2),
        after_sigterm: Duration::from_secs(2),
    };
    let outcome = {
        let mut observer = |stream: Stream, line: &str| {
            let target = match stream {
                Stream::Stdout => &mut stdout,
                Stream::Stderr => &mut stderr,
                Stream::System => return,
            };
            target.push_str(line);
            target.push('\n');
        };
        let running = run(spec, &cancel, grace, None, &mut observer);
        tokio::pin!(running);
        tokio::select! {
            outcome = &mut running => outcome?,
            _ = tokio::time::sleep(timeout) => {
                cancel.cancel();
                let mut outcome = running.await?;
                outcome.cancelled = true;
                outcome
            }
        }
    };
    Ok((outcome, stdout, stderr))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_on_newlines_and_carriage_returns() {
        let mut splitter = LineSplitter::default();
        let mut lines = splitter.push(b"one\ntwo\r\n##   10%\r##  20%\rthr");
        lines.extend(splitter.push(b"ee\n\n"));
        assert_eq!(lines, vec!["one", "two", "##   10%", "##  20%", "three"]);
        assert_eq!(splitter.push(b"tail"), Vec::<String>::new());
        assert_eq!(splitter.finish().as_deref(), Some("tail"));
        assert_eq!(splitter.finish(), None);
    }

    #[test]
    fn path_puts_homebrew_first_without_duplicates() {
        let path = augmented_path();
        assert!(path.starts_with("/opt/homebrew/bin:"));
        assert_eq!(path.matches("/opt/homebrew/bin:").count(), 1);
    }

    #[tokio::test]
    async fn streams_lines_and_exit_code() {
        let spec = RunSpec::new(
            "/bin/sh",
            &["-c", "echo out; echo err >&2; printf 'a\\rb'; exit 3"],
        );
        let mut seen: Vec<(Stream, String)> = Vec::new();
        let mut observer = |s: Stream, l: &str| seen.push((s, l.to_string()));
        let outcome = run(
            &spec,
            &CancelToken::new(),
            StopGrace::DEFAULT,
            None,
            &mut observer,
        )
        .await
        .expect("run");
        assert_eq!(outcome.code, Some(3));
        assert!(!outcome.cancelled);
        assert!(seen.contains(&(Stream::Stdout, "out".into())));
        assert!(seen.contains(&(Stream::Stderr, "err".into())));
        assert!(seen.contains(&(Stream::Stdout, "a".into())));
        assert!(seen.contains(&(Stream::Stdout, "b".into())));
    }

    #[tokio::test]
    async fn cancel_interrupts_the_process_group() {
        // The child traps SIGINT and exits 130, as Python's KeyboardInterrupt does.
        let spec = RunSpec::new(
            "/bin/sh",
            &[
                "-c",
                "trap 'echo interrupted; exit 130' INT; echo started; sleep 30 & wait",
            ],
        );
        let cancel = CancelToken::new();
        let trigger = cancel.clone();
        let mut lines = Vec::new();
        let mut observer = |_: Stream, l: &str| {
            if l == "started" {
                trigger.cancel();
            }
            lines.push(l.to_string());
        };
        let started = std::time::Instant::now();
        let outcome = run(&spec, &cancel, StopGrace::DEFAULT, None, &mut observer)
            .await
            .expect("run");
        assert!(outcome.cancelled);
        assert_eq!(outcome.code, Some(130), "{lines:?}");
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[tokio::test]
    async fn escalates_to_sigkill_when_sigint_is_ignored() {
        let spec = RunSpec::new(
            "/bin/sh",
            &["-c", "trap '' INT TERM; echo started; sleep 30"],
        );
        let cancel = CancelToken::new();
        let trigger = cancel.clone();
        let mut observer = |_: Stream, l: &str| {
            if l == "started" {
                trigger.cancel();
            }
        };
        let grace = StopGrace {
            after_sigint: Duration::from_millis(100),
            after_sigterm: Duration::from_millis(100),
        };
        let outcome = run(&spec, &cancel, grace, None, &mut observer)
            .await
            .expect("run");
        assert!(outcome.cancelled);
        assert_eq!(outcome.signal, Some(9));
    }

    #[tokio::test]
    async fn ticks_while_running() {
        struct Counter(u32);
        impl RunObserver for Counter {
            fn line(&mut self, _: Stream, _: &str) {}
            fn tick(&mut self) {
                self.0 += 1;
            }
        }
        let spec = RunSpec::new("/bin/sh", &["-c", "sleep 0.35"]);
        let mut counter = Counter(0);
        run(
            &spec,
            &CancelToken::new(),
            StopGrace::DEFAULT,
            Some(Duration::from_millis(50)),
            &mut counter,
        )
        .await
        .expect("run");
        assert!(counter.0 >= 3, "ticked {} times", counter.0);
    }

    #[tokio::test]
    async fn capture_times_out() {
        let spec = RunSpec::new("/bin/sh", &["-c", "echo hi; sleep 30"]);
        let (outcome, stdout, _) = capture(&spec, Duration::from_millis(300))
            .await
            .expect("capture");
        assert!(outcome.cancelled);
        assert_eq!(stdout, "hi\n");
    }
}
