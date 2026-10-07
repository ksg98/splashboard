//! Model IDs and the paths Splash derives from them, ported from
//! `install/models.py` and `install/hub.py` (Splash 1.2.0) so Splashboard
//! computes the same selection links and pin folders.

use std::path::Path;

use sha2::{Digest, Sha256};

pub const VARIANT_SEPARATOR: char = ':';

fn is_edge(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn is_middle(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')
}

/// `[A-Za-z0-9_](?:[A-Za-z0-9._-]{0,max_middle}[A-Za-z0-9_])?`
fn valid_segment(segment: &str, max_middle: usize) -> bool {
    let chars: Vec<char> = segment.chars().collect();
    match chars.as_slice() {
        [] => false,
        [only] => is_edge(*only),
        [first, middle @ .., last] => {
            is_edge(*first)
                && is_edge(*last)
                && middle.len() <= max_middle
                && middle.iter().all(|c| is_middle(*c))
        }
    }
}

/// `models.validate_repo_id`: a full Hugging Face repository ID (owner/repo).
pub fn validate_repo_id(value: &str) -> Result<(), String> {
    let error = || "model must be a full Hugging Face repository ID (owner/repo)".to_string();
    let (owner, repo) = value.split_once('/').ok_or_else(error)?;
    if !valid_segment(owner, usize::MAX)
        || !valid_segment(repo, 94)
        || value.contains("--")
        || value.contains("..")
        || value.ends_with(".git")
    {
        return Err(error());
    }
    Ok(())
}

/// `models.split_model_id`: owner/repo[:variant] -> (repository ID, variant).
pub fn split_model_id(value: &str) -> Result<(String, Option<String>), String> {
    let (repo, variant) = match value.split_once(VARIANT_SEPARATOR) {
        Some((repo, variant)) => (repo, Some(variant)),
        None => (value, None),
    };
    validate_repo_id(repo)?;
    if let Some(variant) = variant {
        let mut chars = variant.chars();
        let first_ok = chars.next().is_some_and(|c| c.is_ascii_alphanumeric());
        let rest_ok = variant.len() <= 64 && chars.all(is_middle);
        if !first_ok || !rest_ok || variant.contains("..") {
            return Err(format!(
                "model variant must be a short name such as UD-Q4_K_M (owner/repo{VARIANT_SEPARATOR}VARIANT)"
            ));
        }
    }
    Ok((repo.to_string(), variant.map(str::to_string)))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// A JSON string as Python's `json.dumps` writes it (ensure_ascii=True).
fn python_json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            ' '..='~' => out.push(c),
            _ => {
                let mut units = [0u16; 2];
                for unit in c.encode_utf16(&mut units) {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
            }
        }
    }
    out.push('"');
    out
}

fn python_json_optional(value: Option<&str>) -> String {
    value
        .map(python_json_string)
        .unwrap_or_else(|| "null".into())
}

/// The selection link of a model with these source options, relative to the
/// models root (`models.selection_link`): `OWNER/REPO[:VARIANT]` for the
/// model alone, else `.selections/<sha256 of the selection>`.
pub fn selection_link_rel(
    model: &str,
    revision: Option<&str>,
    language_only: bool,
    draft_model: Option<&str>,
) -> Result<String, String> {
    split_model_id(model)?;
    let revision = revision.filter(|r| !r.is_empty());
    let draft_model = draft_model.filter(|d| !d.is_empty());
    if revision.is_some() || language_only || draft_model.is_some() {
        let selection = format!(
            "[{},{},{},{}]",
            python_json_string(model),
            python_json_optional(revision),
            if language_only { "true" } else { "false" },
            python_json_optional(draft_model),
        );
        return Ok(format!(".selections/{}", sha256_hex(selection.as_bytes())));
    }
    Ok(model.to_string())
}

/// The refs/splash folder name holding an installation's pins
/// (`hub.pin_owner`): sha256 of the link's real parent joined with its name.
pub fn pin_owner(link: &Path) -> Option<String> {
    use std::os::unix::ffi::OsStrExt;
    let parent = link.parent()?.canonicalize().ok()?;
    let owner = parent.join(link.file_name()?);
    Some(sha256_hex(owner.as_os_str().as_bytes()))
}

/// `models--owner--repo`
pub fn cache_folder_name(repo: &str) -> String {
    format!("models--{}", repo.replace('/', "--"))
}

/// The repository ID of a hub cache folder (`models--owner--repo`). IDs
/// cannot contain "--", so the split is unambiguous.
pub fn repo_from_cache_folder(name: &str) -> Option<String> {
    let rest = name.strip_prefix("models--")?;
    let (owner, repo) = rest.split_once("--")?;
    let id = format!("{owner}/{repo}");
    validate_repo_id(&id).ok()?;
    Some(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::testutil::TempDir;

    #[test]
    fn validates_repo_ids_like_splash() {
        for ok in [
            "incoai/Qwen3.8-27B-Splash",
            "a/b",
            "_x/y_",
            "mlx-community/Qwen3.6-35B-A3B-4bit",
        ] {
            assert!(validate_repo_id(ok).is_ok(), "{ok}");
        }
        for bad in [
            "noslash", "a/", "/b", "a/b/c", "a--b/c", "a/b..c", "a/b.git", "-a/b", "a/b-", "a b/c",
        ] {
            assert!(validate_repo_id(bad).is_err(), "{bad}");
        }
        let long = format!("a/{}", "x".repeat(96));
        assert!(validate_repo_id(&long).is_ok());
        let too_long = format!("a/{}", "x".repeat(97));
        assert!(validate_repo_id(&too_long).is_err());
    }

    #[test]
    fn splits_variants() {
        assert_eq!(
            split_model_id("unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M").expect("ok"),
            (
                "unsloth/Qwen3.8-27B-GGUF".to_string(),
                Some("UD-Q4_K_M".to_string())
            )
        );
        assert_eq!(split_model_id("a/b").expect("ok").1, None);
        assert!(split_model_id("a/b:").is_err());
        assert!(split_model_id("a/b:-x").is_err());
        assert!(split_model_id("a/b:x..y").is_err());
        assert!(split_model_id(&format!("a/b:{}", "x".repeat(65))).is_err());
    }

    /// Vectors computed with Splash's own `selection_link` (Python).
    #[test]
    fn selection_links_match_python() {
        assert_eq!(
            selection_link_rel("unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M", None, true, None).expect("ok"),
            ".selections/8adbe2a0c214994a2a91f41368859f94a95fa7e3713f61bc02be21a7a4a66f32"
        );
        assert_eq!(
            selection_link_rel(
                "mlx-community/Qwen3.8-27B-4bit",
                Some("abc123"),
                false,
                Some("incoai/Qwen3.8-27B-DFlash2")
            )
            .expect("ok"),
            ".selections/c978c1e1b0fe18c2dece30fd7e46ab2cf0d1e300e9935db34871052828e3d8b5"
        );
        assert_eq!(
            selection_link_rel("unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M", None, false, None)
                .expect("ok"),
            "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M"
        );
        assert!(selection_link_rel("bad", None, false, None).is_err());
    }

    #[test]
    fn python_json_escapes_non_ascii() {
        assert_eq!(python_json_string("a\"b\\c"), r#""a\"b\\c""#);
        assert_eq!(python_json_string("\u{e9}"), "\"\\u00e9\"");
        assert_eq!(python_json_string("\u{1F600}"), "\"\\ud83d\\ude00\"");
    }

    #[test]
    fn pin_owner_hashes_the_real_parent() {
        let dir = TempDir::new("pin-owner");
        std::fs::create_dir_all(dir.path().join("models/incoai")).expect("mkdir");
        let link = dir.path().join("models/incoai/Qwen3.8-27B-Splash");
        let expected = sha256_hex(
            format!("{}/models/incoai/Qwen3.8-27B-Splash", dir.path().display()).as_bytes(),
        );
        assert_eq!(pin_owner(&link).as_deref(), Some(expected.as_str()));
        // Python vector: sha256(b"/Users/x/models/incoai/Qwen3.8-27B-Splash")
        assert_eq!(
            sha256_hex(b"/Users/x/models/incoai/Qwen3.8-27B-Splash"),
            "b9340e749a7ca4037ec59ce963abfa4f855818095a9827e93a71712a63d63d1c"
        );
    }

    #[test]
    fn cache_folder_names_round_trip() {
        assert_eq!(
            cache_folder_name("incoai/Qwen3.8-27B-Splash"),
            "models--incoai--Qwen3.8-27B-Splash"
        );
        assert_eq!(
            repo_from_cache_folder("models--incoai--Qwen3.8-27B-Splash").as_deref(),
            Some("incoai/Qwen3.8-27B-Splash")
        );
        assert_eq!(repo_from_cache_folder("datasets--a--b"), None);
        assert_eq!(repo_from_cache_folder("models--a--b--c"), None);
    }
}
