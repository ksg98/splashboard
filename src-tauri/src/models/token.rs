//! The Hugging Face token Splash's downloads use: the file huggingface_hub
//! reads (`$HF_TOKEN_PATH`, else `$HF_HOME/token`, else
//! `~/.cache/huggingface/token`), the same one `hf auth login` writes.
//!
//! The token never leaves this module: it is not logged, returned, put on a
//! command line or included in an error. The UI sees only whether one is
//! set and whose it is (`whoami-v2`).

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{catalog, hfcache};
use crate::install::{OpError, OpResult};

/// A secret string whose Debug and Display never show it.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TokenSource {
    /// HF_TOKEN in Splashboard's own environment (takes precedence, as in
    /// huggingface_hub).
    Env,
    File,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenStatus {
    pub has_token: bool,
    pub source: Option<TokenSource>,
    /// The token file's location (shown in Settings; never its content).
    pub path: Option<String>,
    /// From whoami, when checked.
    pub username: Option<String>,
    /// "read" | "write" | "fineGrained", when checked.
    pub role: Option<String>,
    /// None when not checked or unreachable.
    pub valid: Option<bool>,
    pub error: Option<String>,
}

pub fn token_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("HF_TOKEN_PATH").filter(|v| !v.is_empty()) {
        return Some(hfcache::expand_home(Path::new(&path)));
    }
    hfcache::hf_home().map(|h| h.join("token"))
}

pub fn read_file(path: &Path) -> Option<Secret> {
    let text = std::fs::read_to_string(path).ok()?;
    let token = text.trim();
    (!token.is_empty()).then(|| Secret::new(token))
}

/// The token huggingface_hub would use, and where it came from.
pub fn current(path: Option<&Path>) -> Option<(Secret, TokenSource)> {
    if let Some(env) = std::env::var("HF_TOKEN")
        .ok()
        .filter(|t| !t.trim().is_empty())
    {
        return Some((Secret::new(env.trim()), TokenSource::Env));
    }
    path.and_then(read_file).map(|t| (t, TokenSource::File))
}

/// Tokens are printable ASCII without spaces (hf_..., or older api_...).
pub fn validate_format(token: &str) -> OpResult<()> {
    let token = token.trim();
    if token.len() < 8 || token.len() > 512 || !token.chars().all(|c| c.is_ascii_graphic()) {
        return Err(OpError::InvalidRequest(
            "that does not look like a Hugging Face token (expected hf_...)".into(),
        ));
    }
    Ok(())
}

/// Writes the token file atomically with mode 0600.
pub fn write_file(path: &Path, token: &Secret) -> OpResult<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let parent = path
        .parent()
        .ok_or_else(|| OpError::Other("invalid token path".into()))?;
    std::fs::create_dir_all(parent)?;
    let staging = parent.join(format!(".token.splashboard-{}", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&staging)?;
        file.write_all(token.expose().as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&staging, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&staging);
    }
    result.map_err(OpError::from)
}

pub fn remove_file(path: &Path) -> OpResult<bool> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WhoAmI {
    pub name: String,
    pub role: Option<String>,
}

#[derive(Deserialize)]
struct WhoAmIJson {
    name: String,
    auth: Option<WhoAmIAuth>,
}

#[derive(Deserialize)]
struct WhoAmIAuth {
    #[serde(rename = "accessToken")]
    access_token: Option<WhoAmIAccessToken>,
}

#[derive(Deserialize)]
struct WhoAmIAccessToken {
    role: Option<String>,
}

pub fn parse_whoami(json: &str) -> Option<WhoAmI> {
    let parsed: WhoAmIJson = serde_json::from_str(json).ok()?;
    Some(WhoAmI {
        name: parsed.name,
        role: parsed
            .auth
            .and_then(|a| a.access_token)
            .and_then(|t| t.role),
    })
}

/// Ok(Some) valid, Ok(None) rejected (401), Err unreachable or unexpected.
pub async fn whoami(
    client: &reqwest::Client,
    endpoint: &str,
    token: &Secret,
) -> OpResult<Option<WhoAmI>> {
    let response = client
        .get(format!("{endpoint}/api/whoami-v2"))
        .bearer_auth(token.expose())
        .send()
        .await?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(OpError::Failed(format!("Hugging Face answered {status}")));
    }
    let text = response.text().await?;
    parse_whoami(&text)
        .map(Some)
        .ok_or_else(|| OpError::Failed("unexpected whoami response".into()))
}

fn base_status(path: Option<&Path>) -> (TokenStatus, Option<Secret>) {
    let current = current(path);
    let status = TokenStatus {
        has_token: current.is_some(),
        source: current.as_ref().map(|(_, s)| *s),
        path: path.map(|p| p.display().to_string()),
        username: None,
        role: None,
        valid: None,
        error: None,
    };
    (status, current.map(|(t, _)| t))
}

async fn check(status: &mut TokenStatus, token: &Secret) {
    let client = match crate::install::brew::http_client() {
        Ok(c) => c,
        Err(e) => {
            status.error = Some(format!("could not create the HTTP client: {e}"));
            return;
        }
    };
    match whoami(&client, &catalog::endpoint(), token).await {
        Ok(Some(who)) => {
            status.valid = Some(true);
            status.username = Some(who.name);
            status.role = who.role;
        }
        Ok(None) => {
            status.valid = Some(false);
            status.error = Some("Hugging Face rejected this token".into());
        }
        Err(error) => status.error = Some(error.to_string()),
    }
}

/// Whether a token is set; with `verify`, also whose it is (network).
pub async fn status(path: Option<&Path>, verify: bool) -> TokenStatus {
    let (mut status, token) = base_status(path);
    if verify {
        if let Some(token) = token {
            check(&mut status, &token).await;
        }
    }
    status
}

/// Saves the token where huggingface_hub reads it. With `verify`, a token
/// Hugging Face rejects is not saved (an unreachable Hub does not block).
pub async fn save(path: Option<&Path>, token: &str, verify: bool) -> OpResult<TokenStatus> {
    validate_format(token)?;
    let path =
        path.ok_or_else(|| OpError::Other("could not find the Hugging Face folder".into()))?;
    let secret = Secret::new(token.trim());
    let mut checked = TokenStatus {
        has_token: true,
        source: Some(TokenSource::File),
        path: Some(path.display().to_string()),
        username: None,
        role: None,
        valid: None,
        error: None,
    };
    if verify {
        check(&mut checked, &secret).await;
        if checked.valid == Some(false) {
            return Err(OpError::InvalidRequest(
                "Hugging Face rejected this token; it was not saved".into(),
            ));
        }
    }
    write_file(path, &secret)?;
    let (mut status, _) = base_status(Some(path));
    status.username = checked.username;
    status.role = checked.role;
    status.valid = checked.valid;
    status.error = checked.error;
    Ok(status)
}

/// Deletes the token file. An HF_TOKEN in the environment stays in effect.
pub fn remove(path: Option<&Path>) -> OpResult<TokenStatus> {
    if let Some(path) = path {
        remove_file(path)?;
    }
    Ok(base_status(path).0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::testutil::TempDir;
    use std::os::unix::fs::PermissionsExt;

    const TOKEN: &str = "hf_abcdefghijklmnopqrstuvwxyz0123456789";

    #[test]
    fn secret_never_prints() {
        let secret = Secret::new(TOKEN);
        assert!(!format!("{secret:?}").contains("hf_"));
        assert_eq!(secret.expose(), TOKEN);
    }

    #[test]
    fn validates_token_format() {
        assert!(validate_format(TOKEN).is_ok());
        assert!(validate_format("short").is_err());
        assert!(validate_format("hf_abc def ghi jkl").is_err());
        let error = validate_format("hf_ bad token value").expect_err("invalid");
        assert!(!error.to_string().contains("bad token"));
    }

    #[test]
    fn writes_reads_and_removes_with_private_permissions() {
        let dir = TempDir::new("token");
        let path = dir.path().join("hf/token");
        write_file(&path, &Secret::new(TOKEN)).expect("write");
        let mode = std::fs::metadata(&path).expect("meta").permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        assert_eq!(
            read_file(&path).map(|s| s.expose().to_string()).as_deref(),
            Some(TOKEN)
        );
        // Overwrite keeps 0600 and replaces the content.
        write_file(&path, &Secret::new("hf_second_token_value")).expect("write");
        assert_eq!(
            read_file(&path).map(|s| s.expose().to_string()).as_deref(),
            Some("hf_second_token_value")
        );
        assert!(remove_file(&path).expect("remove"));
        assert!(!remove_file(&path).expect("remove again"));
        assert!(read_file(&path).is_none());
    }

    #[tokio::test]
    async fn status_never_contains_the_token() {
        let dir = TempDir::new("token-status");
        let path = dir.path().join("token");
        write_file(&path, &Secret::new(TOKEN)).expect("write");
        let status = status(Some(&path), false).await;
        let json = serde_json::to_string(&status).expect("json");
        assert!(!json.contains(TOKEN));
        assert!(status.has_token || std::env::var("HF_TOKEN").is_ok());
        let removed = remove(Some(&path)).expect("remove");
        assert!(!path.exists());
        if std::env::var("HF_TOKEN").is_err() {
            assert!(!removed.has_token);
        }
    }

    #[tokio::test]
    async fn save_without_verify_writes_the_file() {
        let dir = TempDir::new("token-save");
        let path = dir.path().join("token");
        let status = save(Some(&path), &format!("  {TOKEN}\n"), false)
            .await
            .expect("save");
        assert!(status.has_token);
        assert_eq!(std::fs::read_to_string(&path).expect("read"), TOKEN);
        assert!(save(Some(&path), "nope", false).await.is_err());
    }

    #[test]
    fn parses_whoami() {
        let who = parse_whoami(r#"{"type":"user","name":"ada","auth":{"type":"access_token","accessToken":{"displayName":"x","role":"read"}}}"#)
            .expect("parse");
        assert_eq!(who.name, "ada");
        assert_eq!(who.role.as_deref(), Some("read"));
        assert!(parse_whoami("{}").is_none());
    }
}
