//! `install_*` Tauri commands. Frontend wrapper: `src/lib/install/api.ts`.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::brew::{self, InstallStatus, LatestCheck, HOMEBREW_INSTALL_COMMAND, HOMEBREW_URL};
use super::job::{self, BrewAction, BrewRunResult, InstallProgress, JOBS};
use super::{OpError, OpResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomebrewInstallCommand {
    /// Run in the embedded terminal (it asks for an admin password).
    pub command: String,
    /// Or open this page.
    pub url: String,
}

fn needs_terminal() -> OpError {
    OpError::NeedsTerminal {
        message: "Homebrew is not installed. Its installer asks for your password, so it runs in the terminal pane."
            .into(),
        command: HOMEBREW_INSTALL_COMMAND.into(),
        url: HOMEBREW_URL.into(),
    }
}

/// Homebrew, the Splash installation (version from release.json) and the
/// servers running now. Fast; never runs brew. JS: `invoke('install_status')`
#[tauri::command]
pub async fn install_status() -> InstallStatus {
    // Directory probes only, but keep them off the async runtime's workers.
    tokio::task::spawn_blocking(brew::status)
        .await
        .unwrap_or_else(|_| brew::status())
}

/// `brew info --json=v2 incoai/tap/splash` and GitHub's latest release, both
/// reported (the tap can lag GitHub). JS: `invoke('install_check_latest')`
#[tauri::command]
pub async fn install_check_latest() -> LatestCheck {
    brew::check_latest().await
}

/// The official Homebrew installer, for the embedded terminal.
/// JS: `invoke('install_homebrew_command')`
#[tauri::command]
pub fn install_homebrew_command() -> HomebrewInstallCommand {
    HomebrewInstallCommand {
        command: HOMEBREW_INSTALL_COMMAND.into(),
        url: HOMEBREW_URL.into(),
    }
}

/// Runs `brew install|upgrade|uninstall incoai/tap/splash`, streaming
/// `install://progress`. Upgrade and uninstall refuse while Splash servers
/// run unless `force` (stop them first: Homebrew does not take Splash's
/// locks). Resolves when brew exits. JS: `invoke('install_run', { action, force? })`
#[tauri::command]
pub async fn install_run(
    app: AppHandle,
    action: BrewAction,
    force: Option<bool>,
) -> OpResult<BrewRunResult> {
    let brew = brew::find_brew().ok_or_else(needs_terminal)?;
    let status = tokio::task::spawn_blocking(brew::status)
        .await
        .map_err(|e| OpError::Other(e.to_string()))?;
    if action != BrewAction::Install && !status.installed {
        return Err(OpError::SplashNotInstalled);
    }
    if action != BrewAction::Install
        && !force.unwrap_or(false)
        && !status.running_servers.is_empty()
    {
        let list = status
            .running_servers
            .iter()
            .map(|s| format!("{} on port {} (pid {})", s.model, s.port, s.pid))
            .collect::<Vec<_>>()
            .join(", ");
        return Err(OpError::InUse(format!(
            "Stop the running Splash servers first: {list}"
        )));
    }
    let guard = JOBS.begin(action)?;
    let emit = move |progress: &InstallProgress| {
        let _ = app.emit(job::EVENT_PROGRESS, progress);
    };
    Ok(job::run_job(&brew, action, &guard, &emit).await)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveBrewJob {
    pub job_id: String,
    pub action: BrewAction,
}

/// The brew job running now, if any (for views mounted mid-install).
/// JS: `invoke('install_active')`
#[tauri::command]
pub fn install_active() -> Option<ActiveBrewJob> {
    JOBS.active()
        .map(|(job_id, action)| ActiveBrewJob { job_id, action })
}

/// Cancels the running brew job (SIGINT to its process group). False when
/// none runs. JS: `invoke('install_cancel')`
#[tauri::command]
pub fn install_cancel() -> bool {
    JOBS.cancel()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_terminal_carries_the_official_command() {
        let json = serde_json::to_value(needs_terminal()).expect("serialize");
        assert_eq!(json["kind"], "needsTerminal");
        assert!(json["command"]
            .as_str()
            .is_some_and(|c| c.contains("Homebrew/install/HEAD/install.sh")));
        assert_eq!(json["url"], "https://brew.sh");
    }
}
