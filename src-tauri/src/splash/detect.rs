//! Finding the `splash` CLI, its version and installation, and the Mac.
//!
//! An app launched from Finder gets a minimal PATH (/usr/bin:/bin:...), so the
//! Homebrew locations are probed explicitly as well as PATH.
//!
//! The Homebrew `splash` is a shell script that execs
//! `<libexec>/python/bin/python3 -u <libexec>/install/launcher.py "$@"`;
//! the libexec dir is read from it.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tokio::process::Command;

use super::system::{self, SystemInfo};

const FALLBACK_LOCATIONS: &[&str] = &["/opt/homebrew/bin/splash", "/usr/local/bin/splash"];
const VERSION_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplashInstall {
    pub found: bool,
    /// The executable that will be launched.
    pub path: Option<String>,
    /// Parsed from `splash --version` ("Splash 1.2.0" -> "1.2.0").
    pub version: Option<String>,
    /// Raw `--version` output, or the error running it.
    pub version_output: Option<String>,
    /// Every location that was checked, in order.
    pub searched: Vec<String>,
    /// `~/Library/Application Support/Splash/models`, where Splash links
    /// installed packages.
    pub models_dir: Option<String>,
    pub models_dir_exists: bool,
    /// The Hugging Face hub cache (`$HF_HUB_CACHE`, `$HF_HOME/hub` or
    /// `~/.cache/huggingface/hub`).
    pub hf_cache_dir: Option<String>,
    /// `path` with symlinks resolved (e.g. `/opt/homebrew/Cellar/splash/1.2.0/bin/splash`).
    pub resolved_path: Option<String>,
    /// Splash's program files (`.../opt/splash/libexec`): python, engine, server.
    pub libexec_dir: Option<String>,
    /// Installed by Homebrew (the executable lives in a Cellar).
    pub homebrew: bool,
    /// `~/Library/Application Support/Splash/runtime` (port locks).
    pub runtime_dir: Option<String>,
    /// macOS, chip, memory and the Metal working-set ceiling.
    pub system: SystemInfo,
}

/// Candidate executables: an explicit override first, then PATH, then the
/// Homebrew prefixes. Deduplicated, order kept.
pub fn candidates(override_path: Option<&Path>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut push = |p: PathBuf| {
        if !out.contains(&p) {
            out.push(p);
        }
    };
    if let Some(p) = override_path {
        push(p.to_path_buf());
    }
    if let Ok(found) = which::which_all("splash") {
        found.for_each(&mut push);
    }
    for location in FALLBACK_LOCATIONS {
        push(PathBuf::from(location));
    }
    if let Some(home) = dirs::home_dir() {
        push(home.join(".local/bin/splash"));
    }
    out
}

pub fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// The first candidate that exists and is executable.
pub fn find_splash(override_path: Option<&Path>) -> Option<PathBuf> {
    candidates(override_path)
        .into_iter()
        .find(|p| is_executable(p))
}

pub fn parse_version(output: &str) -> Option<String> {
    output.split_whitespace().find_map(|word| {
        let word = word.trim_start_matches('v');
        let mut parts = word.split('.');
        let numeric = parts.next()?.parse::<u32>().is_ok() && parts.next()?.parse::<u32>().is_ok();
        numeric.then(|| word.to_string())
    })
}

/// The libexec dir named in the Homebrew launcher script, if `path` is one.
pub fn libexec_from_script(script: &str) -> Option<PathBuf> {
    script.lines().find_map(|line| {
        let start = line.find("/install/launcher.py")?;
        let before = &line[..start];
        let quote = before.rfind(['"', '\'', ' '])?;
        let dir = before[quote + 1..].trim();
        (!dir.is_empty()).then(|| PathBuf::from(dir))
    })
}

/// libexec for an executable: from its launcher script, else the Homebrew
/// layout (`<prefix>/Cellar/splash/<v>/bin/splash` -> `<prefix>/opt/splash/libexec`).
pub fn libexec_dir(path: &Path) -> Option<PathBuf> {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    if let Ok(meta) = std::fs::metadata(&resolved) {
        if meta.len() < 64 * 1024 {
            if let Ok(script) = std::fs::read_to_string(&resolved) {
                if let Some(dir) = libexec_from_script(&script) {
                    return Some(dir);
                }
            }
        }
    }
    let version_dir = resolved.parent()?.parent()?;
    let libexec = version_dir.join("libexec");
    libexec.is_dir().then_some(libexec)
}

pub fn is_homebrew(resolved: &Path) -> bool {
    resolved.to_string_lossy().contains("/Cellar/splash/")
}

pub async fn detect(override_path: Option<&Path>) -> SplashInstall {
    let searched: Vec<String> = candidates(override_path)
        .iter()
        .map(|p| p.display().to_string())
        .collect();
    let models_dir = dirs::data_dir().map(|d| d.join("Splash/models"));
    let models_dir_exists = models_dir.as_deref().is_some_and(Path::is_dir);
    let hf_cache_dir = hf_cache_dir();

    let path = find_splash(override_path);
    let (version, version_output) = match &path {
        Some(path) => match run_version(path).await {
            Ok(output) => (parse_version(&output), Some(output)),
            Err(error) => (None, Some(error)),
        },
        None => (None, None),
    };

    let resolved = path.as_deref().and_then(|p| std::fs::canonicalize(p).ok());
    let libexec = path.as_deref().and_then(libexec_dir);
    let system = tokio::task::spawn_blocking(system::system_info)
        .await
        .unwrap_or_else(|_| SystemInfo {
            macos_version: None,
            chip: None,
            memory_bytes: None,
            arch: std::env::consts::ARCH.to_string(),
            metal_working_set_bytes: 0,
            metal_estimated: true,
            unified_memory: None,
        });

    SplashInstall {
        found: path.is_some(),
        path: path.map(|p| p.display().to_string()),
        version,
        version_output,
        searched,
        models_dir: models_dir.map(|p| p.display().to_string()),
        models_dir_exists,
        hf_cache_dir: hf_cache_dir.map(|p| p.display().to_string()),
        homebrew: resolved.as_deref().is_some_and(is_homebrew),
        resolved_path: resolved.map(|p| p.display().to_string()),
        libexec_dir: libexec.map(|p| p.display().to_string()),
        runtime_dir: super::lockfile::splash_runtime_dir().map(|p| p.display().to_string()),
        system,
    }
}

/// The installed version (`splash --version` -> "1.2.0"), if it can be read.
pub async fn installed_version(path: &Path) -> Option<String> {
    run_version(path).await.ok().and_then(|o| parse_version(&o))
}

async fn run_version(path: &Path) -> Result<String, String> {
    let mut command = Command::new(path);
    command
        .arg("--version")
        .env("PATH", super::supervisor::augmented_path())
        .kill_on_drop(true);
    let output = tokio::time::timeout(VERSION_TIMEOUT, command.output())
        .await
        .map_err(|_| "splash --version timed out".to_string())?
        .map_err(|e| format!("could not run splash --version: {e}"))?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(text.trim().to_string())
}

pub fn hf_cache_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("HF_HUB_CACHE") {
        return Some(PathBuf::from(dir));
    }
    if let Some(home) = std::env::var_os("HF_HOME") {
        return Some(PathBuf::from(home).join("hub"));
    }
    dirs::home_dir().map(|h| h.join(".cache/huggingface/hub"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_versions() {
        assert_eq!(parse_version("Splash 1.2.0").as_deref(), Some("1.2.0"));
        assert_eq!(parse_version("splash v1.10.3\n").as_deref(), Some("1.10.3"));
        assert_eq!(parse_version("no version here"), None);
    }

    /// Needs a Homebrew install of Splash:
    /// `cargo test -- --ignored detects_installed_splash --nocapture`
    #[tokio::test]
    #[ignore = "requires the splash CLI to be installed"]
    async fn detects_installed_splash() {
        let install = detect(None).await;
        println!("{install:#?}");
        assert!(install.found, "{install:?}");
        assert!(install.version.is_some(), "{install:?}");
    }

    #[test]
    fn reads_libexec_from_the_homebrew_script() {
        let script = "#!/bin/sh\nexport PYTHONDONTWRITEBYTECODE=1\nexec \"/opt/homebrew/opt/splash/libexec/python/bin/python3\" -u \"/opt/homebrew/opt/splash/libexec/install/launcher.py\" \"$@\"\n";
        assert_eq!(
            libexec_from_script(script),
            Some(PathBuf::from("/opt/homebrew/opt/splash/libexec"))
        );
        assert_eq!(libexec_from_script("#!/bin/sh\necho hi\n"), None);
        assert!(is_homebrew(Path::new(
            "/opt/homebrew/Cellar/splash/1.2.0/bin/splash"
        )));
        assert!(!is_homebrew(Path::new("/Users/me/.local/bin/splash")));
    }

    #[test]
    fn override_comes_first() {
        let list = candidates(Some(Path::new("/tmp/custom/splash")));
        assert_eq!(list[0], PathBuf::from("/tmp/custom/splash"));
        assert!(list.contains(&PathBuf::from("/opt/homebrew/bin/splash")));
    }
}
