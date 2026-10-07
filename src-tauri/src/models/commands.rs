//! `models_*` and `hf_token_*` Tauri commands. Frontend wrapper:
//! `src/lib/models/api.ts`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::catalog::{self, Catalog, CatalogPaths, InfoCache, RepoVariants};
use super::download::{
    self, DownloadResult, JobKind, JobSnapshot, ModelEvents, ModelLog, ModelRequest, VerifyResult,
    JOBS,
};
use super::installed::{self, InstalledReport, Sidecar};
use super::progress::ModelProgress;
use super::remove::{self, RemovePlan, RemoveResult};
use super::token::{self, TokenStatus};
use super::{hfcache, ids};
use crate::install::brew::{self, RunningServer};
use crate::install::runner::{self, RunSpec};
use crate::install::{OpError, OpResult};

/// Refuse to start a download with less free space than this.
const MIN_FREE_BYTES: u64 = 2_000_000_000;

struct TauriModelEvents(AppHandle);

impl ModelEvents for TauriModelEvents {
    fn progress(&self, progress: &ModelProgress) {
        let _ = self.0.emit(download::EVENT_PROGRESS, progress);
    }
    fn log(&self, line: &ModelLog) {
        let _ = self.0.emit(download::EVENT_LOG, line);
    }
}

fn models_dir() -> OpResult<PathBuf> {
    brew::splash_models_dir()
        .ok_or_else(|| OpError::Other("could not find the Application Support folder".into()))
}

fn hub_cache(dir: Option<&str>) -> OpResult<PathBuf> {
    hfcache::hub_cache(dir)
        .ok_or_else(|| OpError::Other("could not find the Hugging Face cache folder".into()))
}

fn servers() -> Vec<RunningServer> {
    brew::splash_data_dir()
        .map(|d| brew::running_servers(&d.join("runtime"), brew::pid_alive))
        .unwrap_or_default()
}

fn catalog_paths() -> CatalogPaths {
    let prefix = brew::find_brew().as_deref().and_then(brew::brew_prefix);
    let splash = brew::find_splash(prefix.as_deref());
    CatalogPaths::new(
        splash.as_ref().map(|s| Path::new(&s.libexec)),
        brew::splash_data_dir().as_deref(),
    )
}

fn info_cache() -> OpResult<InfoCache> {
    InfoCache::default_path()
        .map(InfoCache::new)
        .ok_or_else(|| OpError::Other("could not find the cache folder".into()))
}

fn sidecar() -> Option<Sidecar> {
    Sidecar::default_path().map(Sidecar::new)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> OpResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| OpError::Other(e.to_string()))
}

/// The catalog. `refresh` fetches sizes older than a day from the Hub;
/// otherwise only cached and on-disk data is used (works offline).
/// JS: `invoke('models_catalog', { refresh?, hfCacheDir? })`
#[tauri::command]
pub async fn models_catalog(
    refresh: Option<bool>,
    hf_cache_dir: Option<String>,
) -> OpResult<Catalog> {
    let paths = catalog_paths();
    let cache = info_cache()?;
    let hub = hfcache::hub_cache(hf_cache_dir.as_deref());
    let token = token::current(token::token_path().as_deref()).map(|(t, _)| t);
    Ok(catalog::load_catalog(
        &paths,
        &cache,
        hub.as_deref(),
        refresh.unwrap_or(false),
        token.as_ref(),
    )
    .await)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialRefresh {
    pub ok: bool,
    pub message: String,
}

/// Refreshes Splash's official catalog cache (`install/catalog.py --refresh
/// --force`). JS: `invoke('models_catalog_refresh_official')`
#[tauri::command]
pub async fn models_catalog_refresh_official() -> OpResult<OfficialRefresh> {
    let splash = brew::require_splash()?;
    let libexec = PathBuf::from(&splash.libexec);
    let mut spec = RunSpec::new(
        &splash.python,
        &[
            &libexec.join("install/catalog.py").display().to_string(),
            "--refresh",
            "--force",
        ],
    );
    spec.cwd = Some(libexec);
    let (outcome, _, stderr) = runner::capture(&spec, Duration::from_secs(30)).await?;
    Ok(if outcome.success() {
        OfficialRefresh {
            ok: true,
            message: "Refreshed the official model list.".into(),
        }
    } else {
        OfficialRefresh {
            ok: false,
            message: stderr
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .map(|l| format!("Could not refresh; showing the cached list ({})", l.trim()))
                .unwrap_or_else(|| "Could not refresh; showing the cached list.".into()),
        }
    })
}

/// GGUF variants (root files, sizes, unsupported ones marked) and vision
/// projectors of a repository, for the "Add model" dialog. Cached; offline it
/// falls back to the hub cache's tree listing.
/// JS: `invoke('models_repo_variants', { repo, refresh?, hfCacheDir? })`
#[tauri::command]
pub async fn models_repo_variants(
    repo: String,
    refresh: Option<bool>,
    hf_cache_dir: Option<String>,
) -> OpResult<RepoVariants> {
    ids::validate_repo_id(&repo).map_err(OpError::InvalidRequest)?;
    let cache = info_cache()?;
    let mut infos = cache.load();
    let fresh = infos.get(&repo).is_some_and(|i| {
        crate::install::now_ms().saturating_sub(i.fetched_at_ms) < catalog::INFO_MAX_AGE_MS
    });
    if refresh.unwrap_or(false) || !fresh {
        let token = token::current(token::token_path().as_deref()).map(|(t, _)| t);
        let client = brew::http_client()?;
        match catalog::fetch_repo_info(&client, &catalog::endpoint(), &repo, token.as_ref()).await {
            Ok(info) => {
                infos.insert(repo.clone(), info);
                let _ = cache.save(&infos);
            }
            Err(error) => {
                if !infos.contains_key(&repo) {
                    let hub = hfcache::hub_cache(hf_cache_dir.as_deref());
                    catalog::fill_from_trees(
                        &mut infos,
                        std::slice::from_ref(&repo),
                        hub.as_deref(),
                    );
                }
                if !infos.contains_key(&repo) {
                    return Err(error);
                }
            }
        }
    }
    let info = infos
        .get(&repo)
        .ok_or_else(|| OpError::NotFound(format!("no file list for {repo}")))?;
    Ok(catalog::repo_variants(info))
}

/// Installations Splash can serve offline and supported hub cache downloads,
/// with sizes on disk. JS: `invoke('models_installed', { hfCacheDir? })`
#[tauri::command]
pub async fn models_installed(hf_cache_dir: Option<String>) -> OpResult<InstalledReport> {
    let models = models_dir()?;
    let hub = hfcache::hub_cache(hf_cache_dir.as_deref());
    let repos = catalog::catalog_repos(&catalog::build_catalog(
        &catalog_paths(),
        &Default::default(),
    ));
    blocking(move || {
        let side = sidecar().map(|s| s.load()).unwrap_or_default();
        installed::report(Some(&models), hub.as_deref(), &repos, &side, &servers())
    })
    .await
}

/// Downloads and installs a model with Splash's installer, streaming
/// `models://progress` and `models://log`. Resolves when it ends.
/// JS: `invoke('models_download', { request })`
#[tauri::command]
pub async fn models_download(app: AppHandle, request: ModelRequest) -> OpResult<DownloadResult> {
    request.validate()?;
    let splash = brew::require_splash()?;
    let models = models_dir()?;
    let hub = hub_cache(request.hf_cache_dir.as_deref())?;
    if let Ok(space) = disk_space(&hub) {
        if space.free_bytes < MIN_FREE_BYTES {
            return Err(OpError::Failed(format!(
                "Only {:.1} GB free in {}; free some space first",
                space.free_bytes as f64 / 1e9,
                space.path
            )));
        }
    }
    let key = request.key()?;
    let guard = JOBS.begin(&key, &request.model, JobKind::Download)?;
    if let Some(sidecar) = sidecar() {
        if let Err(error) = download::record_selection(&sidecar, &request) {
            log::warn!("could not record the selection options: {error}");
        }
    }
    let events = TauriModelEvents(app);
    Ok(download::download(&splash, &models, &hub, &request, &guard, &events, false).await)
}

/// Cancels a download or check by job key (selection link) or model ID.
/// JS: `invoke('models_download_cancel', { key })`
#[tauri::command]
pub fn models_download_cancel(key: String) -> bool {
    JOBS.cancel(&key) || JOBS.cancel_model(&key) > 0
}

/// Running downloads and checks with their last progress, for views mounted
/// mid-download. JS: `invoke('models_jobs')`
#[tauri::command]
pub fn models_jobs() -> Vec<JobSnapshot> {
    JOBS.list()
}

/// `models.py verify` (quick) or `verify --full` (re-reads every file).
/// JS: `invoke('models_verify', { request, full? })`
#[tauri::command]
pub async fn models_verify(
    app: AppHandle,
    request: ModelRequest,
    full: Option<bool>,
) -> OpResult<VerifyResult> {
    request.validate()?;
    let splash = brew::require_splash()?;
    let models = models_dir()?;
    let key = request.key()?;
    let guard = JOBS.begin(&key, &request.model, JobKind::Verify)?;
    let events = TauriModelEvents(app);
    Ok(download::verify(
        &splash,
        &models,
        &request,
        full.unwrap_or(false),
        &guard,
        &events,
    )
    .await)
}

/// Dry run: what removing an installation deletes and frees.
/// JS: `invoke('models_remove_plan', { id, alsoFreeDownloads?, hfCacheDir? })`
#[tauri::command]
pub async fn models_remove_plan(
    id: String,
    also_free_downloads: Option<bool>,
    hf_cache_dir: Option<String>,
) -> OpResult<RemovePlan> {
    let models = models_dir()?;
    let hub = hfcache::hub_cache(hf_cache_dir.as_deref());
    blocking(move || {
        remove::plan(
            &models,
            hub.as_deref(),
            &id,
            also_free_downloads.unwrap_or(false),
            &servers(),
        )
    })
    .await?
}

/// Removes an installation (after the UI confirmed the plan).
/// JS: `invoke('models_remove', { id, alsoFreeDownloads?, hfCacheDir? })`
#[tauri::command]
pub async fn models_remove(
    id: String,
    also_free_downloads: Option<bool>,
    hf_cache_dir: Option<String>,
) -> OpResult<RemoveResult> {
    let models = models_dir()?;
    if JOBS.list().iter().any(|j| j.kind == JobKind::Download) {
        return Err(OpError::Busy(
            "A download is running; try again when it finishes.".into(),
        ));
    }
    let hub = hfcache::hub_cache(hf_cache_dir.as_deref());
    blocking(move || {
        remove::execute(
            &models,
            hub.as_deref(),
            &id,
            also_free_downloads.unwrap_or(false),
            &servers(),
        )
    })
    .await?
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiskSpace {
    pub path: String,
    pub free_bytes: u64,
    pub total_bytes: u64,
}

/// Free space on the volume holding `path` (or its nearest existing parent).
pub fn disk_space(path: &Path) -> OpResult<DiskSpace> {
    let existing = path
        .ancestors()
        .find(|p| p.exists())
        .unwrap_or(Path::new("/"));
    let stat =
        nix::sys::statvfs::statvfs(existing).map_err(|e| OpError::Io(std::io::Error::from(e)))?;
    let fragment = stat.fragment_size() as u64;
    Ok(DiskSpace {
        path: existing.display().to_string(),
        free_bytes: stat.blocks_available() as u64 * fragment,
        total_bytes: stat.blocks() as u64 * fragment,
    })
}

/// JS: `invoke('models_disk_space', { hfCacheDir? })`
#[tauri::command]
pub fn models_disk_space(hf_cache_dir: Option<String>) -> OpResult<DiskSpace> {
    disk_space(&hub_cache(hf_cache_dir.as_deref())?)
}

/// Whether a Hugging Face token is saved; `verify` asks Hugging Face whose it
/// is. Never returns the token. JS: `invoke('hf_token_status', { verify? })`
#[tauri::command]
pub async fn hf_token_status(verify: Option<bool>) -> TokenStatus {
    token::status(token::token_path().as_deref(), verify.unwrap_or(false)).await
}

/// Saves the token where huggingface_hub (and so Splash) reads it. With
/// `verify` (default true), a token Hugging Face rejects is not saved.
/// JS: `invoke('hf_token_save', { token, verify? })`
#[tauri::command]
pub async fn hf_token_save(token: String, verify: Option<bool>) -> OpResult<TokenStatus> {
    token::save(
        token::token_path().as_deref(),
        &token,
        verify.unwrap_or(true),
    )
    .await
}

/// JS: `invoke('hf_token_remove')`
#[tauri::command]
pub fn hf_token_remove() -> OpResult<TokenStatus> {
    token::remove(token::token_path().as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reads this Mac's real Splash folders and hub cache (read-only):
    /// `cargo test -- --ignored live_report --nocapture`
    #[tokio::test]
    #[ignore = "reads the local Splash install and hub cache"]
    async fn live_report() {
        let status = brew::status();
        println!("{status:#?}");
        let paths = catalog_paths();
        let hub = hfcache::hub_cache(None);
        let cache = InfoCache::new(std::env::temp_dir().join("splashboard-live-hf-repos.json"));
        let catalog = catalog::load_catalog(&paths, &cache, hub.as_deref(), false, None).await;
        for entry in &catalog.entries {
            println!(
                "{:<48} {:?} {:?} {:?}",
                entry.id, entry.format, entry.size_bytes, entry.sources
            );
        }
        let repos = catalog::catalog_repos(&catalog.entries);
        let models = models_dir().expect("models dir");
        let report = installed::report(
            Some(&models),
            hub.as_deref(),
            &repos,
            &Default::default(),
            &servers(),
        );
        for i in &report.installations {
            println!(
                "{} {:?} complete={} size={} in_use={} problems={:?}",
                i.id, i.kind, i.complete, i.size_on_disk, i.in_use, i.problems
            );
        }
        for c in &report.cached {
            println!(
                "cached {} {:?} by={} size={} complete={}",
                c.cache.repo, c.role, c.matched_by, c.cache.size_on_disk, c.cache.complete
            );
        }
        if let Some(first) = report.installations.first() {
            let plan =
                remove::plan(&models, hub.as_deref(), &first.id, true, &servers()).expect("plan");
            println!("{plan:#?}");
        }
        println!(
            "{:#?}",
            token::status(token::token_path().as_deref(), false).await
        );
        println!("{:#?}", disk_space(&hub.expect("hub")).expect("space"));
    }

    /// `cargo test -- --ignored live_catalog_refresh --nocapture` (Hub API, small JSON only)
    #[tokio::test]
    #[ignore = "calls the Hugging Face API"]
    async fn live_catalog_refresh() {
        let cache = InfoCache::new(std::env::temp_dir().join("splashboard-live-refresh.json"));
        let catalog = catalog::load_catalog(&catalog_paths(), &cache, None, true, None).await;
        for entry in &catalog.entries {
            println!(
                "{:<48} {:?} {:?}",
                entry.id, entry.size_bytes, entry.size_source
            );
        }
        println!("offline={} errors={:?}", catalog.offline, catalog.errors);
        let infos = cache.load();
        if let Some(info) = infos.get("unsloth/Qwen3.6-35B-A3B-GGUF") {
            let variants = catalog::repo_variants(info);
            for v in &variants.variants {
                println!(
                    "  {:<14} {:?} supported={}",
                    v.variant, v.size_bytes, v.supported
                );
            }
        }
    }

    /// Quick-verifies the first installed model with the real installer
    /// (reads file metadata only): `cargo test -- --ignored live_verify --nocapture`
    #[tokio::test]
    #[ignore = "runs the installed Splash's models.py verify"]
    async fn live_verify() {
        let splash = brew::require_splash().expect("splash");
        let models = models_dir().expect("models");
        let side = sidecar().map(|s| s.load()).unwrap_or_default();
        let list = installed::list_installations(&models, &side, &[]);
        let Some(first) = list.iter().find(|i| !i.hashed) else {
            return;
        };
        let request = ModelRequest {
            model: first.id.clone(),
            ..Default::default()
        };
        let jobs = download::Jobs::default();
        let guard = jobs
            .begin(&first.id, &first.id, JobKind::Verify)
            .expect("begin");
        struct Print;
        impl ModelEvents for Print {
            fn progress(&self, _: &ModelProgress) {}
            fn log(&self, line: &ModelLog) {
                println!("[{:?}] {}", line.stream, line.line);
            }
        }
        let result = download::verify(&splash, &models, &request, false, &guard, &Print).await;
        println!("{result:#?}");
        assert!(result.ok, "{result:?}");
    }

    /// `cargo test -- --ignored live_latest --nocapture` (brew info + GitHub)
    #[tokio::test]
    #[ignore = "runs brew info and calls GitHub"]
    async fn live_latest() {
        println!("{:#?}", brew::check_latest().await);
    }

    #[test]
    fn measures_disk_space_of_a_missing_folder_via_its_parent() {
        let space = disk_space(Path::new("/tmp/splashboard-no-such-dir/a/b")).expect("space");
        assert!(space.total_bytes > 0);
        assert!(space.free_bytes <= space.total_bytes);
        assert!(!space.path.contains("no-such-dir"));
    }
}
