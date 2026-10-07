//! `brew install|upgrade|uninstall incoai/tap/splash` as one cancellable job.
//!
//! Each output line is sent as an `install://progress` event
//! ([`InstallProgress`]) with the phase read from brew's `==>` headings. Only
//! one brew job runs at a time.

use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::brew::{self, FORMULA};
use super::runner::{self, CancelToken, RunSpec, StopGrace, Stream};
use super::{now_ms, OpError, OpResult};

pub const EVENT_PROGRESS: &str = "install://progress";
/// Lines kept for the result's `logTail`.
const LOG_TAIL: usize = 200;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BrewAction {
    Install,
    Upgrade,
    Uninstall,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InstallPhase {
    Starting,
    /// `brew update` (upgrade only).
    Updating,
    Downloading,
    Installing,
    Uninstalling,
    /// Caveats, summary, cleanup.
    Finishing,
    Done,
    Failed,
    Cancelled,
}

/// Payload of `install://progress`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub job_id: String,
    pub action: BrewAction,
    pub phase: InstallPhase,
    /// None for a phase-only event (the final one).
    pub line: Option<String>,
    pub stream: Stream,
    pub ts_ms: u64,
    /// Set on the final event.
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrewRunResult {
    pub job_id: String,
    pub action: BrewAction,
    pub ok: bool,
    pub cancelled: bool,
    pub exit_code: Option<i32>,
    pub phase: InstallPhase,
    /// The last lines of output, for "Copy log" after a failure.
    pub log_tail: Vec<String>,
    /// The last error-looking line, when it failed.
    pub error: Option<String>,
}

/// The brew invocations for an action, run in order (stop at the first failure).
pub fn steps(action: BrewAction) -> Vec<Vec<&'static str>> {
    match action {
        BrewAction::Install => vec![vec!["install", FORMULA]],
        // `brew update` refreshes the tap so the upgrade sees the new formula.
        BrewAction::Upgrade => vec![vec!["update"], vec!["upgrade", FORMULA]],
        BrewAction::Uninstall => vec![vec!["uninstall", FORMULA]],
    }
}

/// The phase a brew output line moves to, given the current phase.
pub fn phase_for_line(current: InstallPhase, line: &str) -> InstallPhase {
    let line = line.trim_start();
    let heading = line.strip_prefix("==>").map(str::trim_start).unwrap_or("");
    let starts = |prefixes: &[&str]| prefixes.iter().any(|p| heading.starts_with(p));
    if line.starts_with("Uninstalling ") || starts(&["Uninstalling"]) {
        InstallPhase::Uninstalling
    } else if starts(&["Updating Homebrew", "Auto-updating", "Updated "]) {
        InstallPhase::Updating
    } else if starts(&["Fetching", "Downloading"]) {
        InstallPhase::Downloading
    } else if starts(&["Pouring", "Installing", "Upgrading", "Tapping"]) {
        InstallPhase::Installing
    } else if starts(&["Caveats", "Summary", "Running `brew cleanup`", "Cleaning"]) {
        InstallPhase::Finishing
    } else {
        current
    }
}

/// The one brew job slot.
#[derive(Default)]
pub struct JobSlot {
    active: Mutex<Option<(String, BrewAction, CancelToken)>>,
}

pub static JOBS: std::sync::LazyLock<JobSlot> = std::sync::LazyLock::new(JobSlot::default);

/// Clears the slot when the job ends, however it ends.
pub struct JobGuard<'a> {
    slot: &'a JobSlot,
    pub id: String,
    pub cancel: CancelToken,
}

impl Drop for JobGuard<'_> {
    fn drop(&mut self) {
        let mut active = self.slot.active.lock().unwrap_or_else(|e| e.into_inner());
        if active.as_ref().is_some_and(|(id, _, _)| id == &self.id) {
            *active = None;
        }
    }
}

impl JobSlot {
    pub fn begin(&self, action: BrewAction) -> OpResult<JobGuard<'_>> {
        let mut active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, running, _)) = active.as_ref() {
            return Err(OpError::Busy(format!(
                "Homebrew is already running ({running:?}); wait for it or cancel it"
            )));
        }
        let id = format!("brew-{}", now_ms());
        let cancel = CancelToken::new();
        *active = Some((id.clone(), action, cancel.clone()));
        Ok(JobGuard {
            slot: self,
            id,
            cancel,
        })
    }

    /// Cancels the running job. False when none runs.
    pub fn cancel(&self) -> bool {
        let active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        match active.as_ref() {
            Some((_, _, cancel)) => {
                cancel.cancel();
                true
            }
            None => false,
        }
    }

    pub fn active(&self) -> Option<(String, BrewAction)> {
        let active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        active.as_ref().map(|(id, action, _)| (id.clone(), *action))
    }
}

fn looks_like_error(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.starts_with("error") || lower.contains("error:") || lower.starts_with("fatal")
}

/// Runs every step of `action` with `brew`, reporting through `emit`.
pub async fn run_job(
    brew: &Path,
    action: BrewAction,
    guard: &JobGuard<'_>,
    emit: &(dyn Fn(&InstallProgress) + Send + Sync),
) -> BrewRunResult {
    let job_id = guard.id.clone();
    let mut phase = InstallPhase::Starting;
    let mut tail: Vec<String> = Vec::new();
    let mut error: Option<String> = None;
    let mut exit_code = None;
    let mut cancelled = false;

    let send =
        |phase: InstallPhase, line: Option<String>, stream: Stream, exit_code: Option<i32>| {
            emit(&InstallProgress {
                job_id: job_id.clone(),
                action,
                phase,
                line,
                stream,
                ts_ms: now_ms(),
                exit_code,
            });
        };

    for (index, args) in steps(action).into_iter().enumerate() {
        let mut spec = RunSpec::new(brew, &args);
        spec.env = brew::brew_env(action == BrewAction::Install);
        if args == ["update"] {
            phase = InstallPhase::Updating;
        } else if action == BrewAction::Uninstall {
            phase = InstallPhase::Uninstalling;
        } else if index > 0 || action == BrewAction::Install {
            phase = InstallPhase::Installing;
        }
        let command_line = format!("$ brew {}", args.join(" "));
        send(phase, Some(command_line.clone()), Stream::System, None);
        tail.push(command_line);

        let mut observer = |stream: Stream, line: &str| {
            phase = phase_for_line(phase, line);
            if stream == Stream::Stderr && looks_like_error(line) {
                error = Some(line.to_string());
            }
            tail.push(line.to_string());
            if tail.len() > LOG_TAIL {
                tail.remove(0);
            }
            send(phase, Some(line.to_string()), stream, None);
        };
        let outcome = runner::run(
            &spec,
            &guard.cancel,
            StopGrace::DEFAULT,
            None,
            &mut observer,
        )
        .await;
        match outcome {
            Ok(outcome) => {
                exit_code = outcome.code;
                cancelled = outcome.cancelled;
                if !outcome.success() || cancelled {
                    break;
                }
            }
            Err(e) => {
                error = Some(format!("could not run brew: {e}"));
                exit_code = None;
                break;
            }
        }
    }

    let ok = exit_code == Some(0) && !cancelled;
    let phase = if cancelled {
        InstallPhase::Cancelled
    } else if ok {
        InstallPhase::Done
    } else {
        InstallPhase::Failed
    };
    if !ok && !cancelled && error.is_none() {
        error = Some(match exit_code {
            Some(code) => format!("brew exited with status {code}"),
            None => "brew was stopped by a signal".to_string(),
        });
    }
    send(phase, None, Stream::System, exit_code);
    BrewRunResult {
        job_id,
        action,
        ok,
        cancelled,
        exit_code,
        phase,
        log_tail: tail,
        error: if ok { None } else { error },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::testutil::TempDir;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Mutex as StdMutex;

    #[test]
    fn steps_per_action() {
        assert_eq!(steps(BrewAction::Install), vec![vec!["install", FORMULA]]);
        assert_eq!(steps(BrewAction::Upgrade).len(), 2);
        assert_eq!(steps(BrewAction::Upgrade)[0], vec!["update"]);
        assert_eq!(
            steps(BrewAction::Uninstall),
            vec![vec!["uninstall", FORMULA]]
        );
    }

    #[test]
    fn phases_follow_brew_headings() {
        use InstallPhase::*;
        assert_eq!(
            phase_for_line(Starting, "==> Fetching downloads for: splash"),
            Downloading
        );
        assert_eq!(
            phase_for_line(
                Downloading,
                "==> Pouring splash--1.2.0.arm64_tahoe.bottle.tar.gz"
            ),
            Installing
        );
        assert_eq!(phase_for_line(Installing, "==> Caveats"), Finishing);
        assert_eq!(phase_for_line(Installing, "==> Summary"), Finishing);
        assert_eq!(
            phase_for_line(
                Starting,
                "Uninstalling /opt/homebrew/Cellar/splash/1.2.0... (1,234 files, 210MB)"
            ),
            Uninstalling
        );
        assert_eq!(
            phase_for_line(Starting, "==> Updating Homebrew..."),
            Updating
        );
        assert_eq!(phase_for_line(Installing, "some other line"), Installing);
    }

    #[test]
    fn one_job_at_a_time() {
        let slot = JobSlot::default();
        assert!(!slot.cancel());
        let guard = slot.begin(BrewAction::Install).expect("begin");
        assert!(matches!(
            slot.begin(BrewAction::Upgrade),
            Err(OpError::Busy(_))
        ));
        assert_eq!(slot.active().map(|a| a.1), Some(BrewAction::Install));
        assert!(slot.cancel());
        assert!(guard.cancel.is_cancelled());
        drop(guard);
        assert!(slot.active().is_none());
        assert!(slot.begin(BrewAction::Uninstall).is_ok());
    }

    fn fake_brew(dir: &TempDir, script: &str) -> std::path::PathBuf {
        let path = dir.write("brew", &format!("#!/bin/sh\n{script}\n"));
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        path
    }

    #[tokio::test]
    async fn streams_a_fake_install() {
        let dir = TempDir::new("brew-job");
        let brew = fake_brew(
            &dir,
            r#"echo "==> Fetching downloads for: splash"
echo "==> Pouring splash--1.2.0.bottle.tar.gz"
echo "==> Caveats"
echo "args: $*""#,
        );
        let slot = JobSlot::default();
        let guard = slot.begin(BrewAction::Install).expect("begin");
        let events = StdMutex::new(Vec::<InstallProgress>::new());
        let emit = |p: &InstallProgress| events.lock().expect("lock").push(p.clone());
        let result = run_job(&brew, BrewAction::Install, &guard, &emit).await;
        assert!(result.ok, "{result:?}");
        assert_eq!(result.phase, InstallPhase::Done);
        let events = events.into_inner().expect("lock");
        let phases: Vec<InstallPhase> = events.iter().map(|e| e.phase).collect();
        assert!(phases.contains(&InstallPhase::Downloading));
        assert!(phases.contains(&InstallPhase::Installing));
        assert!(phases.contains(&InstallPhase::Finishing));
        assert_eq!(events.last().map(|e| e.exit_code), Some(Some(0)));
        assert!(result
            .log_tail
            .iter()
            .any(|l| l == "args: install incoai/tap/splash"));
    }

    #[tokio::test]
    async fn upgrade_stops_at_a_failed_step() {
        let dir = TempDir::new("brew-fail");
        let brew = fake_brew(&dir, r#"echo "Error: no network" >&2; exit 1"#);
        let slot = JobSlot::default();
        let guard = slot.begin(BrewAction::Upgrade).expect("begin");
        let count = StdMutex::new(0usize);
        let emit = |p: &InstallProgress| {
            if p.line.as_deref().is_some_and(|l| l.starts_with("$ brew")) {
                *count.lock().expect("lock") += 1;
            }
        };
        let result = run_job(&brew, BrewAction::Upgrade, &guard, &emit).await;
        assert!(!result.ok);
        assert_eq!(result.phase, InstallPhase::Failed);
        assert_eq!(result.error.as_deref(), Some("Error: no network"));
        assert_eq!(
            *count.lock().expect("lock"),
            1,
            "the upgrade step must not run"
        );
    }

    #[tokio::test]
    async fn cancels_a_running_job() {
        let dir = TempDir::new("brew-cancel");
        let brew = fake_brew(
            &dir,
            "trap 'exit 130' INT; echo '==> Downloading'; sleep 30 & wait",
        );
        let slot = JobSlot::default();
        let guard = slot.begin(BrewAction::Install).expect("begin");
        let cancel = guard.cancel.clone();
        let emit = move |p: &InstallProgress| {
            if p.line.as_deref() == Some("==> Downloading") {
                cancel.cancel();
            }
        };
        let result = run_job(&brew, BrewAction::Install, &guard, &emit).await;
        assert!(result.cancelled);
        assert_eq!(result.phase, InstallPhase::Cancelled);
        assert!(!result.ok);
    }
}
