//! Downloading (installing) and verifying a model with Splash's own
//! installer, exactly as `splash serve` runs it (`install/launcher.py`
//! `_ensure_installed`): `engine/splash device-check`, then
//! `<libexec>/python/bin/python3 install/models.py --models <dir> --model ID
//! [--revision R] [--draft-model D] [--language-only] prepare` from libexec.
//!
//! Progress comes from the hub cache on disk ([`super::progress`]) and is
//! sent as `models://progress`; installer output goes out as `models://log`.
//! Cancel sends SIGINT (exit 130); the next download resumes partial files.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::installed::{SelectionOptions, Sidecar};
use super::progress::{DownloadPhase, ModelProgress, Tracker};
use super::{hfcache, ids};
use crate::install::brew::SplashLocation;
use crate::install::runner::{self, CancelToken, RunObserver, RunSpec, StopGrace, Stream};
use crate::install::{now_ms, OpError, OpResult};

pub const EVENT_PROGRESS: &str = "models://progress";
pub const EVENT_LOG: &str = "models://log";
const POLL_INTERVAL: Duration = Duration::from_millis(500);
const DEVICE_CHECK_TIMEOUT: Duration = Duration::from_secs(60);

/// What to install or verify: `--model` and its source options.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelRequest {
    /// OWNER/REPO[:VARIANT]
    pub model: String,
    pub revision: Option<String>,
    /// A DFlash2 repository ID or a local directory.
    pub draft_model: Option<String>,
    #[serde(default)]
    pub language_only: bool,
    /// Settings > Storage "Model download folder" (HF_HUB_CACHE).
    pub hf_cache_dir: Option<String>,
}

impl ModelRequest {
    pub fn options(&self) -> SelectionOptions {
        SelectionOptions {
            revision: self.revision.clone().filter(|r| !r.is_empty()),
            draft_model: self.draft_model.clone().filter(|d| !d.is_empty()),
            language_only: self.language_only,
        }
    }

    /// The selection link, relative to the models folder: the job key.
    pub fn key(&self) -> OpResult<String> {
        let o = self.options();
        ids::selection_link_rel(
            &self.model,
            o.revision.as_deref(),
            o.language_only,
            o.draft_model.as_deref(),
        )
        .map_err(OpError::InvalidRequest)
    }

    pub fn validate(&self) -> OpResult<()> {
        ids::split_model_id(&self.model).map_err(OpError::InvalidRequest)?;
        if let Some(revision) = self.options().revision {
            let ok = revision.len() <= 255
                && !revision.starts_with('-')
                && revision.chars().all(|c| c.is_ascii_graphic());
            if !ok {
                return Err(OpError::InvalidRequest(format!(
                    "invalid revision: {revision}"
                )));
            }
        }
        if let Some(draft) = self.options().draft_model {
            let local = Path::new(&draft);
            if !(local.is_absolute() && local.is_dir()) && ids::validate_repo_id(&draft).is_err() {
                return Err(OpError::InvalidRequest(
                    "draft model must be a local DFlash2 directory (absolute path) or a Hugging Face repository ID".into(),
                ));
            }
        }
        Ok(())
    }
}

/// The installer command line. `action` is `["prepare"]`, `["verify"]` or
/// `["verify", "--full"]`. Secrets are never on it: huggingface_hub reads the
/// saved token itself.
pub fn installer_spec(
    splash: &SplashLocation,
    models_dir: &Path,
    request: &ModelRequest,
    action: &[&str],
) -> RunSpec {
    let libexec = PathBuf::from(&splash.libexec);
    let options = request.options();
    let mut args = vec![
        libexec.join("install/models.py").display().to_string(),
        "--models".into(),
        models_dir.display().to_string(),
        "--model".into(),
        request.model.clone(),
    ];
    if let Some(revision) = options.revision {
        args.extend(["--revision".into(), revision]);
    }
    if let Some(draft) = options.draft_model {
        args.extend(["--draft-model".into(), draft]);
    }
    if options.language_only {
        args.push("--language-only".into());
    }
    args.extend(action.iter().map(|a| a.to_string()));

    let mut env = vec![
        ("HF_HUB_DISABLE_PROGRESS_BARS".to_string(), "1".to_string()),
        ("PYTHONUNBUFFERED".into(), "1".into()),
        ("PYTHONDONTWRITEBYTECODE".into(), "1".into()),
        ("NO_PROXY".into(), no_proxy()),
    ];
    if let Some(dir) = request
        .hf_cache_dir
        .as_deref()
        .filter(|d| !d.trim().is_empty())
    {
        env.push((
            "HF_HUB_CACHE".into(),
            hfcache::expand_home(Path::new(dir.trim()))
                .display()
                .to_string(),
        ));
    }
    RunSpec {
        program: PathBuf::from(&splash.python),
        args,
        cwd: Some(libexec),
        env,
    }
}

/// NO_PROXY with loopback added (docs/terminal-parity.md rule 8).
fn no_proxy() -> String {
    let current = std::env::var("NO_PROXY")
        .or_else(|_| std::env::var("no_proxy"))
        .unwrap_or_default();
    let mut parts: Vec<String> = current
        .split(',')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(String::from)
        .collect();
    for host in ["127.0.0.1", "localhost"] {
        if !parts.iter().any(|p| p == host) {
            parts.push(host.into());
        }
    }
    parts.join(",")
}

// --- jobs ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobKind {
    Download,
    Verify,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub key: String,
    pub model: String,
    pub kind: JobKind,
    pub started_at_ms: u64,
    pub last: Option<ModelProgress>,
}

struct Job {
    snapshot: JobSnapshot,
    cancel: CancelToken,
}

/// Running downloads and verifications, by selection link.
#[derive(Default)]
pub struct Jobs {
    jobs: Mutex<HashMap<String, Job>>,
}

pub static JOBS: std::sync::LazyLock<Jobs> = std::sync::LazyLock::new(Jobs::default);

pub struct JobGuard<'a> {
    jobs: &'a Jobs,
    pub key: String,
    pub cancel: CancelToken,
}

impl Drop for JobGuard<'_> {
    fn drop(&mut self) {
        self.jobs.lock().remove(&self.key);
    }
}

impl JobGuard<'_> {
    pub fn update(&self, progress: &ModelProgress) {
        if let Some(job) = self.jobs.lock().get_mut(&self.key) {
            job.snapshot.last = Some(progress.clone());
        }
    }
}

impl Jobs {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Job>> {
        self.jobs.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn begin(&self, key: &str, model: &str, kind: JobKind) -> OpResult<JobGuard<'_>> {
        let mut jobs = self.lock();
        if let Some(job) = jobs.get(key) {
            return Err(OpError::Busy(format!(
                "{model} is already being {}",
                if job.snapshot.kind == JobKind::Download {
                    "downloaded"
                } else {
                    "checked"
                }
            )));
        }
        let cancel = CancelToken::new();
        jobs.insert(
            key.to_string(),
            Job {
                snapshot: JobSnapshot {
                    key: key.to_string(),
                    model: model.to_string(),
                    kind,
                    started_at_ms: now_ms(),
                    last: None,
                },
                cancel: cancel.clone(),
            },
        );
        Ok(JobGuard {
            jobs: self,
            key: key.to_string(),
            cancel,
        })
    }

    pub fn cancel(&self, key: &str) -> bool {
        match self.lock().get(key) {
            Some(job) => {
                job.cancel.cancel();
                true
            }
            None => false,
        }
    }

    /// Cancels every job for `model` (whatever its options). Returns how many.
    pub fn cancel_model(&self, model: &str) -> usize {
        let jobs = self.lock();
        let matching: Vec<&Job> = jobs
            .values()
            .filter(|j| j.snapshot.model == model || j.snapshot.key == model)
            .collect();
        for job in &matching {
            job.cancel.cancel();
        }
        matching.len()
    }

    pub fn list(&self) -> Vec<JobSnapshot> {
        let mut out: Vec<JobSnapshot> = self.lock().values().map(|j| j.snapshot.clone()).collect();
        out.sort_by_key(|j| j.started_at_ms);
        out
    }
}

/// Payload of `models://log`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelLog {
    pub key: String,
    pub model: String,
    pub kind: JobKind,
    pub line: String,
    pub stream: Stream,
    pub ts_ms: u64,
}

/// Where download/verify events go: Tauri in the app, a recorder in tests.
pub trait ModelEvents: Send + Sync {
    fn progress(&self, progress: &ModelProgress);
    fn log(&self, line: &ModelLog);
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub key: String,
    pub model: String,
    pub ok: bool,
    pub cancelled: bool,
    pub exit_code: Option<i32>,
    pub phase: DownloadPhase,
    pub error: Option<String>,
    /// The selection link it installed (absolute).
    pub link: String,
    /// Bytes fetched across every source.
    pub bytes_downloaded: u64,
}

struct DownloadObserver<'a> {
    tracker: Tracker,
    guard: &'a JobGuard<'a>,
    events: &'a dyn ModelEvents,
    model: String,
    kind: JobKind,
    last_stderr: Option<String>,
}

impl DownloadObserver<'_> {
    fn emit_progress(&self) {
        let progress = self.tracker.snapshot(now_ms());
        self.guard.update(&progress);
        self.events.progress(&progress);
    }

    fn finish(
        &mut self,
        link: &str,
        phase: DownloadPhase,
        exit_code: Option<i32>,
        error: Option<String>,
    ) -> DownloadResult {
        self.tracker.finish(phase, error.clone());
        self.emit_progress();
        let snapshot = self.tracker.snapshot(now_ms());
        DownloadResult {
            key: self.guard.key.clone(),
            model: self.model.clone(),
            ok: phase == DownloadPhase::Done,
            cancelled: phase == DownloadPhase::Cancelled,
            exit_code,
            phase,
            error,
            link: link.to_string(),
            bytes_downloaded: snapshot.overall_done,
        }
    }

    fn emit_log(&self, stream: Stream, line: &str) {
        self.events.log(&ModelLog {
            key: self.guard.key.clone(),
            model: self.model.clone(),
            kind: self.kind,
            line: line.to_string(),
            stream,
            ts_ms: now_ms(),
        });
    }
}

impl RunObserver for DownloadObserver<'_> {
    fn line(&mut self, stream: Stream, line: &str) {
        if stream == Stream::Stderr && !line.trim().is_empty() {
            self.last_stderr = Some(line.trim().to_string());
        }
        self.emit_log(stream, line);
        // Only the installer's own messages (stdout) move the phase: library
        // warnings on stderr arrive mid-download and must not end the fetch.
        if stream == Stream::Stdout && self.tracker.on_line(line) {
            self.emit_progress();
        }
    }

    fn tick(&mut self) {
        if self.tracker.phase() == DownloadPhase::Downloading {
            let progress = self.tracker.poll(now_ms());
            self.guard.update(&progress);
            self.events.progress(&progress);
        }
    }
}

/// The device check `splash serve` runs before downloading (no GPU work:
/// it reads the chip and OS). Err carries the binary's own refusal.
pub async fn device_check(splash: &SplashLocation) -> OpResult<()> {
    let spec = RunSpec::new(&splash.engine, &["device-check"]);
    let (outcome, _stdout, stderr) = runner::capture(&spec, DEVICE_CHECK_TIMEOUT).await?;
    if outcome.success() {
        return Ok(());
    }
    let last = stderr
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim().trim_start_matches("error: ").to_string());
    Err(OpError::Failed(last.unwrap_or_else(
        || match outcome.code {
            Some(code) => format!("the engine's device check failed (status {code})"),
            None => "the engine's device check was stopped".to_string(),
        },
    )))
}

/// Runs the installer for `request` under `guard`, reporting to `events`.
/// `skip_device_check` exists for tests with a fake interpreter.
pub async fn download(
    splash: &SplashLocation,
    models_dir: &Path,
    hub_cache: &Path,
    request: &ModelRequest,
    guard: &JobGuard<'_>,
    events: &dyn ModelEvents,
    skip_device_check: bool,
) -> DownloadResult {
    let key = guard.key.clone();
    let mut observer = DownloadObserver {
        tracker: Tracker::new(&request.model, &key, hub_cache.to_path_buf()),
        guard,
        events,
        model: request.model.clone(),
        kind: JobKind::Download,
        last_stderr: None,
    };
    observer.emit_progress();

    let link = models_dir.join(&key).display().to_string();
    if !skip_device_check {
        observer.emit_log(Stream::System, &format!("$ {} device-check", splash.engine));
        if let Err(error) = device_check(splash).await {
            return observer.finish(&link, DownloadPhase::Failed, None, Some(error.to_string()));
        }
    }
    if guard.cancel.is_cancelled() {
        return observer.finish(
            &link,
            DownloadPhase::Cancelled,
            None,
            Some("cancelled".into()),
        );
    }

    let spec = installer_spec(splash, models_dir, request, &["prepare"]);
    observer.emit_log(Stream::System, &format!("$ {}", spec.display()));
    let outcome = runner::run(
        &spec,
        &guard.cancel,
        StopGrace::DEFAULT,
        Some(POLL_INTERVAL),
        &mut observer,
    )
    .await;
    match outcome {
        Ok(outcome) if outcome.cancelled || outcome.code == Some(130) => observer.finish(
            &link,
            DownloadPhase::Cancelled,
            outcome.code,
            Some("cancelled; the download resumes next time".into()),
        ),
        Ok(outcome) if outcome.success() => {
            observer.finish(&link, DownloadPhase::Done, outcome.code, None)
        }
        Ok(outcome) => {
            let error = observer
                .last_stderr
                .clone()
                .map(|l| l.trim_start_matches("error: ").to_string())
                .unwrap_or_else(|| "model download or verification failed".to_string());
            observer.finish(&link, DownloadPhase::Failed, outcome.code, Some(error))
        }
        Err(error) => observer.finish(
            &link,
            DownloadPhase::Failed,
            None,
            Some(format!("could not start the installer: {error}")),
        ),
    }
}

/// Records a hashed selection's options so the installed list can show them.
pub fn record_selection(sidecar: &Sidecar, request: &ModelRequest) -> OpResult<()> {
    let key = request.key()?;
    if key.starts_with(".selections/") {
        sidecar.record(&key, &request.model, &request.options())?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    pub key: String,
    pub model: String,
    pub full: bool,
    pub ok: bool,
    pub cancelled: bool,
    pub exit_code: Option<i32>,
    /// "preflight passed" or the installer's error.
    pub message: String,
    pub output: Vec<String>,
}

/// `models.py --model ID [options] verify [--full]`. A full check re-reads
/// every file (tens of GB).
pub async fn verify(
    splash: &SplashLocation,
    models_dir: &Path,
    request: &ModelRequest,
    full: bool,
    guard: &JobGuard<'_>,
    events: &dyn ModelEvents,
) -> VerifyResult {
    let action: &[&str] = if full {
        &["verify", "--full"]
    } else {
        &["verify"]
    };
    let spec = installer_spec(splash, models_dir, request, action);
    let mut output: Vec<String> = Vec::new();
    let key = guard.key.clone();
    let mut observer = |stream: Stream, line: &str| {
        output.push(line.to_string());
        events.log(&ModelLog {
            key: key.clone(),
            model: request.model.clone(),
            kind: JobKind::Verify,
            line: line.to_string(),
            stream,
            ts_ms: now_ms(),
        });
    };
    let outcome = runner::run(
        &spec,
        &guard.cancel,
        StopGrace::DEFAULT,
        None,
        &mut observer,
    )
    .await;
    let (ok, cancelled, exit_code) = match &outcome {
        Ok(o) => (
            o.success() && !o.cancelled,
            o.cancelled || o.code == Some(130),
            o.code,
        ),
        Err(_) => (false, false, None),
    };
    let message = match &outcome {
        Err(error) => format!("could not start the verifier: {error}"),
        Ok(_) if cancelled => "cancelled".to_string(),
        Ok(_) => output
            .iter()
            .rev()
            .find(|l| !l.trim().is_empty())
            .map(|l| l.trim_start_matches("error: ").to_string())
            .unwrap_or_default(),
    };
    VerifyResult {
        key: guard.key.clone(),
        model: request.model.clone(),
        full,
        ok,
        cancelled,
        exit_code,
        message,
        output,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::brew::SplashSource;
    use crate::install::testutil::TempDir;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Mutex as StdMutex;

    #[derive(Default)]
    struct Recorder {
        progress: StdMutex<Vec<ModelProgress>>,
        logs: StdMutex<Vec<ModelLog>>,
    }

    impl ModelEvents for Recorder {
        fn progress(&self, progress: &ModelProgress) {
            self.progress.lock().expect("lock").push(progress.clone());
        }
        fn log(&self, line: &ModelLog) {
            self.logs.lock().expect("lock").push(line.clone());
        }
    }

    /// A libexec whose "python" is a shell script standing in for models.py.
    fn fake_splash(dir: &TempDir, script: &str) -> SplashLocation {
        let python = dir.write(
            "libexec/python/bin/python3",
            &format!("#!/bin/sh\n{script}\n"),
        );
        std::fs::set_permissions(&python, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        SplashLocation {
            source: SplashSource::Homebrew,
            libexec: dir.path().join("libexec").display().to_string(),
            version: Some("1.2.0".into()),
            python: python.display().to_string(),
            python_ok: true,
            engine: dir
                .path()
                .join("libexec/engine/splash")
                .display()
                .to_string(),
        }
    }

    fn request(model: &str) -> ModelRequest {
        ModelRequest {
            model: model.into(),
            ..Default::default()
        }
    }

    #[test]
    fn builds_the_installer_command_like_the_launcher() {
        let dir = TempDir::new("spec");
        let splash = fake_splash(&dir, "exit 0");
        let req = ModelRequest {
            model: "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M".into(),
            revision: Some("main".into()),
            draft_model: Some("incoai/Qwen3.8-27B-DFlash2".into()),
            language_only: true,
            hf_cache_dir: Some("/Volumes/M/hf".into()),
        };
        let spec = installer_spec(&splash, Path::new("/m"), &req, &["prepare"]);
        assert_eq!(spec.program, PathBuf::from(&splash.python));
        assert_eq!(spec.cwd.as_deref(), Some(Path::new(&splash.libexec)));
        let models_py = format!("{}/install/models.py", splash.libexec);
        assert_eq!(
            spec.args,
            vec![
                models_py.as_str(),
                "--models",
                "/m",
                "--model",
                "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M",
                "--revision",
                "main",
                "--draft-model",
                "incoai/Qwen3.8-27B-DFlash2",
                "--language-only",
                "prepare"
            ]
        );
        let env: HashMap<_, _> = spec.env.iter().cloned().collect();
        assert_eq!(env["HF_HUB_DISABLE_PROGRESS_BARS"], "1");
        assert_eq!(env["HF_HUB_CACHE"], "/Volumes/M/hf");
        assert!(env["NO_PROXY"].contains("127.0.0.1"));
        let verify = installer_spec(
            &splash,
            Path::new("/m"),
            &request("a/b"),
            &["verify", "--full"],
        );
        assert_eq!(
            verify.args[verify.args.len() - 2..],
            ["verify".to_string(), "--full".to_string()]
        );
    }

    #[test]
    fn validates_requests() {
        assert!(request("a/b").validate().is_ok());
        assert!(request("bad").validate().is_err());
        let mut r = request("a/b");
        r.revision = Some("--evil".into());
        assert!(r.validate().is_err());
        r.revision = Some("main".into());
        r.draft_model = Some("relative/dir/../x".into());
        assert!(r.validate().is_err());
        r.draft_model = Some("incoai/Qwen3.8-27B-DFlash2".into());
        assert!(r.validate().is_ok());
        assert_eq!(request("a/b").key().expect("key"), "a/b");
        r.language_only = true;
        assert!(r.key().expect("key").starts_with(".selections/"));
    }

    #[test]
    fn one_job_per_selection() {
        let jobs = Jobs::default();
        let guard = jobs.begin("a/b", "a/b", JobKind::Download).expect("begin");
        assert!(matches!(
            jobs.begin("a/b", "a/b", JobKind::Verify),
            Err(OpError::Busy(_))
        ));
        let _other = jobs.begin("c/d", "c/d", JobKind::Download).expect("other");
        assert_eq!(jobs.list().len(), 2);
        assert_eq!(jobs.cancel_model("a/b"), 1);
        assert!(guard.cancel.is_cancelled());
        drop(guard);
        assert!(!jobs.list().iter().any(|j| j.key == "a/b"));
        assert!(!jobs.cancel("a/b"));
    }

    #[tokio::test]
    async fn downloads_with_a_fake_installer() {
        let dir = TempDir::new("download");
        let cache = dir.path().join("hub");
        let blobs = cache.join(ids::cache_folder_name("a/b")).join("blobs");
        std::fs::create_dir_all(&blobs).expect("mkdir");
        // The fake installer announces 0.000003 GB (3000 bytes), writes a
        // partial blob in steps, renames it, and reports success.
        let script = format!(
            r#"echo "Selected a.gguf from a/b."
echo "Fetching 1 file(s), 0.000003 GB, from a/b@abc; cached files are reused."
head -c 1000 /dev/zero > "{b}/blob1.x.incomplete"; sleep 0.6
echo "UserWarning: slow network" >&2
head -c 2000 /dev/zero > "{b}/blob1.x.incomplete"; sleep 0.6
mv "{b}/blob1.x.incomplete" "{b}/blob1"; head -c 1000 /dev/zero >> "{b}/blob1"
echo "Installed verified Splash model a/b in /m/a/b"
echo "args: $*""#,
            b = blobs.display()
        );
        let splash = fake_splash(&dir, &script);
        let jobs = Jobs::default();
        let guard = jobs.begin("a/b", "a/b", JobKind::Download).expect("begin");
        let events = Recorder::default();
        let result = download(
            &splash,
            &dir.path().join("models"),
            &cache,
            &request("a/b"),
            &guard,
            &events,
            true,
        )
        .await;
        assert!(result.ok, "{result:?}");
        assert_eq!(result.phase, DownloadPhase::Done);
        assert_eq!(result.bytes_downloaded, 3000);

        let progress = events.progress.into_inner().expect("lock");
        assert!(progress
            .iter()
            .any(|p| p.phase == DownloadPhase::Downloading
                && p.bytes_done > 0
                && p.bytes_done < 3000));
        assert!(progress.iter().any(|p| p.phase == DownloadPhase::Preparing));
        // The stderr warning (after the first 1000 bytes) did not end the
        // fetch: polling went on and saw the next 2000 bytes.
        assert!(
            progress
                .iter()
                .any(|p| p.phase == DownloadPhase::Downloading && p.bytes_done == 2000),
            "{progress:?}"
        );
        let last = progress.last().expect("last");
        assert_eq!(last.phase, DownloadPhase::Done);
        assert_eq!((last.bytes_done, last.bytes_total), (3000, 3000));
        let logs = events.logs.into_inner().expect("lock");
        assert!(logs
            .iter()
            .any(|l| l.line.starts_with("args: ") && l.line.ends_with("--model a/b prepare")));
        assert!(logs
            .iter()
            .any(|l| l.stream == Stream::System && l.line.contains("install/models.py")));
    }

    #[tokio::test]
    async fn cancels_a_download() {
        let dir = TempDir::new("download-cancel");
        let splash = fake_splash(
            &dir,
            r#"trap 'echo interrupted; exit 130' INT
echo "Fetching 1 file(s), 1.00 GB, from a/b@abc; cached files are reused."
sleep 30 & wait"#,
        );
        let jobs = Jobs::default();
        let guard = jobs.begin("a/b", "a/b", JobKind::Download).expect("begin");
        let cancel = guard.cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(400)).await;
            cancel.cancel();
        });
        let events = Recorder::default();
        let result = download(
            &splash,
            &dir.path().join("models"),
            &dir.path().join("hub"),
            &request("a/b"),
            &guard,
            &events,
            true,
        )
        .await;
        assert!(result.cancelled, "{result:?}");
        assert_eq!(result.phase, DownloadPhase::Cancelled);
    }

    #[tokio::test]
    async fn reports_installer_errors() {
        let dir = TempDir::new("download-fail");
        let splash = fake_splash(
            &dir,
            r#"echo "error: model must be a full Hugging Face repository ID (owner/repo)" >&2; exit 1"#,
        );
        let jobs = Jobs::default();
        let guard = jobs.begin("a/b", "a/b", JobKind::Download).expect("begin");
        let events = Recorder::default();
        let result = download(
            &splash,
            &dir.path().join("models"),
            &dir.path().join("hub"),
            &request("a/b"),
            &guard,
            &events,
            true,
        )
        .await;
        assert!(!result.ok);
        assert_eq!(result.phase, DownloadPhase::Failed);
        assert_eq!(
            result.error.as_deref(),
            Some("model must be a full Hugging Face repository ID (owner/repo)")
        );
    }

    #[tokio::test]
    async fn verifies_with_the_installer() {
        let dir = TempDir::new("verify");
        let splash = fake_splash(&dir, r#"echo "Splash model a/b preflight passed (full).""#);
        let jobs = Jobs::default();
        let guard = jobs.begin("a/b", "a/b", JobKind::Verify).expect("begin");
        let events = Recorder::default();
        let result = verify(
            &splash,
            Path::new("/m"),
            &request("a/b"),
            true,
            &guard,
            &events,
        )
        .await;
        assert!(result.ok);
        assert_eq!(result.message, "Splash model a/b preflight passed (full).");
        assert_eq!(events.logs.lock().expect("lock").len(), 1);
    }

    #[test]
    fn records_hashed_selections_only() {
        let dir = TempDir::new("record");
        let sidecar = Sidecar::new(dir.path().join("s.json"));
        record_selection(&sidecar, &request("a/b")).expect("plain");
        assert!(sidecar.load().is_empty());
        let mut r = request("a/b");
        r.language_only = true;
        record_selection(&sidecar, &r).expect("hashed");
        let loaded = sidecar.load();
        assert_eq!(loaded.len(), 1);
        assert!(loaded.values().all(|e| e.options.language_only));
    }
}
