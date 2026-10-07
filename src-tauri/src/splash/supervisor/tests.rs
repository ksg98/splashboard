//! Supervisor tests with real processes (`/bin/sh` stand-ins for Splash) and
//! a stub HTTP server for `/ready` and `/status`. The live test against a
//! real Splash is `live_start_stop` (ignored by default).

use super::*;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;

#[derive(Default)]
struct Recorder {
    states: Mutex<Vec<EngineState>>,
    logs: Mutex<Vec<LogLine>>,
}

impl EngineEvents for Recorder {
    fn state(&self, state: &EngineState) {
        lock_recover(&self.states).push(state.clone());
    }
    fn log(&self, line: &LogLine) {
        lock_recover(&self.logs).push(line.clone());
    }
}

impl Recorder {
    fn phases(&self) -> Vec<&'static str> {
        let mut out: Vec<&'static str> = Vec::new();
        for state in lock_recover(&self.states).iter() {
            if out.last() != Some(&state.phase.name()) {
                out.push(state.phase.name());
            }
        }
        out
    }
}

fn temp_dir(name: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!(
        "splashboard-sup-{name}-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A supervisor with private state and runtime dirs.
fn supervisor(name: &str) -> (Supervisor, Arc<Recorder>, PathBuf) {
    let events = Arc::new(Recorder::default());
    let dir = temp_dir(name);
    let runtime = dir.join("runtime");
    std::fs::create_dir_all(&runtime).unwrap();
    let sup = Supervisor::with_dirs(events.clone(), Some(dir.join("state")), Some(runtime));
    (sup, events, dir)
}

/// A free port below the ephemeral range (49152+), so it cannot collide
/// with sockets other tests bind to port 0 meanwhile.
fn free_port() -> u16 {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let base = 30_000 + (std::process::id() as u64 % 500) * 20;
    loop {
        let port = (base + NEXT.fetch_add(1, Ordering::SeqCst) % 10_000) as u16;
        if !lockfile::port_occupied(port) {
            return port;
        }
    }
}

fn shell(script: &str) -> SpawnSpec {
    SpawnSpec {
        program: PathBuf::from("/bin/sh"),
        args: vec!["-c".into(), script.into()],
        env: vec![],
        model: "test/model".into(),
        port: free_port(),
        probe: false,
        api_key: None,
        hf_cache: None,
        command: None,
    }
}

async fn wait_until(what: &str, mut check: impl FnMut() -> bool) {
    for _ in 0..200 {
        if check() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("timed out waiting for: {what}");
}

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../fixtures/splash-1.2.0")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// A stub Splash HTTP server: `/ready` -> 200, `/status` -> the current body.
async fn stub_server(port: u16, status: Arc<Mutex<String>>) {
    let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let status = status.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 2048];
                let n = socket.read(&mut buf).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_string();
                let body = if request.starts_with("GET /status") {
                    lock_recover(&status).clone()
                } else {
                    r#"{"status":"ready"}"#.to_string()
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
            });
        }
    });
}

/// A process whose command line looks like a Splash server, reaped by a
/// thread so it does not linger as a zombie once signalled.
fn fake_splash() -> u32 {
    let mut child = std::process::Command::new("/bin/sh")
        .args([
            "-c",
            "trap 'exit 0' INT TERM; while :; do sleep 0.1; done",
            "sh",
            "-m",
            "server.server",
            "x",
        ])
        .spawn()
        .unwrap();
    let pid = child.id();
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    pid
}

/// Holds `serve-<port>.lock` like Splash's launcher does.
fn hold_lock(runtime: &Path, port: u16, pid: u32) -> nix::fcntl::Flock<std::fs::File> {
    let path = lockfile::serve_lock_path(runtime, port);
    std::fs::write(
        &path,
        format!(r#"{{"pid": {pid}, "model": "incoai/Qwen3.8-27B-Splash", "port": {port}}}"#),
    )
    .unwrap();
    let file = std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap();
    nix::fcntl::Flock::lock(file, nix::fcntl::FlockArg::LockExclusiveNonblock)
        .map_err(|(_, e)| e)
        .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn sigint_stops_a_cooperative_process_and_manages_the_pidfile() {
    let (sup, events, dir) = supervisor("sigint");
    let state = sup
        .start(shell(
            "trap 'echo bye; exit 0' INT; echo hello; printf 'a\\rb\\n' >&2; while true; do sleep 0.1; done",
        ))
        .unwrap();
    assert_eq!(state.phase, Phase::Starting);
    assert_eq!(state.owner, Owner::App);
    assert!(matches!(
        sup.start(shell("true")),
        Err(AppError::AlreadyRunning(_))
    ));
    let pidfile = dir.join("state").join(PIDFILE_NAME);
    let record = lockfile::read_pidfile(&pidfile).expect("pidfile written");
    assert_eq!(Some(record.pid), state.pid);

    wait_until("hello", || sup.logs().iter().any(|l| l.line == "hello")).await;
    wait_until("\\r split", || {
        sup.logs()
            .iter()
            .any(|l| l.line == "b" && l.stream == LogStream::Stderr)
    })
    .await;

    let state = sup.stop(StopTimeouts::graceful(15)).await;
    assert_eq!(state.phase, Phase::Stopped, "{state:?}");
    assert_eq!(
        state.last_exit.map(|e| (e.code, e.requested)),
        Some((Some(0), true))
    );
    assert!(sup.logs().iter().any(|l| l.line == "bye"));
    assert_eq!(events.phases(), vec!["starting", "stopping", "stopped"]);
    assert!(!pidfile.exists(), "pidfile removed after stop");

    // The session log has every line.
    let saved = dir.join("saved.log");
    sup.save_log(&saved).unwrap();
    let text = std::fs::read_to_string(&saved).unwrap();
    assert!(text.contains("[stdout] hello"), "{text}");
    assert!(text.contains("[system] sending SIGINT"), "{text}");
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn escalates_to_sigkill() {
    let (sup, _events, dir) = supervisor("kill");
    sup.start(shell(
        "trap '' INT TERM; echo stubborn; while true; do sleep 0.1; done",
    ))
    .unwrap();
    wait_until("stubborn", || {
        sup.logs().iter().any(|l| l.line == "stubborn")
    })
    .await;
    let state = sup
        .stop(StopTimeouts {
            after_sigint: Duration::from_millis(300),
            after_sigterm: Duration::from_millis(300),
            after_sigkill: Duration::from_secs(5),
        })
        .await;
    assert_eq!(state.phase, Phase::Stopped);
    assert_eq!(state.last_exit.and_then(|e| e.signal), Some(9));
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn phases_from_log_lines_then_crash_reports_failed() {
    let (sup, events, dir) = supervisor("phases");
    // The first six lines of the recorded serve.log, then a crash.
    let serve_log = fixture("serve.log");
    let lines: Vec<&str> = serve_log.lines().take(6).collect();
    let mut script = String::new();
    for line in &lines {
        script.push_str(&format!("printf '%s\\n' '{line}'; sleep 0.05; "));
    }
    script.push_str("echo 'something went wrong' >&2; sleep 0.3; exit 3");
    sup.start(shell(&script)).unwrap();
    wait_until("failed", || {
        matches!(sup.state().phase, Phase::Failed { .. })
    })
    .await;

    assert_eq!(
        events.phases(),
        vec!["starting", "loading_weights", "warming", "ready", "failed"]
    );
    let state = sup.state();
    let Phase::Failed {
        reason,
        exit_code,
        last_log_lines,
        ..
    } = &state.phase
    else {
        panic!("{state:?}");
    };
    assert_eq!(*exit_code, Some(3));
    assert_eq!(reason, "Splash exited with code 3");
    assert!(last_log_lines
        .iter()
        .any(|l| l.contains("Ready · incoai/Qwen3.8-27B-Splash")));
    assert_eq!(
        last_log_lines.last().map(String::as_str),
        Some("something went wrong")
    );
    let info = state.ready_info.clone().unwrap();
    assert_eq!(info.context_tokens, Some(262_144));
    assert_eq!(info.url.as_deref(), Some("http://127.0.0.1:8011"));
    assert!(state.ready_at_ms.is_some());
    assert_eq!(state.last_exit.map(|e| e.requested), Some(false));

    // Transition lines carry the phase they moved the engine to.
    let logs = sup.logs();
    let marked: HashMap<&str, &str> = logs
        .iter()
        .filter_map(|l| l.phase.map(|p| (p, l.line.as_str())))
        .collect();
    assert!(marked["loading_weights"].contains("Loading · "));
    assert!(marked["ready"].contains("Ready · "));
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn launcher_error_is_the_reason_and_is_never_restarted() {
    let (sup, events, dir) = supervisor("launcher");
    sup.configure(SupervisorSettings {
        auto_restart: true,
        restart_backoff_ms: 50,
        ..SupervisorSettings::default()
    });
    let log = fixture("serve_port_in_use.log");
    let error_line = log.lines().next().unwrap();
    sup.start(shell(&format!("printf '%s\\n' '{error_line}' >&2; exit 1")))
        .unwrap();
    wait_until("failed", || {
        matches!(sup.state().phase, Phase::Failed { .. })
    })
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let state = sup.state();
    let Phase::Failed {
        reason, exit_code, ..
    } = &state.phase
    else {
        panic!("{state:?}");
    };
    assert!(
        reason.starts_with("Splash is already serving (PID 75278"),
        "{reason}"
    );
    assert_eq!(*exit_code, Some(1));
    assert_eq!(state.restarts, 0);
    assert_eq!(events.phases(), vec!["starting", "failed"]);
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn auto_restart_is_bounded() {
    let (sup, events, dir) = supervisor("restart");
    sup.configure(SupervisorSettings {
        auto_restart: true,
        max_restarts: 2,
        restart_backoff_ms: 50,
        ..SupervisorSettings::default()
    });
    sup.start(shell(
        "printf '%s\\n' '00:00:01 Ready · a/b · context 32K · http://127.0.0.1:1'; sleep 0.2; exit 1",
    ))
    .unwrap();
    wait_until("two restarts then failed", || {
        let s = sup.state();
        s.restarts == 2 && matches!(s.phase, Phase::Failed { .. })
    })
    .await;
    // No third restart.
    tokio::time::sleep(Duration::from_millis(800)).await;
    let state = sup.state();
    assert_eq!(state.restarts, 2);
    assert!(matches!(state.phase, Phase::Failed { .. }));
    let starts = lock_recover(&events.states)
        .iter()
        .filter(|s| s.phase == Phase::Starting)
        .count();
    assert_eq!(starts, 3);
    assert!(sup
        .logs()
        .iter()
        .any(|l| l.line.starts_with("restarting in 0.1 s")));
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn stop_cancels_a_scheduled_restart() {
    let (sup, _events, dir) = supervisor("cancel");
    sup.configure(SupervisorSettings {
        auto_restart: true,
        restart_backoff_ms: 600,
        ..SupervisorSettings::default()
    });
    sup.start(shell(
        "printf '%s\\n' '00:00:01 Ready · a/b · context 32K · http://127.0.0.1:1'; exit 1",
    ))
    .unwrap();
    wait_until("failed", || {
        matches!(sup.state().phase, Phase::Failed { .. })
    })
    .await;
    sup.stop(StopTimeouts::graceful(1)).await;
    tokio::time::sleep(Duration::from_millis(900)).await;
    assert!(matches!(sup.state().phase, Phase::Failed { .. }));
    assert_eq!(sup.state().restarts, 0);
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn readiness_probe_and_status_drive_serving_phases() {
    let (sup, events, dir) = supervisor("probe");
    let mut spec = shell("while true; do sleep 0.1; done");
    spec.probe = true;
    let port = spec.port;
    sup.start(spec).unwrap();
    // Splash binds/listens itself; the stub stands in after the spawn.
    let status = Arc::new(Mutex::new(fixture("status_busy.json")));
    stub_server(port, status.clone()).await;

    wait_until("busy", || sup.state().phase == Phase::Busy).await;
    *lock_recover(&status) = fixture("status_idle.json");
    wait_until("ready", || sup.state().phase == Phase::Ready).await;
    *lock_recover(&status) = fixture("status_idle_released.json");
    wait_until("idle_released", || sup.state().phase == Phase::IdleReleased).await;
    sup.stop(StopTimeouts::graceful(5)).await;
    assert_eq!(
        events.phases(),
        vec![
            "starting",
            "ready",
            "busy",
            "ready",
            "idle_released",
            "stopping",
            "stopped"
        ]
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_a_busy_port() {
    let (sup, _events, dir) = supervisor("busy");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let mut spec = shell("true");
    spec.port = listener.local_addr().unwrap().port();
    assert!(matches!(sup.start(spec), Err(AppError::PortInUse(_))));
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn missing_program_fails_cleanly() {
    let (sup, _events, dir) = supervisor("missing");
    let mut spec = shell("true");
    spec.program = PathBuf::from("/nonexistent/splash");
    assert!(sup.start(spec).is_err());
    assert!(matches!(sup.state().phase, Phase::Failed { .. }));
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn splash_lock_means_external_then_adopt_and_stop() {
    let (sup, events, dir) = supervisor("external");
    let runtime = dir.join("runtime");
    let pid = fake_splash();
    let port = free_port();
    let _lock = hold_lock(&runtime, port, pid);

    let mut spec = shell("echo should-not-run");
    spec.port = port;
    let state = sup.start(spec).unwrap();
    assert_eq!(
        state.phase,
        Phase::External {
            splash: true,
            previous_session: false,
            ready: false
        }
    );
    assert_eq!(state.owner, Owner::External);
    assert_eq!(state.pid, Some(pid));
    assert_eq!(state.model.as_deref(), Some("incoai/Qwen3.8-27B-Splash"));
    assert!(!sup.logs().iter().any(|l| l.line == "should-not-run"));

    let found = sup.discover().await;
    assert_eq!(found.len(), 1);
    assert!(found[0].is_splash && found[0].lock_held);

    let state = sup.adopt(None, None).await.unwrap();
    assert_eq!(state.owner, Owner::Adopted);
    // Adopted: our stop reaches it.
    let state = sup.stop(StopTimeouts::graceful(5)).await;
    assert_eq!(state.phase, Phase::Stopped, "{state:?}");
    assert!(!lockfile::pid_alive(pid));
    assert!(events.phases().contains(&"external"));
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn stop_external_checks_the_process_is_splash() {
    let (sup, _events, dir) = supervisor("stopext");
    let runtime = dir.join("runtime");

    // A lock whose pid is not Splash: refused.
    let mut other = std::process::Command::new("/bin/sleep")
        .arg("30")
        .spawn()
        .unwrap();
    let port = free_port();
    let lock = hold_lock(&runtime, port, other.id());
    assert!(matches!(
        sup.stop_external(Some(port), StopTimeouts::graceful(1))
            .await,
        Err(AppError::NotSplash(_))
    ));
    drop(lock);
    let _ = other.kill();
    let _ = other.wait();

    // A Splash-looking pid: stopped with SIGINT, without adopting it.
    let pid = fake_splash();
    let port = free_port();
    let _lock = hold_lock(&runtime, port, pid);
    let state = sup
        .stop_external(Some(port), StopTimeouts::graceful(5))
        .await
        .unwrap();
    assert_eq!(state.phase, Phase::Stopped);
    wait_until("gone", || !lockfile::pid_alive(pid)).await;
    // Nothing held: not running.
    assert!(matches!(
        sup.stop_external(Some(free_port()), StopTimeouts::graceful(1))
            .await,
        Err(AppError::NotRunning)
    ));
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn reattaches_from_the_pidfile_and_replays_the_log() {
    let (sup, events, dir) = supervisor("reattach");
    let pid = fake_splash();
    let port = free_port();
    let logs = dir.join("state").join("logs");
    std::fs::create_dir_all(&logs).unwrap();
    let out = logs.join("old.stdout.log");
    let err = logs.join("old.stderr.log");
    let serve_log = fixture("serve.log");
    let first: Vec<&str> = serve_log.lines().take(7).collect();
    std::fs::write(&out, first.join("\n") + "\n").unwrap();
    std::fs::write(&err, "").unwrap();
    lockfile::write_pidfile(
        &dir.join("state").join(PIDFILE_NAME),
        &PidFile {
            pid,
            port,
            model: "incoai/Qwen3.8-27B-Splash".into(),
            started_at_ms: 1,
            stdout_log: Some(out),
            stderr_log: Some(err),
            command: None,
        },
    )
    .unwrap();

    let state = sup.init_on_launch(true, None).await;
    assert_eq!(
        state.phase,
        Phase::External {
            splash: true,
            previous_session: true,
            ready: false
        }
    );
    sup.adopt(None, None).await.unwrap();
    wait_until("ready from the replayed log", || {
        sup.state().phase == Phase::Ready
    })
    .await;
    assert!(sup
        .logs()
        .iter()
        .any(|l| l.line.contains("Done · input 62")));
    let state = sup.stop(StopTimeouts::graceful(5)).await;
    assert_eq!(state.phase, Phase::Stopped);
    assert!(!dir.join("state").join(PIDFILE_NAME).exists());
    assert_eq!(
        events.phases(),
        vec![
            "external",
            "starting",
            "loading_weights",
            "warming",
            "ready",
            "stopping",
            "stopped"
        ]
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn init_without_anything_running() {
    let (sup, _events, dir) = supervisor("init");
    assert_eq!(
        sup.init_on_launch(false, None).await.phase,
        Phase::NotInstalled
    );
    sup.note_install(true);
    assert_eq!(sup.state().phase, Phase::Stopped);
    // A stale pidfile (dead pid) is removed.
    let pidfile = dir.join("state").join(PIDFILE_NAME);
    lockfile::write_pidfile(
        &pidfile,
        &PidFile {
            pid: 999_999,
            port: 1,
            model: "a/b".into(),
            started_at_ms: 1,
            stdout_log: None,
            stderr_log: None,
            command: None,
        },
    )
    .unwrap();
    assert_eq!(sup.init_on_launch(true, None).await.phase, Phase::Stopped);
    assert!(!pidfile.exists());
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn download_progress_from_the_hf_cache() {
    let (sup, _events, dir) = supervisor("download");
    let cache = dir.join("hub");
    let blobs = cache.join("models--owner--repo").join("blobs");
    std::fs::create_dir_all(&blobs).unwrap();
    std::fs::write(blobs.join("already-cached"), vec![0u8; 500]).unwrap();
    let mut spec = shell(
        "echo 'Fetching 1 file(s), 0.00 GB, from owner/repo@0123456789ab; cached files are reused.'; while true; do sleep 0.1; done",
    );
    spec.hf_cache = Some(cache);
    sup.start(spec).unwrap();
    wait_until("downloading", || sup.state().phase.name() == "downloading").await;
    // The announced total rounds to 0 GB here, so only bytes are reported.
    std::fs::write(blobs.join("abc.incomplete"), vec![0u8; 1234]).unwrap();
    wait_until("progress", || {
        matches!(
            &sup.state().phase,
            Phase::Downloading { progress: Some(p) } if p.done_bytes == 1234 && p.repo == "owner/repo"
        )
    })
    .await;
    sup.stop(StopTimeouts::graceful(5)).await;
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn status_fixtures_map_to_phases() {
    let parse =
        |name: &str| StatusSignals::from_status(&serde_json::from_str(&fixture(name)).unwrap());
    let idle = parse("status_idle.json");
    assert!(idle.ready && !idle.recovering && !idle.stopped);
    assert_eq!(idle.active, Some(0));
    assert_eq!(idle.released, Some(false));
    let busy = parse("status_busy.json");
    assert!(busy.active.unwrap_or(0) > 0);
    let released = parse("status_idle_released.json");
    assert_eq!(released.released, Some(true));
    assert_eq!(released.active, Some(0));
    let saturated = parse("status_saturated.json");
    assert!(saturated.active.unwrap_or(0) > 0);

    assert_eq!(
        derive_serving_phase(&Phase::Ready, &busy),
        Some(Phase::Busy)
    );
    assert_eq!(
        derive_serving_phase(&Phase::Busy, &idle),
        Some(Phase::Ready)
    );
    assert_eq!(derive_serving_phase(&Phase::Ready, &idle), None);
    assert_eq!(
        derive_serving_phase(&Phase::Ready, &released),
        Some(Phase::IdleReleased)
    );
    // A request while released: restoring, then busy once weights are back.
    let mut waking = released.clone();
    waking.active = Some(1);
    assert_eq!(
        derive_serving_phase(&Phase::IdleReleased, &waking),
        Some(Phase::Restoring)
    );
    assert_eq!(derive_serving_phase(&Phase::Restoring, &waking), None);
    assert_eq!(
        derive_serving_phase(&Phase::Restoring, &busy),
        Some(Phase::Busy)
    );

    let recovering = StatusSignals {
        ready: false,
        recovering: true,
        stopped: false,
        error: Some("engine crashed".into()),
        active: None,
        released: None,
    };
    assert_eq!(
        derive_serving_phase(&Phase::Busy, &recovering),
        Some(Phase::Recovering {
            reason: Some("engine crashed".into())
        })
    );
    assert_eq!(
        derive_serving_phase(
            &Phase::Recovering { reason: None },
            &StatusSignals::from_ready(true)
        ),
        Some(Phase::Ready)
    );
    assert_eq!(
        derive_serving_phase(&Phase::Ready, &StatusSignals::from_ready(false)),
        Some(Phase::Recovering { reason: None })
    );
    let stopped = StatusSignals {
        stopped: true,
        ..recovering
    };
    assert!(matches!(
        derive_serving_phase(&Phase::Recovering { reason: None }, &stopped),
        Some(Phase::Failed { .. })
    ));
}

#[test]
fn restart_backoff_doubles_and_caps() {
    let events: Arc<dyn EngineEvents> = Arc::new(Recorder::default());
    let sup = Supervisor::with_dirs(events, None, None);
    let mut inner = sup.lock();
    inner.settings.auto_restart = true;
    inner.last_spec = Some(shell("true"));
    assert_eq!(plan_restart(&mut inner, false, false), None, "never ready");
    assert_eq!(plan_restart(&mut inner, true, true), None, "launcher error");
    assert_eq!(
        plan_restart(&mut inner, true, false),
        Some(Duration::from_millis(1000))
    );
    inner.restart_history.push_back(Instant::now());
    assert_eq!(
        plan_restart(&mut inner, true, false),
        Some(Duration::from_millis(2000))
    );
    inner.restart_history.push_back(Instant::now());
    inner.restart_history.push_back(Instant::now());
    assert_eq!(plan_restart(&mut inner, true, false), None, "limit reached");
}

/// Starts the real Splash through the supervisor and stops it again:
/// `cargo test -- --ignored live_start_stop --nocapture`
/// Needs the Homebrew Splash and the cached incoai/Qwen3.8-27B-Splash model
/// (`--offline`, nothing is downloaded). Uses the GPU for about a minute.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "starts the real Splash engine (GPU, ~20 GB of memory)"]
async fn live_start_stop() {
    const PORT: u16 = 8012;
    const MODEL: &str = "incoai/Qwen3.8-27B-Splash";

    let program = super::super::detect::find_splash(None).expect("splash is installed");
    let version = super::super::detect::installed_version(&program).await;
    let request: super::super::params::ServeRequest = serde_json::from_value(serde_json::json!({
        "model": MODEL,
        "port": PORT,
        "flags": [{"key": "offline", "value": true}]
    }))
    .unwrap();
    let rendered = super::super::params::render(&request, version.as_deref()).unwrap();
    println!("version {version:?}\ncommand: {}", rendered.command);

    let events = Arc::new(Recorder::default());
    let dir = temp_dir("live");
    let sup = Supervisor::with_dirs(
        events.clone(),
        Some(dir.join("state")),
        lockfile::splash_runtime_dir(),
    );
    assert!(
        matches!(
            lockfile::port_status(lockfile::splash_runtime_dir().as_deref(), PORT),
            PortStatus::Free
        ),
        "port {PORT} must be free before the test"
    );
    let mut env = rendered.env_pairs();
    env.push(("PYTHONUNBUFFERED".into(), "1".into()));
    let t0 = Instant::now();
    let state = sup
        .start(SpawnSpec {
            program,
            args: rendered.args.clone(),
            env,
            model: MODEL.into(),
            port: PORT,
            probe: true,
            api_key: None,
            hf_cache: None,
            command: Some(rendered.clone()),
        })
        .expect("start");
    let pid = state.pid.expect("pid");

    /// Stops the engine even if an assertion below fails.
    struct Guard(u32);
    impl Drop for Guard {
        fn drop(&mut self) {
            let _ = killpg(Pid::from_raw(self.0 as i32), Signal::SIGINT);
        }
    }
    let guard = Guard(pid);

    let mut timeline: Vec<(f64, &'static str)> = vec![(0.0, "starting")];
    let deadline = Instant::now() + Duration::from_secs(180);
    loop {
        let phase = sup.state().phase;
        if timeline.last().map(|(_, p)| *p) != Some(phase.name()) {
            timeline.push((t0.elapsed().as_secs_f64(), phase.name()));
        }
        if phase == Phase::Ready {
            break;
        }
        assert!(
            !matches!(phase, Phase::Failed { .. } | Phase::Stopped),
            "engine failed: {phase:?}\n{:#?}",
            sup.logs().iter().map(|l| &l.line).collect::<Vec<_>>()
        );
        assert!(Instant::now() < deadline, "not ready within 180 s");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let ready = sup.state();
    assert_eq!(sup.probe_ready(PORT).await, Some(true));
    let stop_t = Instant::now();
    let state = sup.stop(StopTimeouts::graceful(20)).await;
    timeline.push((t0.elapsed().as_secs_f64(), state.phase.name()));
    std::mem::forget(guard);

    println!("phase timeline (s since spawn):");
    for (t, phase) in &timeline {
        println!("  {t:7.2}  {phase}");
    }
    println!(
        "stop took {:.2} s; exit {:?}",
        stop_t.elapsed().as_secs_f64(),
        state.last_exit
    );
    println!("ready info: {:?}", ready.ready_info);
    println!("events: {:?}", events.phases());
    for line in sup.logs() {
        println!("  [{:?}] {}", line.stream, line.line);
    }

    assert_eq!(state.phase, Phase::Stopped);
    assert_eq!(state.last_exit.map(|e| e.requested), Some(true));
    let phases = events.phases();
    for expected in [
        "starting",
        "loading_weights",
        "warming",
        "ready",
        "stopping",
        "stopped",
    ] {
        assert!(
            phases.contains(&expected),
            "missing {expected} in {phases:?}"
        );
    }
    // Port free, lock released, no Splash process left for this port.
    assert!(!lockfile::port_occupied(PORT), "port {PORT} still in use");
    let lock = lockfile::serve_lock_path(&lockfile::splash_runtime_dir().unwrap(), PORT);
    assert!(
        !lockfile::lock_is_held(&lock),
        "serve-{PORT}.lock still held"
    );
    assert!(!lockfile::pid_alive(pid), "server pid {pid} still alive");
    let leftover = std::process::Command::new("/usr/bin/pgrep")
        .args(["-f", &format!("server.server.*--port {PORT}")])
        .output()
        .unwrap();
    assert!(
        String::from_utf8_lossy(&leftover.stdout).trim().is_empty(),
        "splash processes left: {}",
        String::from_utf8_lossy(&leftover.stdout)
    );
    let _ = std::fs::remove_dir_all(dir);
}
