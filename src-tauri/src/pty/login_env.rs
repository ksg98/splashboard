//! The user's login-shell environment for PTY sessions.
//!
//! An app opened from Finder inherits launchd's minimal PATH
//! (`/usr/bin:/bin:/usr/sbin:/sbin`), so agents installed under Homebrew,
//! `~/.local/bin`, npm or bun would not be found. The login PATH is resolved
//! once with `/bin/zsh -lc 'printf %s "$PATH"'` and cached for the process.
//!
//! `-l` sources `.zshenv`, `.zprofile` and `.zlogin` but not `.zshrc`, where
//! installers often add their folder, so the well-known install folders are
//! appended as well.

use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant};

/// Surrounds the printed PATH so banners printed by profile scripts are ignored.
const MARK: &str = "__SPLASHBOARD_PATH__";
const LOGIN_SHELL: &str = "/bin/zsh";
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

static LOGIN_PATH: OnceLock<OsString> = OnceLock::new();

/// The cached login PATH, merged with the well-known install folders and the
/// app's own PATH. The first call runs the login shell (up to 5 s), so call it
/// off the main thread.
pub fn login_path() -> &'static OsString {
    LOGIN_PATH.get_or_init(|| {
        let probed = probe_login_path(Path::new(LOGIN_SHELL), PROBE_TIMEOUT);
        if probed.is_none() {
            log::warn!("could not read the login shell PATH; using the app PATH");
        }
        merge_paths(
            probed.as_deref().map(OsStr::new),
            &extra_dirs(dirs::home_dir().as_deref()),
            &crate::splash::supervisor::augmented_path(),
        )
    })
}

/// Runs `<shell> -lc` and returns the PATH it prints, or `None` when the shell
/// fails, prints nothing usable or runs past `timeout`.
pub fn probe_login_path(shell: &Path, timeout: Duration) -> Option<String> {
    let script = format!("printf '{MARK}%s{MARK}' \"$PATH\"");
    let mut child = Command::new(shell)
        .args(["-lc", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    // Read on a thread: a daemon started by a profile could hold stdout open
    // after the shell exits, so the read must not be waited on unbounded.
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        let _ = tx.send(out);
    });

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(15));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let remaining = deadline.saturating_duration_since(Instant::now());
    let out = rx
        .recv_timeout(remaining.max(Duration::from_millis(200)))
        .ok()?;
    extract_marked(&out)
}

/// The text between the first two markers, if non-empty.
pub fn extract_marked(out: &str) -> Option<String> {
    let start = out.find(MARK)? + MARK.len();
    let len = out[start..].find(MARK)?;
    let path = out[start..start + len].trim();
    (!path.is_empty()).then(|| path.to_string())
}

/// Folders agent installers commonly add from `.zshrc` (or not at all).
pub fn extra_dirs(home: Option<&Path>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(home) = home {
        for rel in [
            ".local/bin",
            ".claude/local",
            ".opencode/bin",
            ".bun/bin",
            ".npm-global/bin",
            ".cargo/bin",
            ".volta/bin",
        ] {
            out.push(home.join(rel));
        }
    }
    for abs in ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"] {
        out.push(PathBuf::from(abs));
    }
    out
}

/// `login` entries first (the user's order), then `extra`, then `fallback`.
/// Empty and duplicate entries are dropped.
pub fn merge_paths(login: Option<&OsStr>, extra: &[PathBuf], fallback: &OsStr) -> OsString {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut push = |p: PathBuf| {
        if !p.as_os_str().is_empty() && !out.contains(&p) {
            out.push(p);
        }
    };
    if let Some(login) = login {
        std::env::split_paths(login).for_each(&mut push);
    }
    extra.iter().cloned().for_each(&mut push);
    std::env::split_paths(fallback).for_each(&mut push);
    std::env::join_paths(out).unwrap_or_else(|_| fallback.to_os_string())
}

/// Variables every PTY session gets unless the caller sets them: a capable
/// TERM, and a UTF-8 locale (Finder-launched apps have no LANG, and agents and
/// the splash launcher print non-ASCII text).
pub fn terminal_defaults(
    current: impl Fn(&str) -> Option<OsString>,
) -> Vec<(&'static str, &'static str)> {
    let mut out = vec![("TERM", "xterm-256color"), ("COLORTERM", "truecolor")];
    let has_locale = ["LC_ALL", "LC_CTYPE", "LANG"]
        .iter()
        .any(|k| current(k).is_some_and(|v| !v.is_empty()));
    if !has_locale {
        out.push(("LANG", "en_US.UTF-8"));
    }
    out
}

/// Finds `name` on the login PATH.
pub fn which(name: &str) -> Option<PathBuf> {
    let cwd = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    which::which_in(name, Some(login_path()), cwd).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_path_between_markers_ignoring_banners() {
        let out = format!("Welcome!\n{MARK}/a/bin:/b/bin{MARK}trailing");
        assert_eq!(extract_marked(&out).as_deref(), Some("/a/bin:/b/bin"));
        assert_eq!(extract_marked("no markers"), None);
        assert_eq!(extract_marked(&format!("{MARK}{MARK}")), None);
        assert_eq!(extract_marked(&format!("{MARK}/x")), None);
    }

    #[test]
    fn merge_keeps_login_order_and_dedupes() {
        let merged = merge_paths(
            Some(OsStr::new("/u/bin:/opt/homebrew/bin::/u/bin")),
            &[PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/e/bin")],
            OsStr::new("/usr/bin:/e/bin"),
        );
        assert_eq!(
            merged,
            OsString::from("/u/bin:/opt/homebrew/bin:/e/bin:/usr/bin")
        );
        let no_login = merge_paths(None, &[], OsStr::new("/usr/bin:/bin"));
        assert_eq!(no_login, OsString::from("/usr/bin:/bin"));
    }

    #[test]
    fn extra_dirs_include_home_installs_and_homebrew() {
        let dirs = extra_dirs(Some(Path::new("/Users/x")));
        assert!(dirs.contains(&PathBuf::from("/Users/x/.local/bin")));
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert_eq!(extra_dirs(None).len(), 3);
    }

    #[test]
    fn terminal_defaults_add_lang_only_when_no_locale() {
        let none = terminal_defaults(|_| None);
        assert!(none.contains(&("LANG", "en_US.UTF-8")));
        assert!(none.contains(&("TERM", "xterm-256color")));
        let with_lang = terminal_defaults(|k| (k == "LANG").then(|| OsString::from("fr_FR.UTF-8")));
        assert!(!with_lang.iter().any(|(k, _)| *k == "LANG"));
    }

    #[test]
    fn probes_a_shell_for_its_path() {
        // /bin/sh -lc works the same way as zsh for this purpose.
        let path = probe_login_path(Path::new("/bin/sh"), Duration::from_secs(5));
        let path = path.expect("sh printed a PATH");
        assert!(path.contains("/bin"), "{path}");
    }

    #[test]
    fn probe_fails_cleanly_for_a_missing_shell() {
        assert_eq!(
            probe_login_path(Path::new("/nonexistent/shell"), Duration::from_secs(1)),
            None
        );
    }

    #[test]
    fn login_path_contains_system_dirs() {
        let path = login_path().to_string_lossy().to_string();
        assert!(path.split(':').any(|p| p == "/usr/bin"), "{path}");
        assert!(path.split(':').any(|p| p == "/opt/homebrew/bin"), "{path}");
    }
}
