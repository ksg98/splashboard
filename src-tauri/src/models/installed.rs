//! What Splash can serve offline: its installations (selection links under
//! `~/Library/Application Support/Splash/models`, including the hidden
//! `.selections/`) and hub cache downloads of supported repositories.
//!
//! Hashed selections (`.selections/<sha256>`) carry no readable options, so
//! Splashboard records the options it used for each in a sidecar file
//! ([`Sidecar`]); an assembly's own `model.json` names its model and sources.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::catalog::{self, ModelFormat};
use super::hfcache::{self, CachedRepo};
use super::locks;
use crate::install::brew::RunningServer;
use crate::install::now_ms;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InstallationKind {
    /// models/.resolved/<sha> with model.json (Splash 1.1+ upstream models).
    Assembly,
    /// A legacy Splash package: the link names a hub snapshot with manifest.json.
    Package,
    /// The link's target is gone or holds neither record.
    Broken,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SelectionOptions {
    pub revision: Option<String>,
    pub draft_model: Option<String>,
    #[serde(default)]
    pub language_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SidecarEntry {
    pub model: String,
    #[serde(flatten)]
    pub options: SelectionOptions,
    pub recorded_at_ms: u64,
}

/// Splashboard's record of hashed selections it installed:
/// `<app data>/selections.json`, `.selections/<hash>` -> options.
pub struct Sidecar {
    path: PathBuf,
}

impl Sidecar {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// ~/Library/Application Support/ai.splashboard.app/selections.json
    pub fn default_path() -> Option<PathBuf> {
        dirs::data_dir().map(|d| d.join("ai.splashboard.app/selections.json"))
    }

    pub fn load(&self) -> BTreeMap<String, SidecarEntry> {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    pub fn record(
        &self,
        link_rel: &str,
        model: &str,
        options: &SelectionOptions,
    ) -> std::io::Result<()> {
        let mut entries = self.load();
        entries.insert(
            link_rel.to_string(),
            SidecarEntry {
                model: model.to_string(),
                options: options.clone(),
                recorded_at_ms: now_ms(),
            },
        );
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let text = serde_json::to_string_pretty(&entries).map_err(std::io::Error::other)?;
        let staging = self.path.with_extension("json.tmp");
        std::fs::write(&staging, text)?;
        std::fs::rename(staging, &self.path)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceRef {
    pub repo: String,
    /// Commit; None for a local draft directory.
    pub revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installation {
    /// The link relative to the models folder: `owner/repo[:variant]` or
    /// `.selections/<sha256>`. Pass it to remove/verify.
    pub id: String,
    /// OWNER/REPO[:VARIANT], when known.
    pub model: Option<String>,
    pub link_path: String,
    pub target_path: Option<String>,
    pub kind: InstallationKind,
    /// A `.selections/` link: installed with a revision, draft or text-only.
    pub hashed: bool,
    /// From Splashboard's sidecar, for hashed links it installed.
    pub options: Option<SelectionOptions>,
    pub family: Option<String>,
    /// "mlx-affine" | "gguf" | "package"
    pub target_format: Option<String>,
    /// "none" | "safetensors" | "gguf"
    pub vision_format: Option<String>,
    pub target: Option<SourceRef>,
    pub draft: Option<SourceRef>,
    /// Hub repositories whose files it links.
    pub repos: Vec<String>,
    /// Distinct bytes its links resolve to.
    pub size_on_disk: u64,
    pub file_count: u32,
    /// Every recorded file is present with its recorded size.
    pub complete: bool,
    pub problems: Vec<String>,
    /// A server holds it (assembly lock) or a running server serves its model.
    pub in_use: bool,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CacheRole {
    Target,
    Draft,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CachedModel {
    #[serde(flatten)]
    pub cache: CachedRepo,
    pub role: CacheRole,
    pub family: Option<String>,
    pub format: Option<ModelFormat>,
    /// Installation ids that link this repository's files.
    pub linked_by: Vec<String>,
    /// Named by the catalog (official, suggested or documented).
    pub in_catalog: bool,
    /// Why it counts as supported: "catalog" | "installation" | "config".
    pub matched_by: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledReport {
    pub models_dir: Option<String>,
    pub hf_cache_dir: Option<String>,
    pub installations: Vec<Installation>,
    pub cached: Vec<CachedModel>,
    /// Hub cache bytes of the listed repositories.
    pub cached_bytes: u64,
}

/// Every selection link: `*/*` symlinks under the models folder, as
/// `models.selection_links` globs them (which includes `.selections/*`).
pub fn selection_links(models_dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(owners) = std::fs::read_dir(models_dir) else {
        return out;
    };
    for owner in owners.flatten() {
        if !owner.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(owner.path()) else {
            continue;
        };
        for entry in entries.flatten() {
            if entry.file_type().is_ok_and(|t| t.is_symlink()) {
                out.push(entry.path());
            }
        }
    }
    out.sort();
    out
}

#[derive(Deserialize)]
struct AssemblyRecord {
    model: Option<String>,
    family: Option<String>,
    target_format: Option<String>,
    vision_format: Option<String>,
    #[serde(default)]
    sources: BTreeMap<String, SourceRef>,
    #[serde(default)]
    files: BTreeMap<String, AssemblyFile>,
}

#[derive(Deserialize)]
struct AssemblyFile {
    path: String,
    bytes: u64,
}

#[derive(Deserialize)]
struct PackageManifest {
    model: Option<String>,
    #[serde(default)]
    artifacts: Vec<PackageArtifact>,
}

#[derive(Deserialize)]
struct PackageArtifact {
    path: String,
    size: u64,
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.len() > 4 * 1024 * 1024 {
        return Err(format!("{} is too large", path.display()));
    }
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

pub fn link_id(models_dir: &Path, link: &Path) -> String {
    link.strip_prefix(models_dir)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| link.display().to_string())
}

/// Reads one selection link.
pub fn read_installation(
    models_dir: &Path,
    link: &Path,
    sidecar: &BTreeMap<String, SidecarEntry>,
    servers: &[RunningServer],
) -> Installation {
    let id = link_id(models_dir, link);
    let hashed = id.starts_with(".selections/");
    let side = sidecar.get(&id);
    let target = link.canonicalize().ok();
    let mut problems = Vec::new();
    let mut installation = Installation {
        model: if hashed {
            side.map(|s| s.model.clone())
        } else {
            Some(id.clone())
        },
        link_path: link.display().to_string(),
        target_path: target.as_ref().map(|t| t.display().to_string()),
        kind: InstallationKind::Broken,
        hashed,
        options: side.map(|s| s.options.clone()),
        family: None,
        target_format: None,
        vision_format: None,
        target: None,
        draft: None,
        repos: Vec::new(),
        size_on_disk: 0,
        file_count: 0,
        complete: false,
        problems: Vec::new(),
        in_use: false,
        modified_ms: hfcache::modified_ms(link),
        id,
    };
    let Some(target) = target else {
        installation
            .problems
            .push("the link's target is gone".into());
        return installation;
    };

    let files = hfcache::walk_files(&target);
    let usage = hfcache::usage(&files);
    installation.size_on_disk = usage.bytes;
    installation.file_count = usage.files;
    if usage.dangling > 0 {
        problems.push(format!("{} linked file(s) are missing", usage.dangling));
    }
    let mut repos: HashSet<String> = HashSet::new();
    for file in &files {
        let resolved = std::fs::read_link(file)
            .ok()
            .map(|t| file.parent().map(|p| p.join(&t)).unwrap_or(t));
        if let Some((repo, _)) = resolved.as_deref().and_then(hfcache::repo_of_path) {
            repos.insert(repo);
        }
    }

    if target.join("model.json").is_file() {
        installation.kind = InstallationKind::Assembly;
        installation.in_use = locks::is_held(&target.join("model.json"));
        match read_json::<AssemblyRecord>(&target.join("model.json")) {
            Ok(record) => {
                if installation.model.is_none() {
                    installation.model = record.model.clone();
                }
                installation.family = record.family;
                installation.target_format = record.target_format;
                installation.vision_format = record.vision_format;
                installation.target = record.sources.get("target").cloned();
                installation.draft = record.sources.get("draft").cloned();
                for source in record.sources.values() {
                    if source.revision.is_some() {
                        repos.insert(source.repo.clone());
                    }
                }
                for (name, entry) in &record.files {
                    match std::fs::metadata(target.join(name)) {
                        Ok(meta) if meta.len() == entry.bytes => {}
                        Ok(_) => problems.push(format!("{name} changed size")),
                        Err(_) => problems.push(format!("{name} is missing")),
                    }
                    if let Some((repo, _)) = hfcache::repo_of_path(Path::new(&entry.path)) {
                        repos.insert(repo);
                    }
                }
            }
            Err(error) => problems.push(format!("unreadable model.json: {error}")),
        }
    } else if target.join("manifest.json").is_file() {
        installation.kind = InstallationKind::Package;
        installation.target_format = Some("package".into());
        if let Some((repo, commit)) = hfcache::repo_of_path(&target.join("manifest.json")) {
            installation.target = Some(SourceRef {
                repo: repo.clone(),
                revision: Some(commit),
            });
            installation.family = catalog::infer_family(&repo);
            repos.insert(repo);
        }
        match read_json::<PackageManifest>(&target.join("manifest.json")) {
            Ok(manifest) => {
                if installation.family.is_none() {
                    installation.family = manifest.model;
                }
                for artifact in &manifest.artifacts {
                    match std::fs::metadata(target.join(&artifact.path)) {
                        Ok(meta) if meta.len() == artifact.size => {}
                        Ok(_) => problems.push(format!("{} changed size", artifact.path)),
                        Err(_) => problems.push(format!("{} is missing", artifact.path)),
                    }
                }
            }
            Err(error) => problems.push(format!("unreadable manifest.json: {error}")),
        }
    } else {
        problems.push("neither model.json nor manifest.json is present".into());
    }

    if let Some(model) = &installation.model {
        if servers.iter().any(|s| &s.model == model) {
            installation.in_use = true;
        }
    }
    let mut repos: Vec<String> = repos.into_iter().collect();
    repos.sort();
    installation.repos = repos;
    // Keep the problem list short: a missing shard reports once per file.
    problems.truncate(20);
    installation.complete = installation.kind != InstallationKind::Broken && problems.is_empty();
    installation.problems = problems;
    installation
}

pub fn list_installations(
    models_dir: &Path,
    sidecar: &BTreeMap<String, SidecarEntry>,
    servers: &[RunningServer],
) -> Vec<Installation> {
    selection_links(models_dir)
        .iter()
        .map(|link| read_installation(models_dir, link, sidecar, servers))
        .collect()
}

// --- supported downloads in the hub cache -----------------------------------------

/// The family a hub `config.json` states, and whether Splash can serve that
/// format (MLX affine-quantized), from the architecture signatures in
/// `install/families.py`.
pub fn family_from_config(config: &serde_json::Value) -> Option<(String, bool)> {
    let text = config.get("text_config")?;
    let field = |k: &str| text.get(k).and_then(serde_json::Value::as_u64);
    let model_type = text.get("model_type").and_then(serde_json::Value::as_str)?;
    let family = match model_type {
        "qwen3_5_text"
            if field("hidden_size") == Some(5120)
                && field("num_hidden_layers") == Some(64)
                && field("num_attention_heads") == Some(24)
                && field("num_key_value_heads") == Some(4)
                && field("head_dim") == Some(256)
                && field("vocab_size") == Some(248320) =>
        {
            "Qwen3.8-27B"
        }
        "qwen3_5_moe_text"
            if field("hidden_size") == Some(2048)
                && field("num_hidden_layers") == Some(40)
                && field("num_experts") == Some(256)
                && field("num_experts_per_tok") == Some(8)
                && field("vocab_size") == Some(248320) =>
        {
            "Qwen3.6-35B-A3B"
        }
        _ => return None,
    };
    let quantization = config
        .get("quantization")
        .or_else(|| config.get("quantization_config"));
    let affine = quantization.is_some_and(|q| {
        q.get("bits").is_some()
            && q.get("mode")
                .and_then(serde_json::Value::as_str)
                .is_none_or(|m| m == "affine")
    });
    Some((family.to_string(), affine))
}

/// The config.json of the newest snapshot that also holds safetensors
/// weights (a snapshot with only metadata cannot be served).
fn snapshot_config(cache: &Path, repo: &CachedRepo) -> Option<serde_json::Value> {
    repo.snapshots.iter().find_map(|snapshot| {
        let dir = hfcache::repo_dir(cache, &repo.repo)
            .join("snapshots")
            .join(&snapshot.commit);
        let has_weights = hfcache::walk_files(&dir)
            .iter()
            .any(|f| f.extension().is_some_and(|e| e == "safetensors") && f.exists());
        has_weights
            .then(|| read_json(&dir.join("config.json")).ok())
            .flatten()
    })
}

/// Hub cache repositories Splash can use: those the catalog names, those an
/// installation links, and MLX checkpoints whose config matches a supported
/// family in an affine-quantized format. Unrelated downloads are left out.
pub fn supported_cached(
    cache: &Path,
    catalog_repos: &[String],
    installations: &[Installation],
) -> Vec<CachedModel> {
    let mut out = Vec::new();
    for repo_id in hfcache::list_cached_repos(cache) {
        let linked_by: Vec<String> = installations
            .iter()
            .filter(|i| i.repos.contains(&repo_id))
            .map(|i| i.id.clone())
            .collect();
        let in_catalog = catalog_repos.contains(&repo_id);
        let format = catalog::infer_format(&repo_id, None);
        let mut family = catalog::infer_family(&repo_id);
        let matched_by = if in_catalog {
            "catalog"
        } else if !linked_by.is_empty() {
            "installation"
        } else {
            ""
        };
        let Some(repo) = hfcache::scan_repo(cache, &repo_id) else {
            continue;
        };
        let matched_by = if matched_by.is_empty() {
            match snapshot_config(cache, &repo)
                .as_ref()
                .and_then(family_from_config)
            {
                Some((f, true)) => {
                    family = Some(f);
                    "config"
                }
                _ => continue,
            }
        } else {
            matched_by
        };
        out.push(CachedModel {
            role: if format == ModelFormat::Draft {
                CacheRole::Draft
            } else {
                CacheRole::Target
            },
            format: Some(format),
            family,
            linked_by,
            in_catalog,
            matched_by: matched_by.to_string(),
            cache: repo,
        });
    }
    out
}

pub fn report(
    models_dir: Option<&Path>,
    hub_cache: Option<&Path>,
    catalog_repos: &[String],
    sidecar: &BTreeMap<String, SidecarEntry>,
    servers: &[RunningServer],
) -> InstalledReport {
    let installations = models_dir
        .map(|m| list_installations(m, sidecar, servers))
        .unwrap_or_default();
    let cached = hub_cache
        .map(|c| supported_cached(c, catalog_repos, &installations))
        .unwrap_or_default();
    InstalledReport {
        models_dir: models_dir.map(|p| p.display().to_string()),
        hf_cache_dir: hub_cache.map(|p| p.display().to_string()),
        cached_bytes: cached.iter().map(|c| c.cache.size_on_disk).sum(),
        installations,
        cached,
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::install::testutil::TempDir;
    use crate::models::hfcache::tests::fake_repo;
    use crate::models::ids;

    /// A models folder with one package link, one assembly (hashed), and a
    /// hub cache holding their files plus an unrelated and a config-matched repo.
    pub struct Fixture {
        pub dir: TempDir,
        pub models: PathBuf,
        pub cache: PathBuf,
    }

    pub fn fixture() -> Fixture {
        let dir = TempDir::new("installed");
        let cache = dir.path().join("hub");
        let models = dir.path().join("models");
        std::fs::create_dir_all(&models).expect("mkdir");

        // A legacy package.
        let pkg_commit = "9d27070b71f7142c6b6025f03ac011d70a73cb48";
        let pkg = fake_repo(
            &dir,
            "incoai/Qwen3.8-27B-Splash",
            pkg_commit,
            &[("target/a.bin", "pa", 300), ("draft/b.bin", "pb", 200)],
        );
        dir.write(
            &format!("{}/snapshots/{pkg_commit}/manifest.json", pkg.display()),
            r#"{"model":"Qwen3.8-27B","artifacts":[{"path":"target/a.bin","size":300},{"path":"draft/b.bin","size":200}]}"#,
        );
        dir.symlink(
            &pkg.join("snapshots").join(pkg_commit),
            "models/incoai/Qwen3.8-27B-Splash",
        );

        // An upstream GGUF assembly with its draft, installed text-only.
        let t_commit = "1111111111111111111111111111111111111111";
        let d_commit = "2222222222222222222222222222222222222222";
        let target = fake_repo(
            &dir,
            "unsloth/Qwen3.8-27B-GGUF",
            t_commit,
            &[("Qwen3.8-27B-UD-Q4_K_M.gguf", "tg", 1000)],
        );
        let draft = fake_repo(
            &dir,
            "incoai/Qwen3.8-27B-DFlash2",
            d_commit,
            &[("model.safetensors", "ds", 100)],
        );
        let t_file = target.join(format!("snapshots/{t_commit}/Qwen3.8-27B-UD-Q4_K_M.gguf"));
        let d_file = draft.join(format!("snapshots/{d_commit}/model.safetensors"));
        let assembly = "models/.resolved/aaaa";
        dir.symlink(
            &t_file,
            &format!("{assembly}/target/Qwen3.8-27B-UD-Q4_K_M.gguf"),
        );
        dir.symlink(&d_file, &format!("{assembly}/draft/model.safetensors"));
        let record = serde_json::json!({
            "version": 1,
            "model": "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M",
            "family": "Qwen3.8-27B",
            "target_format": "gguf",
            "vision_format": "none",
            "metadata": "0".repeat(64),
            "sources": {
                "target": {"repo": "unsloth/Qwen3.8-27B-GGUF", "revision": t_commit},
                "draft": {"repo": "incoai/Qwen3.8-27B-DFlash2", "revision": d_commit}
            },
            "files": {
                "target/Qwen3.8-27B-UD-Q4_K_M.gguf": {"path": t_file.display().to_string(), "bytes": 1000, "mtime_ns": 0, "ctime_ns": 0, "digest": "0".repeat(64)},
                "draft/model.safetensors": {"path": d_file.display().to_string(), "bytes": 100, "mtime_ns": 0, "ctime_ns": 0, "digest": "0".repeat(64)}
            }
        });
        dir.write(&format!("{assembly}/model.json"), &record.to_string());
        let hashed =
            ids::selection_link_rel("unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M", None, true, None)
                .expect("rel");
        dir.symlink(&dir.path().join(assembly), &format!("models/{hashed}"));

        // Unrelated, and an MLX 4-bit checkpoint of a supported family.
        fake_repo(
            &dir,
            "someone/unrelated-model",
            "3333",
            &[("w.bin", "u1", 50)],
        );
        let lm = fake_repo(
            &dir,
            "lmstudio-community/Qwen3.8-27B-MLX-4bit",
            "4444",
            &[("model.safetensors", "l1", 70)],
        );
        dir.write(
            &format!("{}/snapshots/4444/config.json", lm.display()),
            r#"{"quantization":{"group_size":64,"bits":4},"text_config":{"model_type":"qwen3_5_text","hidden_size":5120,"num_hidden_layers":64,"num_attention_heads":24,"num_key_value_heads":4,"head_dim":256,"vocab_size":248320}}"#,
        );
        Fixture { dir, models, cache }
    }

    #[test]
    fn lists_packages_and_hashed_assemblies() {
        let f = fixture();
        let mut sidecar = BTreeMap::new();
        let hashed =
            ids::selection_link_rel("unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M", None, true, None)
                .expect("rel");
        sidecar.insert(
            hashed.clone(),
            SidecarEntry {
                model: "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M".into(),
                options: SelectionOptions {
                    language_only: true,
                    ..Default::default()
                },
                recorded_at_ms: 1,
            },
        );
        let list = list_installations(&f.models, &sidecar, &[]);
        assert_eq!(list.len(), 2, "{list:#?}");

        let package = list
            .iter()
            .find(|i| i.id == "incoai/Qwen3.8-27B-Splash")
            .expect("package");
        assert_eq!(package.kind, InstallationKind::Package);
        assert!(package.complete, "{:?}", package.problems);
        assert_eq!(package.size_on_disk, 500 + package_manifest_len(&f));
        assert_eq!(package.repos, vec!["incoai/Qwen3.8-27B-Splash".to_string()]);
        assert_eq!(package.family.as_deref(), Some("Qwen3.8-27B"));

        let assembly = list.iter().find(|i| i.id == hashed).expect("assembly");
        assert_eq!(assembly.kind, InstallationKind::Assembly);
        assert!(assembly.hashed);
        assert_eq!(
            assembly.model.as_deref(),
            Some("unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M")
        );
        assert!(assembly.options.as_ref().is_some_and(|o| o.language_only));
        assert_eq!(assembly.target_format.as_deref(), Some("gguf"));
        assert!(assembly.complete, "{:?}", assembly.problems);
        assert!(!assembly.in_use);
        assert_eq!(
            assembly.repos,
            vec![
                "incoai/Qwen3.8-27B-DFlash2".to_string(),
                "unsloth/Qwen3.8-27B-GGUF".to_string()
            ]
        );
        assert!(assembly.size_on_disk >= 1100);
    }

    fn package_manifest_len(f: &Fixture) -> u64 {
        std::fs::metadata(f.models.join("incoai/Qwen3.8-27B-Splash/manifest.json"))
            .map(|m| m.len())
            .unwrap_or(0)
    }

    #[test]
    fn reports_missing_files_and_running_servers() {
        let f = fixture();
        std::fs::remove_file(f.cache.join("models--incoai--Qwen3.8-27B-Splash/blobs/pa"))
            .expect("rm");
        let servers = vec![RunningServer {
            pid: 1,
            model: "incoai/Qwen3.8-27B-Splash".into(),
            port: 8000,
            lock_file: String::new(),
        }];
        let list = list_installations(&f.models, &BTreeMap::new(), &servers);
        let package = list
            .iter()
            .find(|i| i.id == "incoai/Qwen3.8-27B-Splash")
            .expect("package");
        assert!(!package.complete);
        assert!(package.in_use);
        assert!(package.problems.iter().any(|p| p.contains("target/a.bin")));
    }

    #[test]
    fn hashed_links_without_sidecar_use_model_json() {
        let f = fixture();
        let list = list_installations(&f.models, &BTreeMap::new(), &[]);
        let assembly = list.iter().find(|i| i.hashed).expect("assembly");
        assert_eq!(
            assembly.model.as_deref(),
            Some("unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M")
        );
        assert!(assembly.options.is_none());
    }

    #[test]
    fn lists_only_supported_cache_repos() {
        let f = fixture();
        let installations = list_installations(&f.models, &BTreeMap::new(), &[]);
        let catalog_repos = vec!["incoai/Qwen3.8-27B-Splash".to_string()];
        let cached = supported_cached(&f.cache, &catalog_repos, &installations);
        let names: Vec<&str> = cached.iter().map(|c| c.cache.repo.as_str()).collect();
        assert!(names.contains(&"incoai/Qwen3.8-27B-Splash"));
        assert!(names.contains(&"unsloth/Qwen3.8-27B-GGUF"));
        assert!(names.contains(&"lmstudio-community/Qwen3.8-27B-MLX-4bit"));
        assert!(!names.contains(&"someone/unrelated-model"));
        let draft = cached
            .iter()
            .find(|c| c.cache.repo == "incoai/Qwen3.8-27B-DFlash2")
            .expect("draft");
        assert_eq!(draft.role, CacheRole::Draft);
        assert_eq!(draft.matched_by, "installation");
        let lm = cached
            .iter()
            .find(|c| c.cache.repo.starts_with("lmstudio"))
            .expect("lm");
        assert_eq!(lm.matched_by, "config");
        assert!(lm.linked_by.is_empty());
    }

    #[test]
    fn config_family_requires_affine_quantization() {
        let base = serde_json::json!({"text_config":{"model_type":"qwen3_5_moe_text","hidden_size":2048,"num_hidden_layers":40,"num_experts":256,"num_experts_per_tok":8,"vocab_size":248320}});
        assert_eq!(
            family_from_config(&base),
            Some(("Qwen3.6-35B-A3B".to_string(), false))
        );
        let mut affine = base.clone();
        affine["quantization"] = serde_json::json!({"bits": 4, "group_size": 64, "mode": "affine"});
        assert_eq!(
            family_from_config(&affine),
            Some(("Qwen3.6-35B-A3B".to_string(), true))
        );
        let mut mx = base;
        mx["quantization"] = serde_json::json!({"bits": 4, "mode": "mxfp4"});
        assert_eq!(family_from_config(&mx).map(|f| f.1), Some(false));
        assert_eq!(
            family_from_config(&serde_json::json!({"model_type": "llama"})),
            None
        );
    }

    #[test]
    fn sidecar_round_trips() {
        let dir = TempDir::new("sidecar");
        let sidecar = Sidecar::new(dir.path().join("a/selections.json"));
        let options = SelectionOptions {
            revision: Some("main".into()),
            ..Default::default()
        };
        sidecar
            .record(".selections/abc", "a/b", &options)
            .expect("record");
        let loaded = sidecar.load();
        assert_eq!(loaded[".selections/abc"].model, "a/b");
        assert_eq!(loaded[".selections/abc"].options, options);
    }
}
