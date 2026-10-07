//! The model catalog: Splash's official list (bundled + cached), its
//! suggested list, and the upstream models the Splash README documents,
//! with download sizes from the Hugging Face API.
//!
//! Sizes are cached in Splashboard's cache folder and, offline, fall back to
//! the `trees/<commit>.json` listings in the hub cache and finally to the
//! sizes the docs state. Nothing here blocks on the network unless asked to
//! refresh.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{hfcache, ids};
use crate::install::{now_ms, OpError, OpResult};

pub const DEFAULT_ENDPOINT: &str = "https://huggingface.co";
/// A cached size older than this is refreshed when the UI asks.
pub const INFO_MAX_AGE_MS: u64 = 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModelFormat {
    /// A legacy Splash package (incoai/*-Splash).
    Package,
    /// MLX affine-quantized safetensors.
    Mlx,
    Gguf,
    /// A DFlash2 draft: installed with a target, never served alone.
    Draft,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CatalogSource {
    /// install/completions/official-models.txt in the installed Splash.
    Official,
    /// install/completions/suggested-models.txt.
    Suggested,
    /// ~/Library/Application Support/Splash/catalog/official-models.txt.
    CachedCatalog,
    /// Documented in Splash's README / performance notes.
    Upstream,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SizeSource {
    Hub,
    /// trees/<commit>.json in the hub cache.
    LocalTree,
    /// Stated in Splash's docs.
    Docs,
}

struct Known {
    id: &'static str,
    family: &'static str,
    format: ModelFormat,
    label: &'static str,
    description: &'static str,
    min_ram_gb: Option<u32>,
    recommended: bool,
    docs_size: Option<u64>,
}

/// Models Splash's README and docs/performance.md name, beyond the bundled
/// lists. Draft repos are listed so their disk use is attributed.
const KNOWN: &[Known] = &[
    Known {
        id: "incoai/Qwen3.8-27B-Splash",
        family: "Qwen3.8-27B",
        format: ModelFormat::Package,
        label: "Qwen3.8 27B (Splash package)",
        description: "Inco's packaged Qwen3.8-27B.",
        min_ram_gb: Some(36),
        recommended: false,
        docs_size: None,
    },
    Known {
        id: "incoai/Qwen3.6-35B-A3B-Splash",
        family: "Qwen3.6-35B-A3B",
        format: ModelFormat::Package,
        label: "Qwen3.6 35B-A3B (Splash package)",
        description: "Inco's packaged Qwen3.6-35B-A3B.",
        min_ram_gb: Some(36),
        recommended: false,
        docs_size: None,
    },
    Known {
        id: "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M",
        family: "Qwen3.8-27B",
        format: ModelFormat::Gguf,
        label: "Qwen3.8 27B · GGUF UD-Q4_K_M",
        description: "The README's quick-start model.",
        min_ram_gb: Some(36),
        recommended: true,
        docs_size: None,
    },
    Known {
        id: "unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M",
        family: "Qwen3.6-35B-A3B",
        format: ModelFormat::Gguf,
        label: "Qwen3.6 35B-A3B · GGUF UD-Q4_K_M",
        description: "Mixture of experts: fast decode.",
        min_ram_gb: Some(36),
        recommended: true,
        docs_size: None,
    },
    Known {
        id: "mlx-community/Qwen3.8-27B-4bit",
        family: "Qwen3.8-27B",
        format: ModelFormat::Mlx,
        label: "Qwen3.8 27B · MLX 4-bit",
        description: "MLX affine 4-bit.",
        min_ram_gb: Some(36),
        recommended: false,
        docs_size: None,
    },
    Known {
        id: "mlx-community/Qwen3.6-35B-A3B-4bit",
        family: "Qwen3.6-35B-A3B",
        format: ModelFormat::Mlx,
        label: "Qwen3.6 35B-A3B · MLX 4-bit",
        description: "MLX affine 4-bit.",
        min_ram_gb: Some(36),
        recommended: false,
        docs_size: None,
    },
    Known {
        id: "unsloth/Qwen3.8-27B-GGUF:UD-IQ3_XXS",
        family: "Qwen3.8-27B",
        format: ModelFormat::Gguf,
        label: "Qwen3.8 27B · GGUF UD-IQ3_XXS",
        description: "For 24 GB Macs (about 73K tokens of context; ~100K with text only).",
        min_ram_gb: Some(24),
        recommended: false,
        docs_size: None,
    },
    Known {
        id: "unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q2_K_XL",
        family: "Qwen3.6-35B-A3B",
        format: ModelFormat::Gguf,
        label: "Qwen3.6 35B-A3B · GGUF UD-Q2_K_XL",
        description: "For 24 GB Macs (256K context).",
        min_ram_gb: Some(24),
        recommended: false,
        docs_size: None,
    },
    Known {
        id: "prism-ml/Ternary-Bonsai-2-27B-gguf:PQ2_0",
        family: "Bonsai",
        format: ModelFormat::Gguf,
        label: "Ternary Bonsai 2 27B · PQ2_0",
        description: "Prism ML's ternary model, 7.2 GB including vision. Smallest with vision.",
        min_ram_gb: Some(24),
        recommended: false,
        docs_size: Some(7_200_000_000),
    },
    Known {
        id: "incoai/Qwen3.8-27B-DFlash2",
        family: "Qwen3.8-27B",
        format: ModelFormat::Draft,
        label: "Qwen3.8 27B DFlash2 draft",
        description: "Speculative draft, installed automatically with a Qwen3.8-27B target.",
        min_ram_gb: None,
        recommended: false,
        docs_size: None,
    },
    Known {
        id: "incoai/Qwen3.6-35B-A3B-DFlash2",
        family: "Qwen3.6-35B-A3B",
        format: ModelFormat::Draft,
        label: "Qwen3.6 35B-A3B DFlash2 draft",
        description: "Speculative draft, installed automatically with a Qwen3.6-35B-A3B target.",
        min_ram_gb: None,
        recommended: false,
        docs_size: None,
    },
];

/// GGUF variants Splash refuses (README: "UD-Q8_K_XL and BF16 targets are not supported").
pub fn unsupported_variant_reason(variant: &str) -> Option<&'static str> {
    let upper = variant.to_ascii_uppercase();
    if upper == "UD-Q8_K_XL" {
        Some("UD-Q8_K_XL targets are not supported by Splash")
    } else if upper.contains("BF16") {
        Some("BF16 targets are not supported by Splash")
    } else if upper.contains("IMATRIX") {
        Some("an importance matrix, not a model")
    } else {
        None
    }
}

pub fn infer_family(repo: &str) -> Option<String> {
    let lower = repo.to_ascii_lowercase();
    if lower.contains("qwen3.8-27b") {
        Some("Qwen3.8-27B".into())
    } else if lower.contains("qwen3.6-35b-a3b") {
        Some("Qwen3.6-35B-A3B".into())
    } else if lower.contains("bonsai") {
        Some("Bonsai".into())
    } else {
        None
    }
}

pub fn infer_format(repo: &str, variant: Option<&str>) -> ModelFormat {
    let lower = repo.to_ascii_lowercase();
    if lower.contains("dflash") {
        ModelFormat::Draft
    } else if variant.is_some() || lower.contains("gguf") {
        ModelFormat::Gguf
    } else if lower.starts_with("incoai/") && lower.ends_with("-splash") {
        ModelFormat::Package
    } else {
        ModelFormat::Mlx
    }
}

// --- Hub repository info --------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoFile {
    pub name: String,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub repo: String,
    /// The commit the listing describes.
    pub sha: Option<String>,
    pub files: Vec<RepoFile>,
    pub gated: bool,
    pub private: bool,
    pub fetched_at_ms: u64,
    pub source: SizeSource,
}

#[derive(Deserialize)]
struct HubModelInfo {
    sha: Option<String>,
    #[serde(default)]
    private: bool,
    #[serde(default)]
    gated: serde_json::Value,
    #[serde(default)]
    siblings: Vec<HubSibling>,
}

#[derive(Deserialize)]
struct HubSibling {
    rfilename: String,
    size: Option<u64>,
}

/// `GET /api/models/<repo>?blobs=true`
pub fn parse_model_info(repo: &str, json: &str, now: u64) -> Result<RepoInfo, String> {
    let info: HubModelInfo = serde_json::from_str(json)
        .map_err(|e| format!("unexpected Hugging Face response for {repo}: {e}"))?;
    Ok(RepoInfo {
        repo: repo.to_string(),
        sha: info.sha,
        files: info
            .siblings
            .into_iter()
            .map(|s| RepoFile {
                name: s.rfilename,
                size: s.size,
            })
            .collect(),
        // `false`, or "auto"/"manual" for gated repositories.
        gated: !matches!(
            info.gated,
            serde_json::Value::Bool(false) | serde_json::Value::Null
        ),
        private: info.private,
        fetched_at_ms: now,
        source: SizeSource::Hub,
    })
}

pub fn endpoint() -> String {
    std::env::var("HF_ENDPOINT")
        .ok()
        .map(|e| e.trim_end_matches('/').to_string())
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| DEFAULT_ENDPOINT.to_string())
}

pub async fn fetch_repo_info(
    client: &reqwest::Client,
    endpoint: &str,
    repo: &str,
    token: Option<&super::token::Secret>,
) -> OpResult<RepoInfo> {
    ids::validate_repo_id(repo).map_err(OpError::InvalidRequest)?;
    let mut request = client.get(format!("{endpoint}/api/models/{repo}?blobs=true"));
    if let Some(token) = token {
        request = request.bearer_auth(token.expose());
    }
    let response = request.send().await?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(OpError::NotFound(format!(
            "{repo} was not found on Hugging Face"
        )));
    }
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(OpError::Failed(format!(
            "{repo} is private or gated; save a Hugging Face token with access to it"
        )));
    }
    if !status.is_success() {
        return Err(OpError::Failed(format!(
            "Hugging Face answered {status} for {repo}"
        )));
    }
    let text = response.text().await?;
    parse_model_info(repo, &text, now_ms()).map_err(OpError::Failed)
}

/// RepoInfo from a hub cache tree listing (offline).
pub fn info_from_tree(repo: &str, listing: &hfcache::TreeListing, fetched_at_ms: u64) -> RepoInfo {
    RepoInfo {
        repo: repo.to_string(),
        sha: Some(listing.commit.clone()),
        files: listing
            .files
            .iter()
            .map(|(name, size)| RepoFile {
                name: name.clone(),
                size: Some(*size),
            })
            .collect(),
        gated: false,
        private: false,
        fetched_at_ms,
        source: SizeSource::LocalTree,
    }
}

/// Splashboard's on-disk cache of RepoInfo, keyed by repository.
pub struct InfoCache {
    path: PathBuf,
}

impl InfoCache {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// ~/Library/Caches/ai.splashboard.app/hf-repos.json
    pub fn default_path() -> Option<PathBuf> {
        dirs::cache_dir().map(|d| d.join("ai.splashboard.app/hf-repos.json"))
    }

    pub fn load(&self) -> BTreeMap<String, RepoInfo> {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, infos: &BTreeMap<String, RepoInfo>) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let text = serde_json::to_string(infos).map_err(std::io::Error::other)?;
        let staging = self.path.with_extension("json.tmp");
        std::fs::write(&staging, text)?;
        std::fs::rename(staging, &self.path)
    }
}

// --- GGUF variants ----------------------------------------------------------------

fn stem(name: &str) -> &str {
    name.strip_suffix(".gguf")
        .or_else(|| name.strip_suffix(".GGUF"))
        .unwrap_or(name)
}

pub fn is_root_gguf(name: &str) -> bool {
    !name.contains('/') && name.to_ascii_lowercase().ends_with(".gguf")
}

/// `upstream._projector_named`: a vision projector by name.
pub fn is_projector(name: &str) -> bool {
    stem(name).to_ascii_lowercase().contains("mmproj")
}

fn common_prefix_len(parts: &[Vec<&str>]) -> usize {
    let Some(first) = parts.first() else { return 0 };
    let mut n = 0;
    while n < first.len() && parts.iter().all(|p| p.get(n) == first.get(n)) {
        n += 1;
    }
    n
}

/// `upstream.select_gguf`: the target GGUF a `:VARIANT` names among the
/// repository's root GGUF names. Err lists the candidates.
pub fn select_gguf(names: &[String], variant: Option<&str>) -> Result<String, String> {
    let candidates: Vec<&String> = names
        .iter()
        .filter(|n| is_root_gguf(n) && !is_projector(n))
        .collect();
    let listed = || {
        let joined = candidates
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        if joined.is_empty() {
            "none".to_string()
        } else {
            joined
        }
    };
    let Some(variant) = variant else {
        return match candidates.as_slice() {
            [only] => Ok((*only).clone()),
            _ => Err(format!(
                "select a GGUF with OWNER/REPO:VARIANT (files in the repository root: {})",
                listed()
            )),
        };
    };
    let parts: Vec<Vec<&str>> = candidates
        .iter()
        .map(|n| stem(n).split('-').collect())
        .collect();
    let shared = common_prefix_len(&parts);
    let wanted = variant.to_ascii_lowercase();
    let exact: Vec<&String> = candidates
        .iter()
        .zip(&parts)
        .filter(|(_, words)| {
            words[shared.min(words.len())..]
                .join("-")
                .to_ascii_lowercase()
                == wanted
        })
        .map(|(n, _)| *n)
        .collect();
    if let [only] = exact.as_slice() {
        return Ok((*only).clone());
    }
    let suffix = format!("-{wanted}");
    let ending: Vec<&String> = candidates
        .iter()
        .filter(|n| stem(n).to_ascii_lowercase().ends_with(&suffix))
        .copied()
        .collect();
    if let [only] = ending.as_slice() {
        return Ok((*only).clone());
    }
    Err(format!(
        "no single GGUF matches :{variant} (files in the repository root: {})",
        listed()
    ))
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GgufVariant {
    /// What goes after the colon in OWNER/REPO:VARIANT.
    pub variant: String,
    pub file: String,
    pub size_bytes: Option<u64>,
    pub supported: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoVariants {
    pub repo: String,
    pub sha: Option<String>,
    pub source: SizeSource,
    pub variants: Vec<GgufVariant>,
    /// Root GGUF vision projectors (mmproj*), with sizes.
    pub projectors: Vec<RepoFile>,
    /// Exactly one BF16 projector, or none BF16 and exactly one F32 (by
    /// name; Splash checks the tensors when it installs).
    pub vision_likely: bool,
    /// Preselect "Text only" (--language-only).
    pub text_only_recommended: bool,
    /// The repository holds safetensors: an MLX target, no variant needed.
    pub has_safetensors: bool,
}

/// The variant names of a repository's root GGUF files, each checked to
/// resolve back to its file through [`select_gguf`].
pub fn gguf_variants(files: &[RepoFile]) -> Vec<GgufVariant> {
    let names: Vec<String> = files.iter().map(|f| f.name.clone()).collect();
    let candidates: Vec<&RepoFile> = files
        .iter()
        .filter(|f| is_root_gguf(&f.name) && !is_projector(&f.name))
        .collect();
    // The model name most files share: group by first word, take the largest group.
    let mut groups: HashMap<&str, Vec<&RepoFile>> = HashMap::new();
    for file in &candidates {
        let first = stem(&file.name).split('-').next().unwrap_or_default();
        groups.entry(first).or_default().push(file);
    }
    let largest = groups
        .values()
        .max_by_key(|g| g.len())
        .cloned()
        .unwrap_or_default();
    let group_parts: Vec<Vec<&str>> = largest
        .iter()
        .map(|f| stem(&f.name).split('-').collect())
        .collect();
    let mut shared = common_prefix_len(&group_parts);
    if group_parts.iter().any(|p| p.len() <= shared) {
        shared = shared.saturating_sub(1);
    }

    let mut out: Vec<GgufVariant> = candidates
        .iter()
        .map(|file| {
            let words: Vec<&str> = stem(&file.name).split('-').collect();
            let in_group = largest.iter().any(|f| f.name == file.name);
            let preferred = if in_group && words.len() > shared {
                words[shared..].join("-")
            } else {
                stem(&file.name).to_string()
            };
            let resolves = |v: &str| select_gguf(&names, Some(v)).is_ok_and(|f| f == file.name);
            let variant = if resolves(&preferred) {
                Some(preferred)
            } else if resolves(stem(&file.name)) {
                Some(stem(&file.name).to_string())
            } else {
                None
            };
            let reason = variant.as_deref().and_then(unsupported_variant_reason);
            GgufVariant {
                supported: variant.is_some() && reason.is_none(),
                note: match (&variant, reason) {
                    (None, _) => Some("no variant name selects this file alone".into()),
                    (_, Some(r)) => Some(r.into()),
                    _ => None,
                },
                variant: variant.unwrap_or_else(|| stem(&file.name).to_string()),
                file: file.name.clone(),
                size_bytes: file.size,
            }
        })
        .collect();
    out.sort_by(|a, b| {
        a.size_bytes
            .cmp(&b.size_bytes)
            .then(a.variant.cmp(&b.variant))
    });
    out
}

pub fn repo_variants(info: &RepoInfo) -> RepoVariants {
    let projectors: Vec<RepoFile> = info
        .files
        .iter()
        .filter(|f| is_root_gguf(&f.name) && is_projector(&f.name))
        .cloned()
        .collect();
    let count = |tag: &str| {
        projectors
            .iter()
            .filter(|p| p.name.to_ascii_uppercase().contains(tag))
            .count()
    };
    let (bf16, f32) = (count("BF16"), count("F32"));
    let vision_likely = bf16 == 1 || (bf16 == 0 && f32 == 1);
    RepoVariants {
        repo: info.repo.clone(),
        sha: info.sha.clone(),
        source: info.source,
        variants: gguf_variants(&info.files),
        vision_likely,
        text_only_recommended: !vision_likely,
        has_safetensors: info.files.iter().any(|f| f.name.ends_with(".safetensors")),
        projectors,
    }
}

/// Download size of a catalog entry: the selected GGUF for a variant, else
/// every file in the repository.
pub fn entry_size(info: &RepoInfo, variant: Option<&str>, format: ModelFormat) -> Option<u64> {
    if format == ModelFormat::Gguf {
        let names: Vec<String> = info.files.iter().map(|f| f.name.clone()).collect();
        let file = select_gguf(&names, variant).ok()?;
        return info
            .files
            .iter()
            .find(|f| f.name == file)
            .and_then(|f| f.size);
    }
    let sizes: Vec<u64> = info.files.iter().filter_map(|f| f.size).collect();
    (!sizes.is_empty()).then(|| sizes.iter().sum())
}

// --- the catalog ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    /// What `--model` takes: OWNER/REPO[:VARIANT].
    pub id: String,
    pub repo: String,
    pub variant: Option<String>,
    pub family: Option<String>,
    pub format: ModelFormat,
    pub label: String,
    pub description: Option<String>,
    pub sources: Vec<CatalogSource>,
    /// False for drafts.
    pub servable: bool,
    pub recommended: bool,
    pub min_ram_gb: Option<u32>,
    pub size_bytes: Option<u64>,
    pub size_source: Option<SizeSource>,
    pub size_fetched_at_ms: Option<u64>,
    pub gated: bool,
}

/// Where the bundled and cached lists live.
#[derive(Debug, Clone, Default)]
pub struct CatalogPaths {
    pub bundled_official: Option<PathBuf>,
    pub bundled_suggested: Option<PathBuf>,
    pub cached_official: Option<PathBuf>,
}

impl CatalogPaths {
    pub fn new(libexec: Option<&Path>, splash_data: Option<&Path>) -> Self {
        Self {
            bundled_official: libexec.map(|l| l.join("install/completions/official-models.txt")),
            bundled_suggested: libexec.map(|l| l.join("install/completions/suggested-models.txt")),
            cached_official: splash_data.map(|d| d.join("catalog/official-models.txt")),
        }
    }
}

/// A list of model IDs, one per line; invalid lines are dropped, as
/// `catalog._read` does.
pub fn read_id_list(path: Option<&Path>) -> Vec<String> {
    let Some(text) = path.and_then(|p| std::fs::read_to_string(p).ok()) else {
        return Vec::new();
    };
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && ids::split_model_id(l).is_ok())
        .map(str::to_string)
        .collect()
}

pub fn build_catalog(
    paths: &CatalogPaths,
    infos: &BTreeMap<String, RepoInfo>,
) -> Vec<CatalogEntry> {
    let mut entries: Vec<CatalogEntry> = Vec::new();
    let mut add = |id: &str, source: CatalogSource| {
        if let Some(entry) = entries.iter_mut().find(|e| e.id == id) {
            if !entry.sources.contains(&source) {
                entry.sources.push(source);
                entry.sources.sort();
            }
            return;
        }
        let Ok((repo, variant)) = ids::split_model_id(id) else {
            return;
        };
        let known = KNOWN.iter().find(|k| k.id == id);
        let format = known
            .map(|k| k.format)
            .unwrap_or_else(|| infer_format(&repo, variant.as_deref()));
        let info = infos.get(&repo);
        let hub_size = info.and_then(|i| entry_size(i, variant.as_deref(), format));
        let (size_bytes, size_source) = match (hub_size, known.and_then(|k| k.docs_size)) {
            (Some(size), _) => (Some(size), info.map(|i| i.source)),
            (None, Some(docs)) => (Some(docs), Some(SizeSource::Docs)),
            (None, None) => (None, None),
        };
        entries.push(CatalogEntry {
            id: id.to_string(),
            family: known
                .map(|k| k.family.to_string())
                .or_else(|| infer_family(&repo)),
            label: known
                .map(|k| k.label.to_string())
                .unwrap_or_else(|| id.to_string()),
            description: known.map(|k| k.description.to_string()),
            sources: vec![source],
            servable: format != ModelFormat::Draft,
            recommended: known.is_some_and(|k| k.recommended),
            min_ram_gb: known.and_then(|k| k.min_ram_gb),
            size_fetched_at_ms: size_bytes.and(info.map(|i| i.fetched_at_ms)),
            gated: info.is_some_and(|i| i.gated),
            size_bytes,
            size_source,
            repo,
            variant,
            format,
        });
    };
    for id in read_id_list(paths.bundled_official.as_deref()) {
        add(&id, CatalogSource::Official);
    }
    for id in read_id_list(paths.cached_official.as_deref()) {
        add(&id, CatalogSource::CachedCatalog);
    }
    for id in read_id_list(paths.bundled_suggested.as_deref()) {
        add(&id, CatalogSource::Suggested);
    }
    for known in KNOWN {
        add(known.id, CatalogSource::Upstream);
    }
    entries
}

/// Every repository the catalog names (targets and drafts).
pub fn catalog_repos(entries: &[CatalogEntry]) -> Vec<String> {
    let mut repos: Vec<String> = entries.iter().map(|e| e.repo.clone()).collect();
    repos.sort();
    repos.dedup();
    repos
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub entries: Vec<CatalogEntry>,
    /// A refresh was asked for and the Hub could not be reached.
    pub offline: bool,
    /// Per-repository problems from the last refresh.
    pub errors: Vec<String>,
    pub refreshed_at_ms: Option<u64>,
}

/// Fills `infos` for repositories without one, from the hub cache's tree
/// listings (offline sizes).
pub fn fill_from_trees(
    infos: &mut BTreeMap<String, RepoInfo>,
    repos: &[String],
    hub_cache: Option<&Path>,
) {
    let Some(cache) = hub_cache else { return };
    for repo in repos {
        if infos.contains_key(repo) {
            continue;
        }
        if let Some(listing) = hfcache::tree_listing(cache, repo) {
            let at =
                hfcache::modified_ms(&hfcache::repo_dir(cache, repo).join("trees")).unwrap_or(0);
            infos.insert(repo.clone(), info_from_tree(repo, &listing, at));
        }
    }
}

/// Builds the catalog. With `refresh`, sizes older than a day (or missing)
/// are fetched from the Hub first; failures keep the cached sizes.
pub async fn load_catalog(
    paths: &CatalogPaths,
    cache: &InfoCache,
    hub_cache: Option<&Path>,
    refresh: bool,
    token: Option<&super::token::Secret>,
) -> Catalog {
    let mut infos = cache.load();
    let mut errors = Vec::new();
    let mut offline = false;
    let mut refreshed_at_ms = None;
    let repos = catalog_repos(&build_catalog(paths, &BTreeMap::new()));
    if refresh {
        let now = now_ms();
        let stale: Vec<&String> = repos
            .iter()
            .filter(|r| {
                infos.get(*r).is_none_or(|i| {
                    i.source != SizeSource::Hub
                        || now.saturating_sub(i.fetched_at_ms) > INFO_MAX_AGE_MS
                })
            })
            .collect();
        match crate::install::brew::http_client() {
            Ok(client) => {
                let endpoint = endpoint();
                let fetches = stale
                    .iter()
                    .map(|repo| fetch_repo_info(&client, &endpoint, repo, token));
                let results = futures_util::future::join_all(fetches).await;
                let mut unreachable = 0;
                for (repo, result) in stale.iter().zip(results) {
                    match result {
                        Ok(info) => {
                            infos.insert((*repo).clone(), info);
                        }
                        Err(error) => {
                            if matches!(error.kind(), "offline" | "timeout") {
                                unreachable += 1;
                            }
                            errors.push(format!("{repo}: {error}"));
                        }
                    }
                }
                offline = !stale.is_empty() && unreachable == stale.len();
                if let Err(error) = cache.save(&infos) {
                    errors.push(format!("could not save the size cache: {error}"));
                }
                refreshed_at_ms = Some(now);
            }
            Err(error) => errors.push(format!("could not create the HTTP client: {error}")),
        }
    }
    fill_from_trees(&mut infos, &repos, hub_cache);
    Catalog {
        entries: build_catalog(paths, &infos),
        offline,
        errors,
        refreshed_at_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::testutil::TempDir;

    const UNSLOTH_27B: &str = include_str!("testdata/hf-unsloth-qwen3.8-27b-gguf.json");

    fn recorded() -> RepoInfo {
        parse_model_info("unsloth/Qwen3.8-27B-GGUF", UNSLOTH_27B, 1).expect("parse")
    }

    #[test]
    fn parses_recorded_hub_info() {
        let info = recorded();
        assert_eq!(
            info.sha.as_deref(),
            Some("4ca720788d1e01f1bff70c033e0d0028fd02e502")
        );
        assert_eq!(info.files.len(), 33);
        assert!(!info.gated);
        assert!(info.files.iter().all(|f| f.size.is_some()));
    }

    #[test]
    fn select_gguf_matches_splash() {
        let names: Vec<String> = recorded().files.into_iter().map(|f| f.name).collect();
        assert_eq!(
            select_gguf(&names, Some("UD-Q4_K_M")).expect("ok"),
            "Qwen3.8-27B-UD-Q4_K_M.gguf"
        );
        assert_eq!(
            select_gguf(&names, Some("ud-iq3_xxs")).expect("ok"),
            "Qwen3.8-27B-UD-IQ3_XXS.gguf"
        );
        assert_eq!(
            select_gguf(&names, Some("Q4_0")).expect("ok"),
            "Qwen3.8-27B-Q4_0.gguf"
        );
        // Several root GGUFs and no variant: Splash asks for one.
        assert!(select_gguf(&names, None).is_err());
        assert!(select_gguf(&names, Some("Q9")).is_err());
        let one = vec!["model-Q4.gguf".to_string(), "mmproj-BF16.gguf".to_string()];
        assert_eq!(select_gguf(&one, None).expect("ok"), "model-Q4.gguf");
    }

    #[test]
    fn lists_variants_from_the_recorded_repo() {
        let variants = repo_variants(&recorded());
        let names: Vec<&str> = variants
            .variants
            .iter()
            .map(|v| v.variant.as_str())
            .collect();
        assert!(names.contains(&"UD-Q4_K_M"), "{names:?}");
        assert!(names.contains(&"UD-IQ3_XXS"));
        assert!(names.contains(&"Q8_0"));
        // Subfolder (BF16/, MTP/) files are not root GGUFs; projectors are separate.
        assert!(!variants.variants.iter().any(|v| v.file.contains('/')));
        assert!(!variants.variants.iter().any(|v| v.file.contains("mmproj")));
        let q8xl = variants
            .variants
            .iter()
            .find(|v| v.variant == "UD-Q8_K_XL")
            .expect("q8 xl");
        assert!(!q8xl.supported);
        let imatrix = variants
            .variants
            .iter()
            .find(|v| v.file == "imatrix_unsloth.gguf")
            .expect("imatrix");
        assert!(!imatrix.supported);
        assert_eq!(variants.projectors.len(), 2);
        assert!(variants.vision_likely);
        assert!(!variants.text_only_recommended);
        assert!(!variants.has_safetensors);
        // Sorted smallest first.
        let sizes: Vec<u64> = variants
            .variants
            .iter()
            .filter_map(|v| v.size_bytes)
            .collect();
        assert!(sizes.windows(2).all(|w| w[0] <= w[1]));
    }

    #[test]
    fn several_bf16_projectors_preselect_text_only() {
        let info = RepoInfo {
            repo: "a/b".into(),
            sha: None,
            files: ["m-Q4.gguf", "mmproj-a-BF16.gguf", "mmproj-b-BF16.gguf"]
                .iter()
                .map(|n| RepoFile {
                    name: (*n).into(),
                    size: Some(1),
                })
                .collect(),
            gated: false,
            private: false,
            fetched_at_ms: 0,
            source: SizeSource::Hub,
        };
        assert!(repo_variants(&info).text_only_recommended);
    }

    #[test]
    fn sizes_entries() {
        let info = recorded();
        let q4 = entry_size(&info, Some("UD-Q4_K_M"), ModelFormat::Gguf).expect("size");
        let file = info
            .files
            .iter()
            .find(|f| f.name == "Qwen3.8-27B-UD-Q4_K_M.gguf")
            .and_then(|f| f.size);
        assert_eq!(Some(q4), file);
        let all = entry_size(&info, None, ModelFormat::Mlx).expect("size");
        assert!(all > q4);
    }

    #[test]
    fn builds_the_catalog_from_lists_and_known_models() {
        let dir = TempDir::new("catalog");
        let official = dir.write(
            "libexec/install/completions/official-models.txt",
            "incoai/Qwen3.6-35B-A3B-Splash\nincoai/Qwen3.8-27B-Splash\nnot an id\n",
        );
        let suggested = dir.write(
            "libexec/install/completions/suggested-models.txt",
            "mlx-community/Qwen3.6-35B-A3B-4bit\nmlx-community/Qwen3.8-27B-4bit\n",
        );
        let cached = dir.write(
            "data/catalog/official-models.txt",
            "incoai/Qwen3.8-27B-Splash\nincoai/New-Model-Splash\n",
        );
        let paths = CatalogPaths {
            bundled_official: Some(official),
            bundled_suggested: Some(suggested),
            cached_official: Some(cached),
        };
        let mut infos = BTreeMap::new();
        infos.insert("unsloth/Qwen3.8-27B-GGUF".to_string(), recorded());
        let entries = build_catalog(&paths, &infos);

        let splash = entries
            .iter()
            .find(|e| e.id == "incoai/Qwen3.8-27B-Splash")
            .expect("official");
        assert_eq!(
            splash.sources,
            vec![
                CatalogSource::Official,
                CatalogSource::CachedCatalog,
                CatalogSource::Upstream
            ]
        );
        assert_eq!(splash.format, ModelFormat::Package);
        let new = entries
            .iter()
            .find(|e| e.id == "incoai/New-Model-Splash")
            .expect("cached only");
        assert_eq!(new.sources, vec![CatalogSource::CachedCatalog]);
        let gguf = entries
            .iter()
            .find(|e| e.id == "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M")
            .expect("gguf");
        assert_eq!(gguf.size_source, Some(SizeSource::Hub));
        assert!(gguf.size_bytes.is_some());
        assert!(gguf.recommended);
        let bonsai = entries
            .iter()
            .find(|e| e.repo == "prism-ml/Ternary-Bonsai-2-27B-gguf")
            .expect("bonsai");
        assert_eq!(bonsai.size_source, Some(SizeSource::Docs));
        let draft = entries
            .iter()
            .find(|e| e.repo == "incoai/Qwen3.8-27B-DFlash2")
            .expect("draft");
        assert!(!draft.servable);
        assert!(!entries.iter().any(|e| e.id == "not an id"));
        let repos = catalog_repos(&entries);
        assert_eq!(
            repos
                .iter()
                .filter(|r| *r == "unsloth/Qwen3.8-27B-GGUF")
                .count(),
            1
        );
    }

    #[test]
    fn caches_infos_on_disk() {
        let dir = TempDir::new("info-cache");
        let cache = InfoCache::new(dir.path().join("sub/hf-repos.json"));
        assert!(cache.load().is_empty());
        let mut infos = BTreeMap::new();
        infos.insert("unsloth/Qwen3.8-27B-GGUF".to_string(), recorded());
        cache.save(&infos).expect("save");
        assert_eq!(cache.load(), infos);
    }

    #[tokio::test]
    async fn loads_offline_from_trees() {
        let dir = TempDir::new("catalog-offline");
        let tree = format!(
            "hub/{}/trees/abc.json",
            ids::cache_folder_name("mlx-community/Qwen3.8-27B-4bit")
        );
        dir.write(&tree, r#"{"format_version":1,"files":{"model.safetensors":{"size":1000},"config.json":{"size":10}}}"#);
        let cache = InfoCache::new(dir.path().join("cache.json"));
        let catalog = load_catalog(
            &CatalogPaths::default(),
            &cache,
            Some(&dir.path().join("hub")),
            false,
            None,
        )
        .await;
        let entry = catalog
            .entries
            .iter()
            .find(|e| e.id == "mlx-community/Qwen3.8-27B-4bit")
            .expect("entry");
        assert_eq!(entry.size_bytes, Some(1010));
        assert_eq!(entry.size_source, Some(SizeSource::LocalTree));
        assert!(!catalog.offline);
    }

    #[test]
    fn infers_family_and_format() {
        assert_eq!(
            infer_family("lmstudio-community/Qwen3.8-27B-MLX-4bit").as_deref(),
            Some("Qwen3.8-27B")
        );
        assert_eq!(
            infer_format("unsloth/X-GGUF", Some("Q4")),
            ModelFormat::Gguf
        );
        assert_eq!(infer_format("incoai/X-DFlash2", None), ModelFormat::Draft);
        assert_eq!(infer_format("incoai/X-Splash", None), ModelFormat::Package);
        assert_eq!(infer_format("mlx-community/X-4bit", None), ModelFormat::Mlx);
        assert!(unsupported_variant_reason("BF16").is_some());
        assert!(unsupported_variant_reason("UD-Q8_K_XL").is_some());
        assert!(unsupported_variant_reason("UD-Q4_K_M").is_none());
    }
}
