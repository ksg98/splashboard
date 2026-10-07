//! Which coding agents are installed, found on the login PATH (the same PATH
//! `splash <agent>` sees when it runs inside a Splashboard terminal).
//!
//! The catalog (labels, mechanisms, undo) lives in the frontend, generated
//! from docs/splash-params.json; only the binary names are needed here.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::process::Command;

/// `splash <agent>` subcommands; each runs the binary of the same name.
pub const AGENTS: &[&str] = &["claude", "opencode", "codex", "hermes", "pi"];
const VERSION_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstall {
    pub id: String,
    pub found: bool,
    pub path: Option<String>,
    /// Parsed from `--version` ("2.0.14 (Claude Code)" -> "2.0.14").
    pub version: Option<String>,
    /// First line of `--version`, or why it could not be read.
    pub version_output: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorDetection {
    pub agents: Vec<AgentInstall>,
    /// The splash executable agent sessions run, if found.
    pub splash_path: Option<String>,
    /// The PATH sessions get, for diagnostics.
    pub search_path: String,
}

/// The first dotted version number in `output`, e.g. "codex-cli 0.46.0" ->
/// "0.46.0", "v1.2" -> "1.2".
pub fn parse_version(output: &str) -> Option<String> {
    output
        .split(|c: char| c.is_whitespace() || matches!(c, '(' | ')' | ',' | '/'))
        .filter_map(|word| {
            let word = word.trim_start_matches(|c: char| !c.is_ascii_digit());
            let end = word
                .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+')))
                .unwrap_or(word.len());
            let word = word[..end].trim_end_matches('.');
            let mut parts = word.split('.');
            let major = parts.next()?;
            let minor = parts.next()?;
            let numeric = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
            let minor_digits: String = minor.chars().take_while(char::is_ascii_digit).collect();
            (numeric(major) && !minor_digits.is_empty()).then(|| word.to_string())
        })
        .next()
}

/// Finds `binary` on `search_path` and asks it for its version.
pub async fn detect_one(id: &str, search_path: &OsString, cwd: &Path) -> AgentInstall {
    let Ok(path) = which::which_in(id, Some(search_path), cwd) else {
        return AgentInstall {
            id: id.to_string(),
            found: false,
            path: None,
            version: None,
            version_output: None,
        };
    };
    let version_output = probe_version(&path, search_path).await;
    AgentInstall {
        id: id.to_string(),
        found: true,
        path: Some(path.to_string_lossy().into_owned()),
        version: version_output.as_deref().and_then(parse_version),
        version_output,
    }
}

async fn probe_version(path: &Path, search_path: &OsString) -> Option<String> {
    let run = Command::new(path)
        .arg("--version")
        .env("PATH", search_path)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(VERSION_TIMEOUT, run).await {
        Ok(Ok(out)) => {
            let text = if out.stdout.iter().any(|b| !b.is_ascii_whitespace()) {
                out.stdout
            } else {
                out.stderr
            };
            String::from_utf8_lossy(&text)
                .lines()
                .map(str::trim)
                .find(|l| !l.is_empty())
                .map(str::to_string)
        }
        Ok(Err(e)) => Some(format!("could not run --version: {e}")),
        Err(_) => Some("--version timed out".to_string()),
    }
}

/// Detects every agent concurrently.
pub async fn detect_all(search_path: &OsString, cwd: &Path) -> Vec<AgentInstall> {
    futures_util::future::join_all(AGENTS.iter().map(|id| detect_one(id, search_path, cwd))).await
}

/// The splash CLI: the login PATH first, then the Homebrew prefixes.
pub fn find_splash() -> Option<PathBuf> {
    super::login_env::which("splash").or_else(|| crate::splash::detect::find_splash(None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn parses_agent_versions() {
        assert_eq!(
            parse_version("2.0.14 (Claude Code)").as_deref(),
            Some("2.0.14")
        );
        assert_eq!(parse_version("codex-cli 0.46.0").as_deref(), Some("0.46.0"));
        assert_eq!(parse_version("opencode v1.2.3").as_deref(), Some("1.2.3"));
        assert_eq!(parse_version("0.15.0").as_deref(), Some("0.15.0"));
        assert_eq!(
            parse_version("Hermes Agent v0.8.0 (2025.10.1)").as_deref(),
            Some("0.8.0")
        );
        assert_eq!(
            parse_version("pi 1.4.0-beta.1").as_deref(),
            Some("1.4.0-beta.1")
        );
        assert_eq!(parse_version("version 3."), None);
        assert_eq!(parse_version("no version here"), None);
        assert_eq!(parse_version(""), None);
    }

    fn fake_bin_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "splashboard-pty-test-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn write_script(dir: &Path, name: &str, body: &str) {
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write");
        let mut perms = std::fs::metadata(&path).expect("meta").permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).expect("chmod");
    }

    #[tokio::test]
    async fn detects_installed_agents_and_versions() {
        let dir = fake_bin_dir("detect");
        write_script(&dir, "claude", "echo '2.0.14 (Claude Code)'");
        write_script(&dir, "codex", "echo 'codex-cli 0.46.0' >&2");
        write_script(&dir, "pi", "exit 0");
        let path = OsString::from(dir.as_os_str());
        let found = detect_all(&path, &dir).await;
        assert_eq!(found.len(), AGENTS.len());
        let by_id = |id: &str| found.iter().find(|a| a.id == id).cloned().expect(id);

        let claude = by_id("claude");
        assert!(claude.found);
        assert_eq!(claude.version.as_deref(), Some("2.0.14"));
        assert_eq!(
            claude.version_output.as_deref(),
            Some("2.0.14 (Claude Code)")
        );
        assert_eq!(by_id("codex").version.as_deref(), Some("0.46.0"));
        let pi = by_id("pi");
        assert!(pi.found && pi.version.is_none());
        let opencode = by_id("opencode");
        assert!(!opencode.found && opencode.path.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_hanging_version_probe_times_out() {
        let dir = fake_bin_dir("hang");
        write_script(&dir, "hermes", "exec /bin/sleep 30");
        let path = OsString::from(dir.as_os_str());
        let start = std::time::Instant::now();
        let hermes = detect_one("hermes", &path, &dir).await;
        assert!(start.elapsed() < Duration::from_secs(9));
        assert!(hermes.found);
        assert_eq!(
            hermes.version_output.as_deref(),
            Some("--version timed out")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
