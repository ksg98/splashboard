//! Secrets the engine needs that are not in the launch request.
//!
//! The API key lives in the transport config (`splash_config_set`). The
//! Hugging Face token is the one the models settings save (`hf_token_save`
//! writes the file huggingface_hub reads: `$HF_TOKEN_PATH`, else
//! `$HF_HOME/token`, else `~/.cache/huggingface/token`), or one set in
//! memory with [`set_hf_token`]. `engine_start` passes it to Splash as
//! `HF_TOKEN` in the environment, never on the command line, so it also
//! applies when the launch request relocates `HF_HOME`.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

fn slot() -> &'static Mutex<Option<String>> {
    static HF_TOKEN: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    HF_TOKEN.get_or_init(|| Mutex::new(None))
}

/// Sets (or with `None`/empty, clears) the token passed as `HF_TOKEN`.
#[allow(dead_code)] // called by the installer's HF-token command
pub fn set_hf_token(token: Option<String>) {
    let token = token.filter(|t| !t.trim().is_empty());
    *slot().lock().unwrap_or_else(|p| p.into_inner()) = token;
}

/// The token file huggingface_hub reads.
pub fn hf_token_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("HF_TOKEN_PATH").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(path));
    }
    if let Some(home) = std::env::var_os("HF_HOME").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(home).join("token"));
    }
    dirs::home_dir().map(|h| h.join(".cache/huggingface/token"))
}

fn token_from_file(path: Option<PathBuf>) -> Option<String> {
    let text = std::fs::read_to_string(path?).ok()?;
    let token = text.trim().to_string();
    (!token.is_empty()).then_some(token)
}

/// The token to pass as `HF_TOKEN`: set in memory, else the app's own
/// `HF_TOKEN`, else the saved token file.
pub fn hf_token() -> Option<String> {
    if let Some(token) = slot().lock().unwrap_or_else(|p| p.into_inner()).clone() {
        return Some(token);
    }
    if let Some(token) = std::env::var("HF_TOKEN")
        .ok()
        .filter(|t| !t.trim().is_empty())
    {
        return Some(token.trim().to_string());
    }
    token_from_file(hf_token_path())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_and_clear() {
        set_hf_token(Some("hf_x".into()));
        assert_eq!(hf_token().as_deref(), Some("hf_x"));
        set_hf_token(Some("  ".into()));
        assert_eq!(*slot().lock().unwrap(), None);
    }

    #[test]
    fn reads_a_token_file() {
        let path = std::env::temp_dir().join(format!("splashboard-token-{}", std::process::id()));
        std::fs::write(&path, "hf_abc\n").unwrap();
        assert_eq!(
            token_from_file(Some(path.clone())).as_deref(),
            Some("hf_abc")
        );
        std::fs::write(&path, "  \n").unwrap();
        assert_eq!(token_from_file(Some(path.clone())), None);
        let _ = std::fs::remove_file(&path);
        assert_eq!(token_from_file(Some(path)), None);
    }
}
