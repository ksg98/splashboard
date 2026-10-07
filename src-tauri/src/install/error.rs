//! The error `install_*`, `models_*` and `hf_token_*` commands return.
//!
//! Serializes as `{ "kind": "<camelCase>", "message": "...", "command"?, "url"? }`
//! (TS: `OpError` in `src/lib/install/types.ts`). `needsTerminal` carries the
//! command to run in the embedded terminal and a web page to open instead.

use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum OpError {
    /// Something only an interactive terminal can do (installing Homebrew).
    #[error("{message}")]
    NeedsTerminal {
        message: String,
        command: String,
        url: String,
    },
    #[error("Splash is not installed. Install it first (Homebrew: incoai/tap/splash).")]
    SplashNotInstalled,
    /// Another job holds what this one needs.
    #[error("{0}")]
    Busy(String),
    /// A running server uses what this would change or delete.
    #[error("{0}")]
    InUse(String),
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("{0}")]
    NotFound(String),
    /// A child process (brew, the model installer) exited unsuccessfully.
    #[error("{0}")]
    Failed(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("network error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("{0}")]
    Other(String),
}

impl OpError {
    pub fn kind(&self) -> &'static str {
        match self {
            OpError::NeedsTerminal { .. } => "needsTerminal",
            OpError::SplashNotInstalled => "splashNotInstalled",
            OpError::Busy(_) => "busy",
            OpError::InUse(_) => "inUse",
            OpError::InvalidRequest(_) => "invalidRequest",
            OpError::NotFound(_) => "notFound",
            OpError::Failed(_) => "failed",
            OpError::Io(_) => "io",
            OpError::Http(e) if e.is_timeout() => "timeout",
            OpError::Http(e) if e.is_connect() => "offline",
            OpError::Http(_) => "http",
            OpError::Other(_) => "other",
        }
    }
}

impl Serialize for OpError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("kind", self.kind())?;
        map.serialize_entry("message", &self.to_string())?;
        if let OpError::NeedsTerminal { command, url, .. } = self {
            map.serialize_entry("command", command)?;
            map.serialize_entry("url", url)?;
        }
        map.end()
    }
}

pub type OpResult<T> = Result<T, OpError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_kind_message_and_terminal_fields() {
        let error = OpError::NeedsTerminal {
            message: "Homebrew is not installed".into(),
            command: "/bin/bash -c ...".into(),
            url: "https://brew.sh".into(),
        };
        let json = serde_json::to_value(&error).expect("serialize");
        assert_eq!(json["kind"], "needsTerminal");
        assert_eq!(json["command"], "/bin/bash -c ...");
        assert_eq!(json["url"], "https://brew.sh");

        let json = serde_json::to_value(OpError::Busy("x".into())).expect("serialize");
        assert_eq!(json, serde_json::json!({ "kind": "busy", "message": "x" }));
    }
}
