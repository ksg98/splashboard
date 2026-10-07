//! `engine_*` Tauri commands. Frontend wrapper: `src/lib/splash/engine.ts`.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::State;

use super::detect::{self, SplashInstall};
use super::events::{now_ms, EngineState, ExternalServer, LogLine};
use super::params::{self, RenderedServe, ServeRequest};
use super::secrets;
use super::supervisor::{SpawnSpec, StopTimeouts, Supervisor, SupervisorSettings};
use crate::error::{AppError, AppResult};
use crate::transport::{SplashTransport, TransportConfigPatch};

/// A user-chosen binary must still be a `splash` executable: the webview
/// should not be able to launch arbitrary programs through this command.
fn checked_override(path: Option<String>) -> AppResult<Option<PathBuf>> {
    let Some(path) = path.filter(|p| !p.trim().is_empty()) else {
        return Ok(None);
    };
    let path = PathBuf::from(path.trim());
    if path.file_name().and_then(|n| n.to_str()) != Some("splash") {
        return Err(AppError::InvalidRequest(
            "the engine binary must be named `splash`".into(),
        ));
    }
    Ok(Some(path))
}

/// The HF hub cache the server will use: the request's `hf_hub_cache` or
/// `hf_home`, else the app's environment, else the default.
fn hf_cache_for(request: &ServeRequest) -> Option<PathBuf> {
    let flag = |key: &str| {
        request
            .flags
            .iter()
            .find(|f| f.key == key)
            .and_then(|f| f.value.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(expand_home)
    };
    flag("hf_hub_cache")
        .or_else(|| flag("hf_home").map(|home| home.join("hub")))
        .or_else(super::supervisor::default_hf_cache)
}

fn expand_home(path: &str) -> PathBuf {
    match (path.strip_prefix("~/"), dirs::home_dir()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(path),
    }
}

/// Renders `request` for the installed Splash and adds the secrets.
async fn render_for_install(
    request: &ServeRequest,
    transport: &SplashTransport,
) -> AppResult<(PathBuf, RenderedServe, Option<String>)> {
    let binary = checked_override(request.binary.clone())?;
    let program = detect::find_splash(binary.as_deref()).ok_or(AppError::SplashNotFound)?;
    let version = detect::installed_version(&program).await;
    let api_key = transport.config().api_key;
    let rendered = params::render(request, version.as_deref())?
        .with_secret("SPLASH_API_KEY", api_key.as_deref())
        .with_secret("HF_TOKEN", secrets::hf_token().as_deref());
    Ok((program, rendered, api_key))
}

async fn build_spec(request: &ServeRequest, transport: &SplashTransport) -> AppResult<SpawnSpec> {
    let (program, rendered, api_key) = render_for_install(request, transport).await?;
    let mut env = rendered.env_pairs();
    env.push(("PYTHONUNBUFFERED".into(), "1".into()));
    Ok(SpawnSpec {
        program,
        args: rendered.args.clone(),
        env,
        model: request.model.trim().to_string(),
        port: request.port,
        probe: true,
        api_key,
        hf_cache: hf_cache_for(request),
        command: Some(rendered.redacted()),
    })
}

/// JS: `invoke('engine_detect', { binary? })`
#[tauri::command]
pub async fn engine_detect(
    supervisor: State<'_, Supervisor>,
    binary: Option<String>,
) -> AppResult<SplashInstall> {
    let binary = checked_override(binary)?;
    let install = detect::detect(binary.as_deref()).await;
    supervisor.note_install(install.found);
    Ok(install)
}

/// The argv, env (secrets redacted) and display command a request becomes
/// for the installed Splash, without starting anything. Errors exactly as
/// `engine_start` would (unknown key, version too old, ...).
/// JS: `invoke('engine_render', { options })`
#[tauri::command]
pub async fn engine_render(
    transport: State<'_, SplashTransport>,
    options: ServeRequest,
) -> AppResult<RenderedServe> {
    let (_, rendered, _) = render_for_install(&options, &transport).await?;
    Ok(rendered.redacted())
}

/// Spawns `splash serve` and points the HTTP transport at its port. Returns
/// the `starting` state (readiness arrives as `engine://state`), or the
/// `external` state when a Splash server already holds the port.
/// JS: `invoke('engine_start', { options })`
#[tauri::command]
pub async fn engine_start(
    supervisor: State<'_, Supervisor>,
    transport: State<'_, SplashTransport>,
    options: ServeRequest,
) -> AppResult<EngineState> {
    let spec = match build_spec(&options, &transport).await {
        Ok(spec) => spec,
        Err(AppError::SplashNotFound) => {
            supervisor.note_install(false);
            return Err(AppError::SplashNotFound);
        }
        Err(error) => return Err(error),
    };
    let state = supervisor.start(spec)?;
    transport.update(TransportConfigPatch {
        port: Some(options.port),
        api_key: None,
    })?;
    Ok(state)
}

/// SIGINT, then SIGTERM (after the grace period), then SIGKILL. Resolves
/// with the final state. JS: `invoke('engine_stop')`
#[tauri::command]
pub async fn engine_stop(supervisor: State<'_, Supervisor>) -> AppResult<EngineState> {
    let grace = supervisor.settings().stop_grace_secs;
    Ok(supervisor.stop(StopTimeouts::graceful(grace)).await)
}

/// Stops, then starts `options` (or the last request).
/// JS: `invoke('engine_restart', { options? })`
#[tauri::command]
pub async fn engine_restart(
    supervisor: State<'_, Supervisor>,
    transport: State<'_, SplashTransport>,
    options: Option<ServeRequest>,
) -> AppResult<EngineState> {
    let spec = match &options {
        Some(options) => build_spec(options, &transport).await?,
        None => supervisor.last_spec().ok_or(AppError::NotRunning)?,
    };
    let grace = supervisor.settings().stop_grace_secs;
    supervisor.stop(StopTimeouts::graceful(grace)).await;
    let port = spec.port;
    let state = supervisor.start(spec)?;
    transport.update(TransportConfigPatch {
        port: Some(port),
        api_key: None,
    })?;
    Ok(state)
}

/// JS: `invoke('engine_state')`
#[tauri::command]
pub fn engine_state(supervisor: State<'_, Supervisor>) -> EngineState {
    supervisor.state()
}

/// The buffered log backlog (newest last), for views mounted after start.
/// JS: `invoke('engine_logs')`
#[tauri::command]
pub fn engine_logs(supervisor: State<'_, Supervisor>) -> Vec<LogLine> {
    supervisor.logs()
}

fn checked_save_path(path: Option<String>) -> AppResult<PathBuf> {
    let Some(path) = path.filter(|p| !p.trim().is_empty()) else {
        let dir = dirs::download_dir()
            .or_else(dirs::home_dir)
            .ok_or_else(|| AppError::Other("no Downloads folder".into()))?;
        return Ok(dir.join(format!("splash-serve-{}.log", now_ms())));
    };
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() {
        return Err(AppError::InvalidRequest(
            "the log path must be absolute".into(),
        ));
    }
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default();
    if !matches!(extension, "log" | "txt") {
        return Err(AppError::InvalidRequest(
            "the log file must end in .log or .txt".into(),
        ));
    }
    if !path.parent().is_some_and(Path::is_dir) {
        return Err(AppError::InvalidRequest("the folder does not exist".into()));
    }
    Ok(path)
}

/// Saves every engine log line of this app run. Without `path`, writes
/// `~/Downloads/splash-serve-<ms>.log`. Resolves with the path written.
/// JS: `invoke('engine_save_log', { path? })`
#[tauri::command]
pub fn engine_save_log(
    supervisor: State<'_, Supervisor>,
    path: Option<String>,
) -> AppResult<String> {
    let dest = checked_save_path(path)?;
    supervisor.save_log(&dest)?;
    Ok(dest.display().to_string())
}

/// Adopts the external Splash server (shown in state, or on `port`): it is
/// polled and stoppable like our own, and the transport points at it.
/// JS: `invoke('engine_adopt', { port? })`
#[tauri::command]
pub async fn engine_adopt(
    supervisor: State<'_, Supervisor>,
    transport: State<'_, SplashTransport>,
    port: Option<u16>,
) -> AppResult<EngineState> {
    let state = supervisor.adopt(port, transport.config().api_key).await?;
    if let Some(port) = state.port {
        transport.update(TransportConfigPatch {
            port: Some(port),
            api_key: None,
        })?;
    }
    Ok(state)
}

/// SIGINT (then SIGTERM, SIGKILL) to the Splash server holding `port`'s lock
/// (or the external one shown), after checking the pid is a Splash process.
/// JS: `invoke('engine_stop_external', { port? })`
#[tauri::command]
pub async fn engine_stop_external(
    supervisor: State<'_, Supervisor>,
    port: Option<u16>,
) -> AppResult<EngineState> {
    let grace = supervisor.settings().stop_grace_secs;
    supervisor
        .stop_external(port, StopTimeouts::graceful(grace))
        .await
}

/// Every running Splash server found through its port lock.
/// JS: `invoke('engine_discover')`
#[tauri::command]
pub async fn engine_discover(supervisor: State<'_, Supervisor>) -> AppResult<Vec<ExternalServer>> {
    Ok(supervisor.discover().await)
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorSettingsPatch {
    pub auto_restart: Option<bool>,
    pub max_restarts: Option<u32>,
    pub restart_window_secs: Option<u64>,
    pub restart_backoff_ms: Option<u64>,
    pub stop_grace_secs: Option<u64>,
    pub keep_running_on_quit: Option<bool>,
}

impl SupervisorSettingsPatch {
    pub fn apply(self, mut s: SupervisorSettings) -> SupervisorSettings {
        if let Some(v) = self.auto_restart {
            s.auto_restart = v;
        }
        if let Some(v) = self.max_restarts {
            s.max_restarts = v.min(20);
        }
        if let Some(v) = self.restart_window_secs {
            s.restart_window_secs = v.clamp(10, 24 * 3600);
        }
        if let Some(v) = self.restart_backoff_ms {
            s.restart_backoff_ms = v.clamp(50, 30_000);
        }
        if let Some(v) = self.stop_grace_secs {
            s.stop_grace_secs = v.clamp(1, 600);
        }
        if let Some(v) = self.keep_running_on_quit {
            s.keep_running_on_quit = v;
        }
        s
    }
}

/// Reads (no patch) or changes the supervisor settings.
/// JS: `invoke('engine_configure', { patch? })`
#[tauri::command]
pub fn engine_configure(
    supervisor: State<'_, Supervisor>,
    patch: Option<SupervisorSettingsPatch>,
) -> SupervisorSettings {
    match patch {
        Some(patch) => supervisor.configure(patch.apply(supervisor.settings())),
        None => supervisor.settings(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn override_must_be_named_splash() {
        assert!(checked_override(Some("/bin/sh".into())).is_err());
        assert_eq!(checked_override(Some(" ".into())).unwrap(), None);
        assert_eq!(
            checked_override(Some("/opt/x/splash".into())).unwrap(),
            Some(PathBuf::from("/opt/x/splash"))
        );
    }

    #[test]
    fn save_paths() {
        assert!(checked_save_path(Some("relative.log".into())).is_err());
        assert!(checked_save_path(Some("/tmp/x.sh".into())).is_err());
        assert!(checked_save_path(Some("/nonexistent-dir/x.log".into())).is_err());
        let ok = std::env::temp_dir().join("splash.log");
        assert_eq!(
            checked_save_path(Some(ok.display().to_string())).unwrap(),
            ok
        );
        assert!(checked_save_path(None)
            .unwrap()
            .to_string_lossy()
            .ends_with(".log"));
    }

    #[test]
    fn settings_patch_clamps() {
        let s = SupervisorSettingsPatch {
            auto_restart: Some(true),
            stop_grace_secs: Some(0),
            max_restarts: Some(1000),
            ..Default::default()
        }
        .apply(SupervisorSettings::default());
        assert!(s.auto_restart);
        assert_eq!(s.stop_grace_secs, 1);
        assert_eq!(s.max_restarts, 20);
        assert!(!s.keep_running_on_quit);
    }

    #[test]
    fn hf_cache_from_flags() {
        let request: ServeRequest = serde_json::from_value(serde_json::json!({
            "model": "a/b", "port": 8000,
            "flags": [{"key": "hf_home", "value": "/data/hf"}]
        }))
        .unwrap();
        assert_eq!(hf_cache_for(&request), Some(PathBuf::from("/data/hf/hub")));
        let request: ServeRequest = serde_json::from_value(serde_json::json!({
            "model": "a/b", "port": 8000,
            "flags": [{"key": "hf_hub_cache", "value": "/x/hub"}, {"key": "hf_home", "value": "/data/hf"}]
        }))
        .unwrap();
        assert_eq!(hf_cache_for(&request), Some(PathBuf::from("/x/hub")));
    }
}
