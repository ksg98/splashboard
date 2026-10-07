//! Who owns a port: Splash's own port lock, our pidfile, and process checks.
//!
//! Splash's launcher (`install/launcher.py`) holds an exclusive `flock` on
//! `~/Library/Application Support/Splash/runtime/serve-<port>.lock` for the
//! whole life of the server and writes `{"pid", "model", "port"}` into it.
//! The file is never deleted, so its content proves nothing: a server owns
//! the port only while the lock is *held*, which we test with a non-blocking
//! shared lock that is released at once (the file is opened read-only and
//! never created).
//!
//! Our own pidfile (app data dir) records the server this app spawned, so a
//! crashed or quit app can re-attach to it (or clean it up) next launch.

use std::fs::File;
use std::io::Write;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use nix::errno::Errno;
use nix::fcntl::{Flock, FlockArg};
use nix::sys::signal::kill;
use nix::unistd::Pid;
use serde::{Deserialize, Serialize};

/// `~/Library/Application Support/Splash/runtime` (Homebrew/release layout).
pub fn splash_runtime_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("Splash/runtime"))
}

pub fn serve_lock_path(runtime_dir: &Path, port: u16) -> PathBuf {
    runtime_dir.join(format!("serve-{port}.lock"))
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct LockOwner {
    pub pid: u32,
    pub model: String,
    pub port: u16,
}

/// The owner Splash wrote into a lock file (may be stale; see [`lock_is_held`]).
pub fn read_lock_owner(path: &Path) -> Option<LockOwner> {
    let text = std::fs::read_to_string(path).ok()?;
    let owner: LockOwner = serde_json::from_str(text.trim()).ok()?;
    (owner.pid > 0 && owner.port > 0).then_some(owner)
}

/// True while a process holds the lock (a live `splash serve` for that port).
pub fn lock_is_held(path: &Path) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    match Flock::lock(file, FlockArg::LockSharedNonblock) {
        // We got it, so nobody holds it exclusively; dropping releases it.
        Ok(_lock) => false,
        Err((_, Errno::EWOULDBLOCK)) => true,
        Err(_) => false,
    }
}

/// Every `serve-<port>.lock` in `runtime_dir` whose lock is held.
pub fn held_locks(runtime_dir: &Path) -> Vec<(u16, Option<LockOwner>)> {
    let Ok(entries) = std::fs::read_dir(runtime_dir) else {
        return Vec::new();
    };
    let mut out: Vec<(u16, Option<LockOwner>)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let port = name
                .strip_prefix("serve-")?
                .strip_suffix(".lock")?
                .parse::<u16>()
                .ok()?;
            let path = entry.path();
            lock_is_held(&path).then(|| (port, read_lock_owner(&path)))
        })
        .collect();
    out.sort_by_key(|(port, _)| *port);
    out
}

/// The process exists (EPERM counts: it exists but is not ours to signal).
pub fn pid_alive(pid: u32) -> bool {
    let Ok(raw) = i32::try_from(pid) else {
        return false;
    };
    if raw <= 0 {
        return false;
    }
    match kill(Pid::from_raw(raw), None) {
        Ok(()) => true,
        Err(Errno::EPERM) => true,
        Err(_) => false,
    }
}

/// The full command line of `pid` (via `ps`), or `None` if it is gone.
pub fn process_command(pid: u32) -> Option<String> {
    let output = std::process::Command::new("/bin/ps")
        .args(["-o", "command=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// A Splash server (`python3 -m server.server ...`, what the launcher execs
/// into) or the launcher itself (`install/launcher.py serve ...`).
pub fn is_splash_command(command: &str) -> bool {
    command.contains(" -m server.server ")
        || command.contains("install/launcher.py")
        || command.contains("/libexec/engine/splash serve-native")
}

pub fn is_splash_process(pid: u32) -> bool {
    process_command(pid).is_some_and(|c| is_splash_command(&c))
}

/// How a port is occupied, as far as starting a server is concerned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PortStatus {
    Free,
    /// Splash's port lock is held: a Splash server (loading or serving).
    Splash(Option<LockOwner>),
    /// Something else is bound or listening there.
    Busy,
}

/// Bound or listening on loopback. A loading Splash is bound but not yet
/// listening (connects hang), so a bind attempt is the reliable test.
pub fn port_occupied(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    match TcpListener::bind(addr) {
        Ok(listener) => {
            drop(listener);
            // A listener on a wider address (0.0.0.0, ::) does not block the
            // bind; one that accepts the connection still owns the port.
            TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
        }
        Err(_) => true,
    }
}

pub fn port_status(runtime_dir: Option<&Path>, port: u16) -> PortStatus {
    if let Some(dir) = runtime_dir {
        let lock = serve_lock_path(dir, port);
        if lock_is_held(&lock) {
            return PortStatus::Splash(read_lock_owner(&lock));
        }
    }
    if port_occupied(port) {
        PortStatus::Busy
    } else {
        PortStatus::Free
    }
}

/// What we record about a server we spawned.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PidFile {
    pub pid: u32,
    pub port: u16,
    pub model: String,
    pub started_at_ms: u64,
    /// Where the child's stdout/stderr go, so a new app run can follow them.
    pub stdout_log: Option<PathBuf>,
    pub stderr_log: Option<PathBuf>,
    /// The display command (no secrets).
    pub command: Option<String>,
}

pub fn write_pidfile(path: &Path, record: &PidFile) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("pid.tmp");
    {
        let mut file = File::create(&tmp)?;
        let json = serde_json::to_vec_pretty(record).map_err(std::io::Error::other)?;
        file.write_all(&json)?;
        file.sync_all()?;
    }
    std::fs::rename(tmp, path)
}

pub fn read_pidfile(path: &Path) -> Option<PidFile> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn remove_pidfile(path: &Path) {
    let _ = std::fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "splashboard-lockfile-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn stale_lock_is_not_held_and_live_lock_is() {
        let dir = temp_dir("held");
        let path = serve_lock_path(&dir, 8123);
        std::fs::write(
            &path,
            r#"{"pid": 85053, "model": "incoai/Qwen3.8-27B-Splash", "port": 8123}"#,
        )
        .unwrap();
        // Content alone (as Splash leaves it after exit) is not ownership.
        assert!(!lock_is_held(&path));
        assert_eq!(
            read_lock_owner(&path),
            Some(LockOwner {
                pid: 85053,
                model: "incoai/Qwen3.8-27B-Splash".into(),
                port: 8123
            })
        );
        assert!(held_locks(&dir).is_empty());

        // Hold it like the launcher does (exclusive flock on another fd).
        let holder = Flock::lock(
            std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap(),
            FlockArg::LockExclusiveNonblock,
        )
        .unwrap();
        assert!(lock_is_held(&path));
        let held = held_locks(&dir);
        assert_eq!(held.len(), 1);
        assert_eq!(held[0].0, 8123);
        assert_eq!(held[0].1.as_ref().map(|o| o.pid), Some(85053));
        assert!(matches!(
            port_status(Some(&dir), 8123),
            PortStatus::Splash(Some(_))
        ));
        drop(holder);
        assert!(!lock_is_held(&path));
        // Testing never creates a lock file.
        assert!(!lock_is_held(&serve_lock_path(&dir, 9)));
        assert!(!serve_lock_path(&dir, 9).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ports() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(port_occupied(port));
        assert_eq!(port_status(None, port), PortStatus::Busy);
        drop(listener);
        assert!(!port_occupied(port));
        assert_eq!(port_status(None, port), PortStatus::Free);
    }

    #[test]
    fn processes() {
        assert!(pid_alive(std::process::id()));
        assert!(!pid_alive(0));
        assert!(process_command(std::process::id()).is_some());
        assert!(!is_splash_process(std::process::id()));
        assert!(is_splash_command(
            "/opt/homebrew/opt/splash/libexec/python/bin/python3 -u -P -m server.server /x --tokenizer /x/tokenizer --model a/b --port 8012"
        ));
        assert!(is_splash_command(
            "/opt/homebrew/opt/splash/libexec/python/bin/python3 -u /opt/homebrew/opt/splash/libexec/install/launcher.py serve --model=a/b"
        ));
        assert!(!is_splash_command("/usr/bin/python3 -m http.server 8012"));
    }

    #[test]
    fn pidfile_roundtrip() {
        let dir = temp_dir("pid");
        let path = dir.join("engine.pid");
        let record = PidFile {
            pid: 42,
            port: 8012,
            model: "a/b".into(),
            started_at_ms: 1,
            stdout_log: Some(dir.join("out.log")),
            stderr_log: None,
            command: Some("splash serve --model=a/b --port=8012".into()),
        };
        write_pidfile(&path, &record).unwrap();
        assert_eq!(read_pidfile(&path), Some(record));
        remove_pidfile(&path);
        assert_eq!(read_pidfile(&path), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
