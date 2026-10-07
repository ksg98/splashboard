//! The one error type every command returns.
//!
//! It serializes as `{ "kind": "<camelCase>", "message": "<human text>" }` so the
//! frontend can branch on `kind` (see `src/lib/splash/engine.ts`, `AppError`).

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("the splash CLI was not found; install it with Homebrew (brew install splash)")]
    SplashNotFound,
    #[error("the engine is already running (pid {0})")]
    AlreadyRunning(u32),
    #[error("port {0} is already in use; stop the other server or choose another port")]
    PortInUse(u16),
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("could not reach Splash: {0}")]
    Http(#[from] reqwest::Error),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
    #[error("{setting} needs Splash {needed} or newer; Splash {installed} is installed (upgrade with: brew upgrade splash)")]
    VersionTooOld {
        setting: String,
        needed: String,
        installed: String,
    },
    #[error("process {0} is not a Splash server; refusing to signal it")]
    NotSplash(u32),
    #[error("no engine is running")]
    NotRunning,
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::SplashNotFound => "splashNotFound",
            AppError::AlreadyRunning(_) => "alreadyRunning",
            AppError::PortInUse(_) => "portInUse",
            AppError::InvalidRequest(_) => "invalidRequest",
            AppError::Http(e) if e.is_timeout() => "timeout",
            AppError::Http(e) if e.is_connect() => "unreachable",
            AppError::Http(_) => "http",
            AppError::Io(_) => "io",
            AppError::Other(_) => "other",
            AppError::VersionTooOld { .. } => "versionTooOld",
            AppError::NotSplash(_) => "notSplash",
            AppError::NotRunning => "notRunning",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
