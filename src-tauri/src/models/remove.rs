//! Removing an installation, with a dry run first.
//!
//! "Remove from Splash" deletes the selection link, its assembly (when no
//! other link uses it and no server holds it) and its pins
//! (`refs/splash/<owner>/` in each linked repository). "Also free downloaded
//! files" adds the hub cache folders of repositories no other installation
//! links (the DFlash2 draft is shared per family; the hub cache is shared
//! with other tools, so only linked repositories are ever offered).
//!
//! Every path is checked to lie inside the models folder or the hub cache
//! before anything is deleted; links are removed, never followed. Deletion
//! runs under Splash's `models/.install.lock`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::installed::{self, Installation, InstallationKind};
use super::{hfcache, ids, locks};
use crate::install::brew::RunningServer;
use crate::install::{OpError, OpResult};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum RemoveItemKind {
    SelectionLink,
    Assembly,
    Pins,
    HubRepo,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoveItem {
    pub kind: RemoveItemKind,
    pub path: String,
    /// Bytes this frees (0 for links and pins).
    pub bytes: u64,
    /// The repository, for pins and hub folders.
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeptRepo {
    pub repo: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemovePlan {
    pub id: String,
    pub model: Option<String>,
    pub also_free_downloads: bool,
    pub items: Vec<RemoveItem>,
    pub bytes_freed: u64,
    /// Downloads left in place, and why.
    pub kept: Vec<KeptRepo>,
    /// Set when removal would be refused now (served, or an installation runs).
    pub blocked: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoveResult {
    pub id: String,
    pub removed: Vec<String>,
    pub bytes_freed: u64,
    pub errors: Vec<String>,
}

/// An installation id is `owner/repo[:variant]` or `.selections/<sha256>`.
pub fn validate_id(id: &str) -> OpResult<()> {
    if let Some(hash) = id.strip_prefix(".selections/") {
        if hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(());
        }
        return Err(OpError::InvalidRequest(format!(
            "not an installation: {id}"
        )));
    }
    ids::split_model_id(id)
        .map(|_| ())
        .map_err(OpError::InvalidRequest)
}

/// `path` (not following a final symlink) made absolute through its real
/// parent, if that lies strictly inside one of `roots`.
pub fn ensure_inside(path: &Path, roots: &[PathBuf]) -> OpResult<PathBuf> {
    let refuse = || {
        OpError::InvalidRequest(format!(
            "refusing to delete outside the models and download folders: {}",
            path.display()
        ))
    };
    let parent = path
        .parent()
        .ok_or_else(refuse)?
        .canonicalize()
        .map_err(|_| refuse())?;
    let real = parent.join(path.file_name().ok_or_else(refuse)?);
    let inside = roots
        .iter()
        .filter_map(|r| r.canonicalize().ok())
        .any(|root| real.starts_with(&root) && real != root);
    if inside {
        Ok(real)
    } else {
        Err(refuse())
    }
}

/// The `models--*` folder a hub cache path lies in.
fn repo_folder_of(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|a| {
            a.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("models--"))
        })
        .map(Path::to_path_buf)
}

/// The hub repository folders an installation links into.
fn linked_repo_folders(target: &Path) -> BTreeSet<PathBuf> {
    let mut folders = BTreeSet::new();
    if let Some(folder) = repo_folder_of(target) {
        folders.insert(folder);
    }
    for file in hfcache::walk_files(target) {
        if let Ok(link) = std::fs::read_link(&file) {
            let absolute = if link.is_absolute() {
                link
            } else {
                file.parent().map(|p| p.join(&link)).unwrap_or(link)
            };
            if let Some(folder) = repo_folder_of(&absolute) {
                folders.insert(folder);
            }
        }
    }
    folders
        .into_iter()
        .filter_map(|f| f.canonicalize().ok())
        .collect()
}

fn real_bytes(dir: &Path) -> u64 {
    hfcache::walk_files(dir)
        .iter()
        .filter_map(|f| std::fs::symlink_metadata(f).ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

pub fn plan(
    models_dir: &Path,
    hub_cache: Option<&Path>,
    id: &str,
    also_free_downloads: bool,
    servers: &[RunningServer],
) -> OpResult<RemovePlan> {
    validate_id(id)?;
    let link = models_dir.join(id);
    let is_link = std::fs::symlink_metadata(&link).is_ok_and(|m| m.file_type().is_symlink());
    if !is_link {
        return Err(OpError::NotFound(format!("{id} is not installed")));
    }
    let mut roots = vec![models_dir.to_path_buf()];
    roots.extend(hub_cache.map(Path::to_path_buf));
    let link_real = ensure_inside(&link, &roots)?;

    let all = installed::list_installations(models_dir, &BTreeMap::new(), servers);
    let this: Installation =
        installed::read_installation(models_dir, &link, &BTreeMap::new(), servers);
    let others: Vec<&Installation> = all.iter().filter(|i| i.id != this.id).collect();

    let mut items = vec![RemoveItem {
        kind: RemoveItemKind::SelectionLink,
        path: link_real.display().to_string(),
        bytes: 0,
        repo: None,
    }];
    let mut kept = Vec::new();
    let blocked = this.in_use.then(|| {
        format!(
            "{} is being served; stop the server first",
            this.model.as_deref().unwrap_or(id)
        )
    });

    let target = link.canonicalize().ok();
    if let (InstallationKind::Assembly, Some(target)) = (this.kind, target.as_ref()) {
        let resolved = models_dir.join(".resolved").canonicalize().ok();
        let shared = others
            .iter()
            .any(|o| o.target_path.as_deref() == Some(&*target.display().to_string()));
        if resolved.is_some_and(|r| target.starts_with(&r))
            && !shared
            && !locks::is_held(&target.join("model.json"))
        {
            items.push(RemoveItem {
                kind: RemoveItemKind::Assembly,
                path: target.display().to_string(),
                bytes: real_bytes(target),
                repo: None,
            });
        }
    }

    let folders = target
        .as_deref()
        .map(linked_repo_folders)
        .unwrap_or_default();
    let owner = ids::pin_owner(&link);
    for folder in &folders {
        let repo = folder
            .file_name()
            .and_then(|n| ids::repo_from_cache_folder(&n.to_string_lossy()));
        if let Some(owner) = &owner {
            let pins = folder.join("refs/splash").join(owner);
            if pins.is_dir() {
                items.push(RemoveItem {
                    kind: RemoveItemKind::Pins,
                    path: pins.display().to_string(),
                    bytes: 0,
                    repo: repo.clone(),
                });
            }
        }
        if !also_free_downloads {
            continue;
        }
        let Some(repo) = repo else { continue };
        let users: Vec<&str> = others
            .iter()
            .filter(|o| o.repos.contains(&repo))
            .map(|o| o.id.as_str())
            .collect();
        if !users.is_empty() {
            kept.push(KeptRepo {
                reason: format!("also used by {}", users.join(", ")),
                repo,
            });
            continue;
        }
        if ensure_inside(folder, &roots).is_err() {
            kept.push(KeptRepo {
                repo,
                reason: format!("outside the current download folder ({})", folder.display()),
            });
            continue;
        }
        items.push(RemoveItem {
            kind: RemoveItemKind::HubRepo,
            path: folder.display().to_string(),
            bytes: hfcache::scan_blobs(&folder.join("blobs")).total_bytes,
            repo: Some(repo),
        });
    }

    Ok(RemovePlan {
        id: id.to_string(),
        model: this.model.clone(),
        also_free_downloads,
        bytes_freed: items.iter().map(|i| i.bytes).sum(),
        items,
        kept,
        blocked,
    })
}

fn delete(item: &RemoveItem, roots: &[PathBuf]) -> OpResult<()> {
    let path = ensure_inside(Path::new(&item.path), roots)?;
    let meta = std::fs::symlink_metadata(&path)?;
    match item.kind {
        RemoveItemKind::SelectionLink => {
            if !meta.file_type().is_symlink() {
                return Err(OpError::InvalidRequest(format!(
                    "{} is not a link",
                    path.display()
                )));
            }
            std::fs::remove_file(&path)?;
        }
        _ => {
            if meta.file_type().is_symlink() || !meta.is_dir() {
                return Err(OpError::InvalidRequest(format!(
                    "{} is not a folder",
                    path.display()
                )));
            }
            // remove_dir_all removes links inside without following them.
            std::fs::remove_dir_all(&path)?;
        }
    }
    Ok(())
}

/// Plans again under the installation lock, then deletes.
pub fn execute(
    models_dir: &Path,
    hub_cache: Option<&Path>,
    id: &str,
    also_free_downloads: bool,
    servers: &[RunningServer],
) -> OpResult<RemoveResult> {
    let _lock = locks::try_install_lock(models_dir)?;
    let plan = plan(models_dir, hub_cache, id, also_free_downloads, servers)?;
    if let Some(reason) = plan.blocked {
        return Err(OpError::InUse(reason));
    }
    let mut roots = vec![models_dir.to_path_buf()];
    roots.extend(hub_cache.map(Path::to_path_buf));
    let mut removed = Vec::new();
    let mut errors = Vec::new();
    let mut bytes_freed = 0;
    for item in &plan.items {
        match delete(item, &roots) {
            Ok(()) => {
                removed.push(item.path.clone());
                bytes_freed += item.bytes;
            }
            Err(error) => {
                errors.push(format!("{}: {error}", item.path));
                // Without the link removed, nothing else may go.
                if item.kind == RemoveItemKind::SelectionLink {
                    break;
                }
            }
        }
    }
    Ok(RemoveResult {
        id: id.to_string(),
        removed,
        bytes_freed,
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::installed::tests::fixture;
    use nix::fcntl::{Flock, FlockArg};

    fn package_pins(f: &crate::models::installed::tests::Fixture) -> PathBuf {
        let link = f.models.join("incoai/Qwen3.8-27B-Splash");
        let owner = ids::pin_owner(&link).expect("owner");
        let pins = f
            .cache
            .join("models--incoai--Qwen3.8-27B-Splash/refs/splash")
            .join(owner);
        std::fs::create_dir_all(&pins).expect("mkdir");
        std::fs::write(
            pins.join("9d27070b71f7142c6b6025f03ac011d70a73cb48"),
            "9d27070b71f7142c6b6025f03ac011d70a73cb48",
        )
        .expect("write");
        pins
    }

    #[test]
    fn validates_ids() {
        assert!(validate_id("incoai/Qwen3.8-27B-Splash").is_ok());
        assert!(validate_id(&format!(".selections/{}", "a".repeat(64))).is_ok());
        assert!(validate_id(".selections/../../etc").is_err());
        assert!(validate_id("../x").is_err());
        assert!(validate_id(".resolved/abc").is_err());
    }

    #[test]
    fn dry_run_lists_link_and_pins_only_by_default() {
        let f = fixture();
        let pins = package_pins(&f);
        let p = plan(
            &f.models,
            Some(&f.cache),
            "incoai/Qwen3.8-27B-Splash",
            false,
            &[],
        )
        .expect("plan");
        let kinds: Vec<RemoveItemKind> = p.items.iter().map(|i| i.kind).collect();
        assert_eq!(
            kinds,
            vec![RemoveItemKind::SelectionLink, RemoveItemKind::Pins]
        );
        assert_eq!(
            p.items[1].path,
            pins.canonicalize().expect("canon").display().to_string()
        );
        assert_eq!(p.bytes_freed, 0);
        assert!(p.blocked.is_none());
        // A dry run deletes nothing.
        assert!(f.models.join("incoai/Qwen3.8-27B-Splash").exists());
    }

    #[test]
    fn frees_downloads_no_other_installation_uses() {
        let f = fixture();
        let hashed =
            ids::selection_link_rel("unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M", None, true, None)
                .expect("rel");
        let p = plan(&f.models, Some(&f.cache), &hashed, true, &[]).expect("plan");
        let kinds: Vec<RemoveItemKind> = p.items.iter().map(|i| i.kind).collect();
        assert!(kinds.contains(&RemoveItemKind::Assembly));
        let repos: Vec<&str> = p
            .items
            .iter()
            .filter(|i| i.kind == RemoveItemKind::HubRepo)
            .filter_map(|i| i.repo.as_deref())
            .collect();
        assert_eq!(
            repos,
            vec!["incoai/Qwen3.8-27B-DFlash2", "unsloth/Qwen3.8-27B-GGUF"]
        );
        assert_eq!(
            p.bytes_freed,
            1100 + p
                .items
                .iter()
                .find(|i| i.kind == RemoveItemKind::Assembly)
                .map(|i| i.bytes)
                .unwrap_or(0)
        );

        let result = execute(&f.models, Some(&f.cache), &hashed, true, &[]).expect("execute");
        assert!(result.errors.is_empty(), "{:?}", result.errors);
        assert!(!f.models.join(&hashed).exists());
        assert!(!f.models.join(".resolved/aaaa").exists());
        assert!(!f.cache.join("models--unsloth--Qwen3.8-27B-GGUF").exists());
        // Untouched: the other installation and unrelated downloads.
        assert!(f.models.join("incoai/Qwen3.8-27B-Splash").exists());
        assert!(f.cache.join("models--someone--unrelated-model").exists());
    }

    #[test]
    fn keeps_repos_another_installation_links() {
        let f = fixture();
        // A second installation of the same model (plain link) to the same assembly.
        f.dir.symlink(
            &f.models.join(".resolved/aaaa"),
            "models/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M",
        );
        let hashed =
            ids::selection_link_rel("unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M", None, true, None)
                .expect("rel");
        let p = plan(&f.models, Some(&f.cache), &hashed, true, &[]).expect("plan");
        assert!(
            !p.items.iter().any(|i| i.kind == RemoveItemKind::Assembly),
            "the assembly is shared"
        );
        assert!(!p.items.iter().any(|i| i.kind == RemoveItemKind::HubRepo));
        assert_eq!(p.kept.len(), 2);
        assert!(p.kept[0]
            .reason
            .contains("unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M"));
    }

    #[test]
    fn refuses_while_served() {
        let f = fixture();
        let hashed =
            ids::selection_link_rel("unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M", None, true, None)
                .expect("rel");
        let record = std::fs::File::open(f.models.join(".resolved/aaaa/model.json")).expect("open");
        let held = Flock::lock(record, FlockArg::LockSharedNonblock).expect("lock");
        let p = plan(&f.models, Some(&f.cache), &hashed, false, &[]).expect("plan");
        assert!(p.blocked.is_some());
        assert!(matches!(
            execute(&f.models, Some(&f.cache), &hashed, false, &[]),
            Err(OpError::InUse(_))
        ));
        drop(held);
        let servers = vec![RunningServer {
            pid: 1,
            model: "incoai/Qwen3.8-27B-Splash".into(),
            port: 1,
            lock_file: String::new(),
        }];
        let p = plan(
            &f.models,
            Some(&f.cache),
            "incoai/Qwen3.8-27B-Splash",
            false,
            &servers,
        )
        .expect("plan");
        assert!(p.blocked.is_some());
    }

    #[test]
    fn refuses_while_an_installation_runs() {
        let f = fixture();
        let _lock = locks::try_install_lock(&f.models).expect("lock");
        assert!(matches!(
            execute(
                &f.models,
                Some(&f.cache),
                "incoai/Qwen3.8-27B-Splash",
                false,
                &[]
            ),
            Err(OpError::Busy(_))
        ));
    }

    #[test]
    fn never_deletes_outside_the_roots() {
        let f = fixture();
        let outside = f.dir.path().join("outside");
        std::fs::create_dir_all(&outside).expect("mkdir");
        // A link inside the models folder whose target escapes it.
        let escape = f.dir.symlink(&outside, "models/escape");
        let roots = vec![f.models.clone(), f.cache.clone()];
        // The link itself is inside (removing it is fine) ...
        assert!(ensure_inside(&escape, &roots).is_ok());
        // ... but a path through it is not.
        assert!(ensure_inside(&escape.join("x"), &roots).is_err());
        assert!(ensure_inside(&outside, &roots).is_err());
        assert!(
            ensure_inside(&f.models, &roots).is_err(),
            "never the root itself"
        );
        let item = RemoveItem {
            kind: RemoveItemKind::HubRepo,
            path: outside.display().to_string(),
            bytes: 0,
            repo: None,
        };
        assert!(delete(&item, &roots).is_err());
        assert!(outside.exists());
        assert!(matches!(
            plan(&f.models, Some(&f.cache), "x/missing", false, &[]),
            Err(OpError::NotFound(_))
        ));
    }
}
