//! Homebrew and Splash detection, the latest-version check, and the Splash
//! servers currently running (from Splash's own lock files).
//!
//! Everything here is read-only. The installed version comes from
//! `<libexec>/release.json` (what `splash --version` prints), which is fast
//! and does not run Splash.

use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::runner::{self, RunSpec};

/// The Homebrew formula Splash ships as.
pub const FORMULA: &str = "incoai/tap/splash";
/// The official Homebrew installer. It prompts for a password, so it runs in
/// the embedded terminal (docs/terminal-parity.md section 10).
pub const HOMEBREW_INSTALL_COMMAND: &str = r#"/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)""#;
pub const HOMEBREW_URL: &str = "https://brew.sh";
pub const GITHUB_LATEST_URL: &str = "https://api.github.com/repos/incoai/splash/releases/latest";
pub const USER_AGENT: &str = concat!("Splashboard/", env!("CARGO_PKG_VERSION"));

const BREW_LOCATIONS: &[&str] = &["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
const BREW_INFO_TIMEOUT: Duration = Duration::from_secs(90);
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

/// Where a Splash installation came from.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SplashSource {
    Homebrew,
    /// The tester install under ~/Library/Application Support/Splash/app/current.
    Tester,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HomebrewStatus {
    pub found: bool,
    pub path: Option<String>,
    /// `brew --prefix` (derived from the executable's location).
    pub prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SplashLocation {
    pub source: SplashSource,
    pub libexec: String,
    /// From release.json; None when the file is missing or unreadable.
    pub version: Option<String>,
    /// The bundled interpreter that runs install/*.py. Always invoke scripts
    /// through it: the bundled `hf` script's shebang is broken in 1.2.0.
    pub python: String,
    pub python_ok: bool,
    /// `<libexec>/engine/splash`, for `device-check`.
    pub engine: String,
}

/// A `splash serve` that is running now, from runtime/serve-<port>.lock.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunningServer {
    pub pid: u32,
    pub model: String,
    pub port: u16,
    pub lock_file: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallStatus {
    pub homebrew: HomebrewStatus,
    pub splash: Option<SplashLocation>,
    pub installed: bool,
    pub version: Option<String>,
    /// ~/Library/Application Support/Splash
    pub data_dir: Option<String>,
    pub models_dir: Option<String>,
    pub running_servers: Vec<RunningServer>,
}

pub fn find_brew() -> Option<PathBuf> {
    BREW_LOCATIONS
        .iter()
        .map(PathBuf::from)
        .chain(which::which("brew").ok())
        .find(|candidate| is_executable(candidate))
}

fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// /opt/homebrew/bin/brew -> /opt/homebrew
pub fn brew_prefix(brew: &Path) -> Option<PathBuf> {
    brew.parent()?.parent().map(Path::to_path_buf)
}

/// ~/Library/Application Support/Splash
pub fn splash_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("Splash"))
}

pub fn splash_models_dir() -> Option<PathBuf> {
    splash_data_dir().map(|d| d.join("models"))
}

/// The libexec folders to look for, most likely first.
pub fn libexec_candidates(
    prefix: Option<&Path>,
    data_dir: Option<&Path>,
) -> Vec<(SplashSource, PathBuf)> {
    let mut out: Vec<(SplashSource, PathBuf)> = Vec::new();
    let mut push = |source, path: PathBuf| {
        if !out.iter().any(|(_, p)| p == &path) {
            out.push((source, path));
        }
    };
    if let Some(prefix) = prefix {
        push(SplashSource::Homebrew, prefix.join("opt/splash/libexec"));
    }
    push(
        SplashSource::Homebrew,
        PathBuf::from("/opt/homebrew/opt/splash/libexec"),
    );
    push(
        SplashSource::Homebrew,
        PathBuf::from("/usr/local/opt/splash/libexec"),
    );
    if let Some(data) = data_dir {
        push(SplashSource::Tester, data.join("app/current"));
    }
    out
}

#[derive(Deserialize)]
struct ReleaseJson {
    version: Option<String>,
}

pub fn release_version(libexec: &Path) -> Option<String> {
    let text = std::fs::read_to_string(libexec.join("release.json")).ok()?;
    serde_json::from_str::<ReleaseJson>(&text).ok()?.version
}

pub fn locate(source: SplashSource, libexec: &Path) -> Option<SplashLocation> {
    if !libexec.join("release.json").is_file() && !libexec.join("install/models.py").is_file() {
        return None;
    }
    let python = libexec.join("python/bin/python3");
    Some(SplashLocation {
        source,
        libexec: libexec.display().to_string(),
        version: release_version(libexec),
        python_ok: is_executable(&python),
        python: python.display().to_string(),
        engine: libexec.join("engine/splash").display().to_string(),
    })
}

pub fn find_splash(prefix: Option<&Path>) -> Option<SplashLocation> {
    let data = splash_data_dir();
    libexec_candidates(prefix, data.as_deref())
        .into_iter()
        .find_map(|(source, path)| locate(source, &path))
}

/// The Splash installation model downloads and verification run through.
pub fn require_splash() -> super::OpResult<SplashLocation> {
    let prefix = find_brew().as_deref().and_then(brew_prefix);
    let splash = find_splash(prefix.as_deref()).ok_or(super::OpError::SplashNotInstalled)?;
    if !splash.python_ok {
        return Err(super::OpError::Failed(format!(
            "Splash's bundled Python is missing ({}); reinstall Splash",
            splash.python
        )));
    }
    Ok(splash)
}

#[derive(Deserialize)]
struct ServeLock {
    pid: i64,
    model: String,
    port: u16,
}

pub fn pid_alive(pid: u32) -> bool {
    use nix::errno::Errno;
    use nix::sys::signal::kill;
    use nix::unistd::Pid;
    let Ok(raw) = i32::try_from(pid) else {
        return false;
    };
    if raw <= 0 {
        return false;
    }
    matches!(kill(Pid::from_raw(raw), None), Ok(()) | Err(Errno::EPERM))
}

/// Servers whose lock file names a live process. Read-only: Splash's locks
/// are never taken here (a starting server would then refuse to start).
pub fn running_servers(runtime_dir: &Path, alive: impl Fn(u32) -> bool) -> Vec<RunningServer> {
    let Ok(entries) = std::fs::read_dir(runtime_dir) else {
        return Vec::new();
    };
    let mut out: Vec<RunningServer> = Vec::new();
    let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    paths.sort();
    for path in paths {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if !(name.starts_with("serve") && name.ends_with(".lock")) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(lock) = serde_json::from_str::<ServeLock>(&text) else {
            continue;
        };
        let Ok(pid) = u32::try_from(lock.pid) else {
            continue;
        };
        if out.iter().any(|s| s.pid == pid) || !alive(pid) {
            continue;
        }
        out.push(RunningServer {
            pid,
            model: lock.model,
            port: lock.port,
            lock_file: path.display().to_string(),
        });
    }
    out
}

pub fn status() -> InstallStatus {
    let brew = find_brew();
    let prefix = brew.as_deref().and_then(brew_prefix);
    let splash = find_splash(prefix.as_deref());
    let data_dir = splash_data_dir();
    let running = data_dir
        .as_deref()
        .map(|d| running_servers(&d.join("runtime"), pid_alive))
        .unwrap_or_default();
    InstallStatus {
        homebrew: HomebrewStatus {
            found: brew.is_some(),
            path: brew.as_ref().map(|p| p.display().to_string()),
            prefix: prefix.as_ref().map(|p| p.display().to_string()),
        },
        installed: splash.is_some(),
        version: splash.as_ref().and_then(|s| s.version.clone()),
        splash,
        models_dir: data_dir
            .as_ref()
            .map(|d| d.join("models").display().to_string()),
        data_dir: data_dir.as_ref().map(|d| d.display().to_string()),
        running_servers: running,
    }
}

// --- versions -----------------------------------------------------------------

/// Compares dotted versions numerically ("1.10.0" > "1.9.2"); a leading "v"
/// is ignored and missing parts count as 0. Non-numeric parts compare as text.
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let parts = |v: &str| -> Vec<String> {
        v.trim()
            .trim_start_matches(['v', 'V'])
            .split(['.', '-', '_'])
            .map(str::to_string)
            .collect()
    };
    let (a, b) = (parts(a), parts(b));
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).map(String::as_str).unwrap_or("0");
        let y = b.get(i).map(String::as_str).unwrap_or("0");
        let ordering = match (x.parse::<u64>(), y.parse::<u64>()) {
            (Ok(x), Ok(y)) => x.cmp(&y),
            _ => x.cmp(y),
        };
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    Ordering::Equal
}

pub fn is_newer(candidate: Option<&str>, than: Option<&str>) -> bool {
    match (candidate, than) {
        (Some(c), Some(t)) => compare_versions(c, t) == Ordering::Greater,
        _ => false,
    }
}

// --- brew info ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TapInfo {
    pub formula: String,
    /// The version `brew upgrade` would install.
    pub stable: Option<String>,
    /// Versions Homebrew has installed (normally one).
    pub installed: Vec<String>,
    pub outdated: bool,
    pub pinned: bool,
    pub tap: Option<String>,
}

#[derive(Deserialize)]
struct BrewInfoV2 {
    #[serde(default)]
    formulae: Vec<BrewFormula>,
}

#[derive(Deserialize)]
struct BrewFormula {
    #[serde(default)]
    full_name: String,
    #[serde(default)]
    tap: Option<String>,
    #[serde(default)]
    versions: BrewVersions,
    #[serde(default)]
    installed: Vec<BrewInstalled>,
    #[serde(default)]
    outdated: bool,
    #[serde(default)]
    pinned: bool,
}

#[derive(Deserialize, Default)]
struct BrewVersions {
    stable: Option<String>,
}

#[derive(Deserialize)]
struct BrewInstalled {
    version: String,
}

pub fn parse_brew_info(json: &str) -> Result<TapInfo, String> {
    let info: BrewInfoV2 =
        serde_json::from_str(json).map_err(|e| format!("unexpected brew info output: {e}"))?;
    let formula = info
        .formulae
        .into_iter()
        .next()
        .ok_or_else(|| format!("brew info returned no formula for {FORMULA}"))?;
    Ok(TapInfo {
        formula: formula.full_name,
        stable: formula.versions.stable,
        installed: formula.installed.into_iter().map(|i| i.version).collect(),
        outdated: formula.outdated,
        pinned: formula.pinned,
        tap: formula.tap,
    })
}

pub async fn brew_info(brew: &Path) -> Result<TapInfo, String> {
    let mut spec = RunSpec::new(brew, &["info", "--json=v2", FORMULA]);
    spec.env = brew_env(false);
    let (outcome, stdout, stderr) = runner::capture(&spec, BREW_INFO_TIMEOUT)
        .await
        .map_err(|e| format!("could not run brew: {e}"))?;
    if outcome.cancelled {
        return Err("brew info timed out".into());
    }
    if !outcome.success() {
        let reason = stderr
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("unknown error");
        return Err(format!("brew info failed: {}", reason.trim()));
    }
    parse_brew_info(&stdout)
}

/// Environment for every brew child: non-interactive, plain output.
/// `auto_update` lets `brew install` refresh its taps first, as it does in a
/// terminal; read-only queries skip that (it is slow).
pub fn brew_env(auto_update: bool) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = [
        ("NONINTERACTIVE", "1"),
        ("HOMEBREW_NO_ENV_HINTS", "1"),
        ("HOMEBREW_NO_COLOR", "1"),
        ("HOMEBREW_NO_EMOJI", "1"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    if !auto_update {
        env.push(("HOMEBREW_NO_AUTO_UPDATE".into(), "1".into()));
    }
    env
}

// --- GitHub releases ------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GithubRelease {
    /// Tags are x.y.z without a "v".
    pub version: String,
    pub name: Option<String>,
    pub url: Option<String>,
    pub published_at: Option<String>,
    /// Release notes (markdown), cut to 20 000 characters.
    pub notes: Option<String>,
}

#[derive(Deserialize)]
struct GithubReleaseJson {
    tag_name: String,
    name: Option<String>,
    html_url: Option<String>,
    published_at: Option<String>,
    body: Option<String>,
}

pub fn parse_github_release(json: &str) -> Result<GithubRelease, String> {
    let release: GithubReleaseJson =
        serde_json::from_str(json).map_err(|e| format!("unexpected GitHub response: {e}"))?;
    Ok(GithubRelease {
        version: release.tag_name.trim_start_matches(['v', 'V']).to_string(),
        name: release.name,
        url: release.html_url,
        published_at: release.published_at,
        notes: release.body.map(|b| b.chars().take(20_000).collect()),
    })
}

pub fn http_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(HTTP_TIMEOUT)
        .connect_timeout(Duration::from_secs(8))
        .build()
}

pub async fn github_latest(client: &reqwest::Client) -> Result<GithubRelease, String> {
    let response = client
        .get(GITHUB_LATEST_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("could not reach GitHub: {e}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("could not read GitHub's answer: {e}"))?;
    if !status.is_success() {
        return Err(format!("GitHub answered {status}"));
    }
    parse_github_release(&text)
}

// --- latest check -----------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LatestCheck {
    pub installed: Option<String>,
    pub tap: Option<TapInfo>,
    pub tap_error: Option<String>,
    pub github: Option<GithubRelease>,
    pub github_error: Option<String>,
    /// The newest version either source knows.
    pub latest: Option<String>,
    /// `brew upgrade` would install a newer version than the installed one.
    pub upgrade_available: bool,
    /// GitHub has a newer release than the tap offers yet (the tap can lag);
    /// upgrading now would not get it.
    pub release_not_in_tap: bool,
    pub checked_at_ms: u64,
}

pub fn summarize(
    installed: Option<String>,
    tap: Result<TapInfo, String>,
    github: Result<GithubRelease, String>,
    now_ms: u64,
) -> LatestCheck {
    let (tap, tap_error) = match tap {
        Ok(t) => (Some(t), None),
        Err(e) => (None, Some(e)),
    };
    let (github, github_error) = match github {
        Ok(g) => (Some(g), None),
        Err(e) => (None, Some(e)),
    };
    // Homebrew's own record of what it installed beats release.json when
    // both exist (they should agree).
    let installed = installed.or_else(|| tap.as_ref().and_then(|t| t.installed.last().cloned()));
    let tap_stable = tap.as_ref().and_then(|t| t.stable.clone());
    let github_version = github.as_ref().map(|g| g.version.clone());
    let latest = match (&tap_stable, &github_version) {
        (Some(a), Some(b)) => Some(if compare_versions(a, b) == Ordering::Less {
            b.clone()
        } else {
            a.clone()
        }),
        (a, b) => a.clone().or_else(|| b.clone()),
    };
    LatestCheck {
        upgrade_available: is_newer(tap_stable.as_deref(), installed.as_deref()),
        release_not_in_tap: tap_stable.is_some()
            && is_newer(github_version.as_deref(), tap_stable.as_deref()),
        installed,
        tap,
        tap_error,
        github,
        github_error,
        latest,
        checked_at_ms: now_ms,
    }
}

pub async fn check_latest() -> LatestCheck {
    let brew = find_brew();
    let prefix = brew.as_deref().and_then(brew_prefix);
    let installed = find_splash(prefix.as_deref()).and_then(|s| s.version);
    let tap = async {
        match &brew {
            Some(brew) => brew_info(brew).await,
            None => Err("Homebrew is not installed".to_string()),
        }
    };
    let github = async {
        match http_client() {
            Ok(client) => github_latest(&client).await,
            Err(e) => Err(format!("could not create the HTTP client: {e}")),
        }
    };
    let (tap, github) = tokio::join!(tap, github);
    summarize(installed, tap, github, super::now_ms())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::testutil::TempDir;

    const BREW_INFO: &str = include_str!("testdata/brew-info-splash.json");
    const GITHUB: &str = include_str!("testdata/github-release-latest.json");

    #[test]
    fn parses_recorded_brew_info() {
        let info = parse_brew_info(BREW_INFO).expect("parse");
        assert_eq!(info.formula, "incoai/tap/splash");
        assert_eq!(info.stable.as_deref(), Some("1.2.0"));
        assert_eq!(info.installed, vec!["1.2.0".to_string()]);
        assert!(!info.outdated);
        assert_eq!(info.tap.as_deref(), Some("incoai/tap"));
        assert!(parse_brew_info("{\"formulae\":[]}").is_err());
        assert!(parse_brew_info("not json").is_err());
    }

    #[test]
    fn parses_recorded_github_release() {
        let release = parse_github_release(GITHUB).expect("parse");
        assert_eq!(release.version, "1.2.0");
        assert_eq!(
            release.url.as_deref(),
            Some("https://github.com/incoai/splash/releases/tag/1.2.0")
        );
        assert!(release.notes.is_some());
        let v = parse_github_release(r#"{"tag_name":"v1.3.0"}"#).expect("parse");
        assert_eq!(v.version, "1.3.0");
    }

    #[test]
    fn compares_versions_numerically() {
        assert_eq!(compare_versions("1.10.0", "1.9.2"), Ordering::Greater);
        assert_eq!(compare_versions("1.2", "1.2.0"), Ordering::Equal);
        assert_eq!(compare_versions("v1.2.1", "1.2.0"), Ordering::Greater);
        assert_eq!(compare_versions("1.0.1", "1.0.2"), Ordering::Less);
        assert!(is_newer(Some("1.3.0"), Some("1.2.0")));
        assert!(!is_newer(None, Some("1.2.0")));
    }

    #[test]
    fn summary_flags_a_lagging_tap() {
        let tap = TapInfo {
            formula: FORMULA.into(),
            stable: Some("1.2.0".into()),
            installed: vec!["1.2.0".into()],
            outdated: false,
            pinned: false,
            tap: Some("incoai/tap".into()),
        };
        let github = parse_github_release(r#"{"tag_name":"1.3.0"}"#).expect("parse");
        let check = summarize(Some("1.2.0".into()), Ok(tap.clone()), Ok(github), 1);
        assert!(!check.upgrade_available);
        assert!(check.release_not_in_tap);
        assert_eq!(check.latest.as_deref(), Some("1.3.0"));

        let newer_tap = TapInfo {
            stable: Some("1.3.0".into()),
            ..tap
        };
        let check = summarize(
            Some("1.2.0".into()),
            Ok(newer_tap),
            Err("offline".into()),
            1,
        );
        assert!(check.upgrade_available);
        assert!(!check.release_not_in_tap);
        assert_eq!(check.github_error.as_deref(), Some("offline"));

        let check = summarize(None, Err("no brew".into()), Err("offline".into()), 1);
        assert_eq!(check.latest, None);
        assert!(!check.upgrade_available);
    }

    #[test]
    fn finds_live_servers_from_lock_files() {
        let dir = TempDir::new("runtime");
        dir.write(
            "serve-8011.lock",
            r#"{"pid": 111, "model": "incoai/Qwen3.8-27B-Splash", "port": 8011}"#,
        );
        dir.write(
            "serve.lock",
            r#"{"pid": 111, "model": "incoai/Qwen3.8-27B-Splash", "port": 8011}"#,
        );
        dir.write(
            "serve-8000.lock",
            r#"{"pid": 222, "model": "x/y", "port": 8000}"#,
        );
        dir.write("serve-9000.lock", "");
        dir.write("other.json", r#"{"pid": 111, "model": "a/b", "port": 1}"#);
        let servers = running_servers(dir.path(), |pid| pid == 111);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].port, 8011);
        assert_eq!(servers[0].model, "incoai/Qwen3.8-27B-Splash");
        assert!(running_servers(Path::new("/nonexistent/runtime"), |_| true).is_empty());
    }

    #[test]
    fn this_process_is_alive() {
        assert!(pid_alive(std::process::id()));
        assert!(!pid_alive(0));
    }

    #[test]
    fn locates_a_libexec_with_release_json() {
        let dir = TempDir::new("libexec");
        assert!(locate(SplashSource::Homebrew, dir.path()).is_none());
        dir.write("release.json", r#"{"version": "1.2.0"}"#);
        let found = locate(SplashSource::Homebrew, dir.path()).expect("found");
        assert_eq!(found.version.as_deref(), Some("1.2.0"));
        assert!(!found.python_ok);
        assert!(found.python.ends_with("python/bin/python3"));
        let candidates =
            libexec_candidates(Some(Path::new("/opt/homebrew")), Some(Path::new("/data")));
        assert_eq!(
            candidates[0].1,
            PathBuf::from("/opt/homebrew/opt/splash/libexec")
        );
        assert_eq!(candidates.last().map(|c| c.0), Some(SplashSource::Tester));
        assert_eq!(
            brew_prefix(Path::new("/opt/homebrew/bin/brew")),
            Some(PathBuf::from("/opt/homebrew"))
        );
    }
}
