//! Reading the Hugging Face hub cache (`models--owner--repo/{blobs,snapshots,refs}`)
//! without huggingface_hub: sizes on disk, partial downloads, snapshots, and
//! the `trees/<commit>.json` listings huggingface_hub 1.x keeps (an offline
//! source of file sizes).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use super::ids;

/// `$HF_HOME`, else `$XDG_CACHE_HOME/huggingface`, else `~/.cache/huggingface`.
pub fn hf_home() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("HF_HOME").filter(|v| !v.is_empty()) {
        return Some(expand_home(Path::new(&home)));
    }
    if let Some(xdg) = std::env::var_os("XDG_CACHE_HOME").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(xdg).join("huggingface"));
    }
    dirs::home_dir().map(|h| h.join(".cache/huggingface"))
}

pub fn expand_home(path: &Path) -> PathBuf {
    match (path.strip_prefix("~"), dirs::home_dir()) {
        (Ok(rest), Some(home)) => home.join(rest),
        _ => path.to_path_buf(),
    }
}

/// The hub cache: an explicit folder (Settings > Storage), else
/// `$HF_HUB_CACHE`, else `$HF_HOME/hub`.
pub fn hub_cache(override_dir: Option<&str>) -> Option<PathBuf> {
    if let Some(dir) = override_dir.map(str::trim).filter(|d| !d.is_empty()) {
        return Some(expand_home(Path::new(dir)));
    }
    for key in ["HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE"] {
        if let Some(dir) = std::env::var_os(key).filter(|v| !v.is_empty()) {
            return Some(expand_home(Path::new(&dir)));
        }
    }
    hf_home().map(|h| h.join("hub"))
}

pub fn repo_dir(cache: &Path, repo: &str) -> PathBuf {
    cache.join(ids::cache_folder_name(repo))
}

/// The blob a partial download belongs to: `<blob>.<suffix>.incomplete` or
/// `<blob>.incomplete` -> `<blob>`.
pub fn incomplete_blob_id(name: &str) -> Option<&str> {
    let stem = name.strip_suffix(".incomplete")?;
    stem.split('.').next().filter(|s| !s.is_empty())
}

/// What a repository's `blobs/` holds.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Blobs {
    /// Finished blobs: id -> bytes.
    pub complete: HashMap<String, u64>,
    /// Partial downloads: blob id -> bytes of its largest `.incomplete` file.
    pub partial: HashMap<String, u64>,
    pub partial_files: u32,
    /// Every byte in the folder, including every partial file.
    pub total_bytes: u64,
}

impl Blobs {
    pub fn partial_bytes(&self) -> u64 {
        self.partial.values().sum()
    }
}

pub fn scan_blobs(blobs_dir: &Path) -> Blobs {
    let mut out = Blobs::default();
    let Ok(entries) = std::fs::read_dir(blobs_dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let len = meta.len();
        out.total_bytes += len;
        if let Some(blob) = incomplete_blob_id(&name) {
            out.partial_files += 1;
            let slot = out.partial.entry(blob.to_string()).or_insert(0);
            *slot = (*slot).max(len);
        } else {
            out.complete.insert(name, len);
        }
    }
    out
}

/// Every file under `dir`, recursively: regular files and symlinks (to files
/// or dangling). Symlinked directories are not descended into.
pub fn walk_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                stack.push(path);
            } else {
                out.push(path);
            }
        }
    }
    out.sort();
    out
}

/// Bytes of the distinct files `paths` resolve to, the number of files, and
/// how many do not resolve (dangling links).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Usage {
    pub bytes: u64,
    pub files: u32,
    pub dangling: u32,
}

pub fn usage<'a>(paths: impl IntoIterator<Item = &'a PathBuf>) -> Usage {
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut usage = Usage::default();
    for path in paths {
        usage.files += 1;
        match path.canonicalize() {
            Ok(real) => {
                if seen.insert(real.clone()) {
                    usage.bytes += std::fs::metadata(&real).map(|m| m.len()).unwrap_or(0);
                }
            }
            Err(_) => usage.dangling += 1,
        }
    }
    usage
}

pub fn modified_ms(path: &Path) -> Option<u64> {
    let modified = std::fs::symlink_metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CachedSnapshot {
    pub commit: String,
    /// Branch or tag names (refs/<name>) pointing at this commit.
    pub refs: Vec<String>,
    pub files: u32,
    pub bytes: u64,
    /// Links whose blob is gone.
    pub dangling: u32,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CachedRepo {
    pub repo: String,
    pub path: String,
    /// Everything in blobs/, partial downloads included.
    pub size_on_disk: u64,
    pub incomplete_bytes: u64,
    pub incomplete_files: u32,
    pub snapshots: Vec<CachedSnapshot>,
    /// Splash installations pinning a snapshot (refs/splash/<owner>/).
    pub splash_pins: u32,
    /// Every snapshot link resolves. Leftover `.incomplete` files (hf-xet
    /// leaves empty ones behind after a successful download) are reported in
    /// `incomplete_*` but do not make a repository incomplete.
    pub complete: bool,
}

fn read_refs(refs_dir: &Path) -> HashMap<String, Vec<String>> {
    let mut by_commit: HashMap<String, Vec<String>> = HashMap::new();
    let Ok(entries) = std::fs::read_dir(refs_dir) else {
        return by_commit;
    };
    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        if let Ok(commit) = std::fs::read_to_string(entry.path()) {
            by_commit
                .entry(commit.trim().to_string())
                .or_default()
                .push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    by_commit
}

fn count_pins(refs_dir: &Path) -> u32 {
    let Ok(owners) = std::fs::read_dir(refs_dir.join("splash")) else {
        return 0;
    };
    owners
        .flatten()
        .filter(|o| o.file_type().is_ok_and(|t| t.is_dir()))
        .map(|o| {
            std::fs::read_dir(o.path())
                .map(|e| e.count() as u32)
                .unwrap_or(0)
        })
        .sum()
}

pub fn scan_repo(cache: &Path, repo: &str) -> Option<CachedRepo> {
    let dir = repo_dir(cache, repo);
    if !dir.is_dir() {
        return None;
    }
    let blobs = scan_blobs(&dir.join("blobs"));
    let refs = read_refs(&dir.join("refs"));
    let mut snapshots = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir.join("snapshots")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let commit = entry.file_name().to_string_lossy().into_owned();
            let files = walk_files(&path);
            let usage = usage(&files);
            snapshots.push(CachedSnapshot {
                refs: refs.get(&commit).cloned().unwrap_or_default(),
                commit,
                files: usage.files,
                bytes: usage.bytes,
                dangling: usage.dangling,
                modified_ms: modified_ms(&path),
            });
        }
    }
    snapshots.sort_by_key(|s| std::cmp::Reverse(s.modified_ms));
    let complete = snapshots.iter().all(|s| s.dangling == 0);
    Some(CachedRepo {
        repo: repo.to_string(),
        path: dir.display().to_string(),
        size_on_disk: blobs.total_bytes,
        incomplete_bytes: blobs.partial_bytes(),
        incomplete_files: blobs.partial_files,
        snapshots,
        splash_pins: count_pins(&dir.join("refs")),
        complete,
    })
}

/// Every model repository in the cache.
pub fn list_cached_repos(cache: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(cache) else {
        return Vec::new();
    };
    let mut repos: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| ids::repo_from_cache_folder(&e.file_name().to_string_lossy()))
        .collect();
    repos.sort_by_key(|r| r.to_lowercase());
    repos
}

/// The repository a path inside the hub cache belongs to
/// (`.../models--owner--repo/snapshots/<commit>/...`).
pub fn repo_of_path(path: &Path) -> Option<(String, String)> {
    for dir in path.ancestors() {
        if dir
            .parent()
            .and_then(Path::file_name)
            .is_some_and(|n| n == "snapshots")
        {
            let commit = dir.file_name()?.to_string_lossy().into_owned();
            let repo_dir = dir.parent()?.parent()?;
            let repo = ids::repo_from_cache_folder(&repo_dir.file_name()?.to_string_lossy())?;
            return Some((repo, commit));
        }
    }
    None
}

/// A file listing from `trees/<commit>.json` (huggingface_hub 1.x).
#[derive(Debug, Clone, PartialEq)]
pub struct TreeListing {
    pub commit: String,
    pub files: Vec<(String, u64)>,
}

#[derive(Deserialize)]
struct TreeJson {
    format_version: u32,
    files: HashMap<String, TreeEntry>,
}

#[derive(Deserialize)]
struct TreeEntry {
    size: u64,
}

pub fn parse_tree(commit: &str, json: &str) -> Option<TreeListing> {
    let tree: TreeJson = serde_json::from_str(json).ok()?;
    if tree.format_version != 1 {
        return None;
    }
    let mut files: Vec<(String, u64)> = tree.files.into_iter().map(|(k, v)| (k, v.size)).collect();
    files.sort();
    Some(TreeListing {
        commit: commit.to_string(),
        files,
    })
}

/// The newest tree listing cached for `repo`, if any.
pub fn tree_listing(cache: &Path, repo: &str) -> Option<TreeListing> {
    let trees = repo_dir(cache, repo).join("trees");
    let mut newest: Option<(u64, PathBuf)> = None;
    for entry in std::fs::read_dir(trees).ok()?.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "json") {
            let modified = modified_ms(&path).unwrap_or(0);
            if newest.as_ref().is_none_or(|(m, _)| modified > *m) {
                newest = Some((modified, path));
            }
        }
    }
    let (_, path) = newest?;
    let commit = path.file_stem()?.to_string_lossy().into_owned();
    parse_tree(&commit, &std::fs::read_to_string(path).ok()?)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::install::testutil::TempDir;

    /// A fake hub cache entry: blobs plus snapshot links.
    pub fn fake_repo(
        dir: &TempDir,
        repo: &str,
        commit: &str,
        files: &[(&str, &str, usize)],
    ) -> PathBuf {
        let root = format!("hub/{}", ids::cache_folder_name(repo));
        for (name, blob, len) in files {
            let blob_path = dir.file(&format!("{root}/blobs/{blob}"), *len);
            dir.symlink(&blob_path, &format!("{root}/snapshots/{commit}/{name}"));
        }
        dir.write(&format!("{root}/refs/main"), commit);
        dir.path().join(root)
    }

    #[test]
    fn partial_blob_ids() {
        assert_eq!(incomplete_blob_id("abc.6e30d30a.incomplete"), Some("abc"));
        assert_eq!(incomplete_blob_id("abc.incomplete"), Some("abc"));
        assert_eq!(incomplete_blob_id("abc"), None);
    }

    #[test]
    fn scans_blobs_and_dedupes_partials() {
        let dir = TempDir::new("blobs");
        dir.file("blobs/aaa", 100);
        dir.file("blobs/bbb.1111.incomplete", 30);
        dir.file("blobs/bbb.2222.incomplete", 50);
        dir.file("blobs/ccc.incomplete", 0);
        let blobs = scan_blobs(&dir.path().join("blobs"));
        assert_eq!(blobs.complete.get("aaa"), Some(&100));
        assert_eq!(blobs.partial.get("bbb"), Some(&50));
        assert_eq!(blobs.partial_bytes(), 50);
        assert_eq!(blobs.partial_files, 3);
        assert_eq!(blobs.total_bytes, 180);
    }

    #[test]
    fn scans_a_repo() {
        let dir = TempDir::new("repo");
        let commit = "9d27070b71f7142c6b6025f03ac011d70a73cb48";
        let repo_path = fake_repo(
            &dir,
            "incoai/Qwen3.8-27B-Splash",
            commit,
            &[
                ("config.json", "c1", 10),
                ("target/a.bin", "b1", 1000),
                ("target/b.bin", "b1", 1000),
            ],
        );
        dir.write(
            &format!("{}/refs/splash/owner1/{commit}", repo_path.display()),
            commit,
        );
        let cache = dir.path().join("hub");
        assert_eq!(
            list_cached_repos(&cache),
            vec!["incoai/Qwen3.8-27B-Splash".to_string()]
        );
        let repo = scan_repo(&cache, "incoai/Qwen3.8-27B-Splash").expect("repo");
        assert_eq!(repo.size_on_disk, 1010);
        assert!(repo.complete);
        assert_eq!(repo.splash_pins, 1);
        assert_eq!(repo.snapshots.len(), 1);
        assert_eq!(repo.snapshots[0].refs, vec!["main".to_string()]);
        assert_eq!(repo.snapshots[0].files, 3);
        assert_eq!(repo.snapshots[0].bytes, 1010, "the shared blob counts once");

        dir.file(&format!("{}/blobs/zz.1.incomplete", repo_path.display()), 5);
        let repo = scan_repo(&cache, "incoai/Qwen3.8-27B-Splash").expect("repo");
        assert!(
            repo.complete,
            "a leftover partial alone is not a missing file"
        );
        assert_eq!(repo.incomplete_files, 1);
        std::fs::remove_file(repo_path.join("blobs/c1")).expect("rm");
        let repo = scan_repo(&cache, "incoai/Qwen3.8-27B-Splash").expect("repo");
        assert!(!repo.complete);
        assert_eq!(repo.incomplete_bytes, 5);
        assert_eq!(repo.snapshots[0].dangling, 1);
        assert!(scan_repo(&cache, "x/y").is_none());
    }

    #[test]
    fn finds_the_repo_of_a_snapshot_path() {
        let path =
            Path::new("/c/hub/models--incoai--Qwen3.8-27B-DFlash2/snapshots/abc/model.safetensors");
        assert_eq!(
            repo_of_path(path),
            Some(("incoai/Qwen3.8-27B-DFlash2".to_string(), "abc".to_string()))
        );
        assert_eq!(repo_of_path(Path::new("/tmp/x/y")), None);
    }

    #[test]
    fn reads_tree_listings() {
        let dir = TempDir::new("trees");
        let root = format!("hub/{}", ids::cache_folder_name("a/b"));
        dir.write(
            &format!("{root}/trees/abc.json"),
            r#"{"format_version":1,"files":{"x.bin":{"size":5,"blob_id":"1"},"c.json":{"size":2,"blob_id":"2"}}}"#,
        );
        let listing = tree_listing(&dir.path().join("hub"), "a/b").expect("listing");
        assert_eq!(listing.commit, "abc");
        assert_eq!(
            listing.files,
            vec![("c.json".to_string(), 2), ("x.bin".to_string(), 5)]
        );
        assert!(parse_tree("abc", r#"{"format_version":2,"files":{}}"#).is_none());
    }

    #[test]
    fn hub_cache_prefers_the_override() {
        assert_eq!(
            hub_cache(Some("/Volumes/M/hf")),
            Some(PathBuf::from("/Volumes/M/hf"))
        );
        assert!(hub_cache(None).is_some());
    }
}
