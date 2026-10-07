//! The catalog-driven `splash serve` command line (the SHARED CONTRACT with
//! `src/lib/params/serve.ts`, which renders the same request in TypeScript).
//!
//! `docs/splash-params.json` is embedded at compile time. A [`ServeRequest`]
//! names each launch setting by its catalog key (`serve[].key`); [`render`]
//! validates it against the catalog and the installed Splash version and
//! produces the argv, the environment and the display command.
//!
//! The rules are written down once, in
//! `src/lib/params/__fixtures__/serve-vectors.json` (`rules`), and both sides
//! are tested against its vectors. In short:
//! - argv after the program: `serve`, `--model=<model>`, `--port=<port>`,
//!   then the flags **in the order of the flags array** (never reordered).
//! - only `serve[]` entries whose `applies_to` contains `serve` are accepted;
//!   `model`/`port` in flags, secrets (`api_key`, `hf_token`) in flags and
//!   unknown keys are errors naming the key.
//! - `null`, `false` and `[]` are omitted. `true` -> bare `--flag`, or for an
//!   env entry `NAME=<validation.env_value_when_on | 1>`. Strings verbatim.
//!   Numbers like JS `String(n)`. Lists: one `--flag=<item>` per item.
//! - `pass_as: "env"` entries become env vars (flags-array order); then the
//!   secrets Rust holds, always `SPLASH_API_KEY` then `HF_TOKEN`.
//! - every flag's `min_version` (and `--port`'s, always) is checked against
//!   the installed Splash; too old is an error naming the flag and version.
//! - command = `NAME=value ...` + `splash` + argv, single spaces. For
//!   `--name=value` / `NAME=value` only the value is quoted; bare tokens never
//!   are. Values matching `^[A-Za-z0-9_@%+=:,./-]+$` stay bare, others are
//!   single-quoted (`'` -> `'\''`), `""` is `''`, secrets show as `••••`.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};

/// The catalog, byte for byte as in `docs/splash-params.json`.
pub const CATALOG_JSON: &str = include_str!("../../../docs/splash-params.json");

/// Keys that are top-level fields of [`ServeRequest`].
const TOP_LEVEL_KEYS: &[&str] = &["model", "port"];
/// Keys whose values come from the app's secure config, never from flags.
const SECRET_KEYS: &[&str] = &["api_key", "hf_token"];

/// How secret values are shown (same as the TS `REDACTED`).
pub const REDACTED: &str = "\u{2022}\u{2022}\u{2022}\u{2022}";

#[derive(Debug, Clone, Deserialize)]
pub struct Catalog {
    /// The Splash release the catalog was generated from.
    #[allow(dead_code)] // read by tests; kept for diagnostics
    pub version: String,
    pub serve: Vec<ServeParam>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServeParam {
    pub key: String,
    pub flag: Option<String>,
    pub env: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub multiple: bool,
    pub min_version: Option<String>,
    #[serde(default)]
    pub pass_as: Option<String>,
    #[serde(default)]
    pub choices: Option<Vec<Choice>>,
    #[serde(default)]
    pub applies_to: Option<Vec<String>>,
    #[serde(default)]
    pub validation: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Choice {
    pub value: Value,
}

impl ServeParam {
    fn passes_as_env(&self) -> bool {
        self.pass_as.as_deref() == Some("env") || self.flag.is_none()
    }

    fn applies_to_serve(&self) -> bool {
        self.applies_to
            .as_ref()
            .is_none_or(|a| a.iter().any(|s| s == "serve"))
    }

    /// What an env entry is set to when switched on.
    fn env_value_when_on(&self) -> String {
        match self
            .validation
            .as_ref()
            .and_then(|v| v.get("env_value_when_on"))
        {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => format_number(n),
            _ => "1".to_string(),
        }
    }

    /// `--flag`, else the env name, else the key: how errors name it.
    fn display_name(&self) -> String {
        self.flag
            .clone()
            .or_else(|| self.env.clone())
            .unwrap_or_else(|| self.key.clone())
    }
}

/// The parsed embedded catalog.
pub fn catalog() -> AppResult<&'static Catalog> {
    static CATALOG: OnceLock<Result<Catalog, String>> = OnceLock::new();
    CATALOG
        .get_or_init(|| serde_json::from_str(CATALOG_JSON).map_err(|e| e.to_string()))
        .as_ref()
        .map_err(|e| AppError::Other(format!("the embedded splash-params.json is invalid: {e}")))
}

/// What `engine_start` receives from the UI (`{ options: ServeRequest }`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServeRequest {
    /// `OWNER/REPO[:VARIANT]` or an absolute model directory.
    pub model: String,
    pub port: u16,
    #[serde(default)]
    pub flags: Vec<ServeFlag>,
    /// Optional path to a `splash` executable (must be named `splash`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServeFlag {
    /// `splash-params.json` `serve[].key`.
    pub key: String,
    /// string | number | boolean | string[] | null
    #[serde(default)]
    pub value: Value,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub name: String,
    /// [`REDACTED`] for secrets in anything sent to the UI.
    pub value: String,
    pub secret: bool,
}

/// The command a [`ServeRequest`] becomes.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenderedServe {
    /// argv after the program name, starting with `serve` (JSON: `argv`,
    /// like the TS `RenderedServe`).
    #[serde(rename = "argv")]
    pub args: Vec<String>,
    /// Request-derived env vars, then secrets (added by [`Self::with_secret`]).
    pub env: Vec<EnvVar>,
    /// `[NAME=value ...] splash serve ...`; secrets always as [`REDACTED`].
    pub command: String,
}

impl RenderedServe {
    /// Adds a secret env var (`SPLASH_API_KEY`, then `HF_TOKEN`). Empty
    /// values are skipped.
    pub fn with_secret(mut self, name: &str, value: Option<&str>) -> Self {
        if let Some(value) = value.filter(|v| !v.is_empty()) {
            self.env.push(EnvVar {
                name: name.to_string(),
                value: value.to_string(),
                secret: true,
            });
            self.command = display_command(&self.args, &self.env);
        }
        self
    }

    /// The same, with secret values replaced for display.
    pub fn redacted(&self) -> RenderedServe {
        let mut copy = self.clone();
        for var in &mut copy.env {
            if var.secret {
                var.value = REDACTED.to_string();
            }
        }
        copy
    }

    pub fn env_pairs(&self) -> Vec<(String, String)> {
        self.env
            .iter()
            .map(|v| (v.name.clone(), v.value.clone()))
            .collect()
    }
}

/// Splits `1.2.0`, `1.0`, `v1.10.3rc1` into numeric components.
pub fn parse_version_parts(version: &str) -> Vec<u32> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .map_while(|part| {
            let digits: String = part.chars().take_while(char::is_ascii_digit).collect();
            digits.parse::<u32>().ok()
        })
        .collect()
}

/// `installed >= needed`, comparing numerically with missing parts as 0.
pub fn version_at_least(installed: &str, needed: &str) -> bool {
    let a = parse_version_parts(installed);
    let b = parse_version_parts(needed);
    let len = a.len().max(b.len());
    for i in 0..len {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    true
}

/// Formats a JSON number like JavaScript's `String(n)` for ordinary values.
pub fn format_number(number: &serde_json::Number) -> String {
    if let Some(i) = number.as_i64() {
        return i.to_string();
    }
    if let Some(u) = number.as_u64() {
        return u.to_string();
    }
    match number.as_f64() {
        Some(f) if f.is_finite() && f.fract() == 0.0 && f.abs() < 1e15 => {
            format!("{}", f as i64)
        }
        Some(f) => format!("{f}"),
        None => number.to_string(),
    }
}

fn is_safe_shell_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || "_@%+=:,./-".contains(c)
}

/// POSIX shell quoting of one value: safe values unchanged, others in
/// single quotes; `""` is `''`.
pub fn shell_quote(value: &str) -> String {
    if !value.is_empty() && value.chars().all(is_safe_shell_char) {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

/// A `--name=value` token with only the value quoted; bare tokens as is.
fn quote_token(token: &str) -> String {
    match token.split_once('=') {
        Some((name, value)) if name.starts_with("--") => format!("{name}={}", shell_quote(value)),
        _ => token.to_string(),
    }
}

/// One value, normalized.
enum Rendered {
    Omit,
    Switch,
    Values(Vec<String>),
}

fn invalid(message: String) -> AppError {
    AppError::InvalidRequest(message)
}

fn scalar_text(param: &ServeParam, value: &Value) -> AppResult<Option<String>> {
    let text = match value {
        Value::Null => return Ok(None),
        Value::String(s) => s.clone(),
        Value::Number(n) => format_number(n),
        Value::Bool(_) => {
            return Err(invalid(format!(
                "`{}` takes a value, not true/false",
                param.key
            )))
        }
        Value::Array(_) | Value::Object(_) => {
            return Err(invalid(format!("`{}` takes a single value", param.key)))
        }
    };
    if text.contains('\0') {
        return Err(invalid(format!("`{}` contains a NUL byte", param.key)));
    }
    Ok(Some(text))
}

fn check_choice(param: &ServeParam, text: &str) -> AppResult<()> {
    if param.kind != "enum" {
        return Ok(());
    }
    let Some(choices) = &param.choices else {
        return Ok(());
    };
    let allowed: Vec<&str> = choices.iter().filter_map(|c| c.value.as_str()).collect();
    if allowed.contains(&text) {
        Ok(())
    } else {
        Err(invalid(format!(
            "`{}` must be one of {}; got `{text}`",
            param.key,
            allowed.join(", ")
        )))
    }
}

fn normalize(param: &ServeParam, value: &Value) -> AppResult<Rendered> {
    if param.kind == "boolean" {
        return match value {
            Value::Null | Value::Bool(false) => Ok(Rendered::Omit),
            Value::Bool(true) => Ok(Rendered::Switch),
            _ => Err(invalid(format!("`{}` must be true or false", param.key))),
        };
    }
    if param.multiple {
        let items: Vec<&Value> = match value {
            Value::Array(items) => items.iter().collect(),
            other => vec![other],
        };
        let mut out = Vec::new();
        for item in items {
            if let Some(text) = scalar_text(param, item)? {
                check_choice(param, &text)?;
                out.push(text);
            }
        }
        return Ok(if out.is_empty() {
            Rendered::Omit
        } else {
            Rendered::Values(out)
        });
    }
    match scalar_text(param, value)? {
        None => Ok(Rendered::Omit),
        Some(text) => {
            check_choice(param, &text)?;
            Ok(Rendered::Values(vec![text]))
        }
    }
}

fn check_version(param: &ServeParam, version: Option<&str>) -> AppResult<()> {
    if let (Some(installed), Some(needed)) = (version, param.min_version.as_deref()) {
        if !version_at_least(installed, needed) {
            return Err(AppError::VersionTooOld {
                setting: param.display_name(),
                needed: needed.to_string(),
                installed: installed.to_string(),
            });
        }
    }
    Ok(())
}

/// Validates `request` against the catalog and `version` (the installed
/// Splash, if known) and renders it. Secrets are added by the caller.
pub fn render(request: &ServeRequest, version: Option<&str>) -> AppResult<RenderedServe> {
    render_with(catalog()?, request, version)
}

pub fn render_with(
    catalog: &Catalog,
    request: &ServeRequest,
    version: Option<&str>,
) -> AppResult<RenderedServe> {
    let model = request.model.trim();
    if model.is_empty() {
        return Err(invalid("a model is required".into()));
    }
    if model.contains('\0') {
        return Err(invalid("the model contains a NUL byte".into()));
    }
    if request.port == 0 {
        return Err(invalid("port must be 1-65535".into()));
    }
    // --port is always passed, so its own version gate always applies.
    if let Some(port) = catalog.serve.iter().find(|p| p.key == "port") {
        check_version(port, version)?;
    }

    // Resolve and check every key first, so the error names the first bad
    // key whatever its value.
    let mut params: Vec<(&ServeParam, &Value)> = Vec::with_capacity(request.flags.len());
    for flag in &request.flags {
        let key = flag.key.as_str();
        if TOP_LEVEL_KEYS.contains(&key) {
            return Err(invalid(format!(
                "`{key}` is a top-level field of the request, not a flag (duplicate)"
            )));
        }
        if SECRET_KEYS.contains(&key) {
            return Err(invalid(format!(
                "`{key}` is a secret: Splashboard passes it from its own settings, never in flags"
            )));
        }
        let Some(param) = catalog
            .serve
            .iter()
            .find(|p| p.key == key && p.applies_to_serve())
        else {
            return Err(invalid(format!("unknown launch setting `{key}`")));
        };
        if params.iter().any(|(p, _)| p.key == key) {
            return Err(invalid(format!("launch setting `{key}` is given twice")));
        }
        params.push((param, &flag.value));
    }

    let mut args = vec![
        "serve".to_string(),
        format!("--model={model}"),
        format!("--port={}", request.port),
    ];
    let mut env: Vec<EnvVar> = Vec::new();

    for (param, value) in params {
        let rendered = normalize(param, value)?;
        if matches!(rendered, Rendered::Omit) {
            continue;
        }
        check_version(param, version)?;
        if param.passes_as_env() {
            let Some(name) = param.env.clone() else {
                return Err(invalid(format!(
                    "launch setting `{}` has neither a flag nor an env var",
                    param.key
                )));
            };
            let value = match rendered {
                Rendered::Switch => param.env_value_when_on(),
                Rendered::Values(values) => values.join(","),
                Rendered::Omit => continue,
            };
            env.push(EnvVar {
                name,
                value,
                secret: false,
            });
        } else {
            let Some(flag_name) = param.flag.as_deref() else {
                continue;
            };
            match rendered {
                Rendered::Switch => args.push(flag_name.to_string()),
                Rendered::Values(values) => {
                    for value in values {
                        args.push(format!("{flag_name}={value}"));
                    }
                }
                Rendered::Omit => {}
            }
        }
    }

    let command = display_command(&args, &env);
    Ok(RenderedServe { args, env, command })
}

/// `[NAME=value ...] splash <args>`, secrets as [`REDACTED`].
pub fn display_command(args: &[String], env: &[EnvVar]) -> String {
    let mut words: Vec<String> = env
        .iter()
        .map(|v| {
            if v.secret {
                format!("{}={REDACTED}", v.name)
            } else {
                format!("{}={}", v.name, shell_quote(&v.value))
            }
        })
        .collect();
    words.push("splash".to_string());
    words.extend(args.iter().map(|a| quote_token(a)));
    words.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(flags: Value) -> ServeRequest {
        serde_json::from_value(json!({
            "model": "incoai/Qwen3.8-27B-Splash",
            "port": 8012,
            "flags": flags
        }))
        .unwrap()
    }

    #[test]
    fn catalog_parses_and_matches_the_doc() {
        let catalog = catalog().unwrap();
        assert_eq!(catalog.version, "1.3.0");
        assert!(catalog.serve.iter().any(|p| p.key == "max_context"));
        // Embedded bytes are the file on disk (no stale copy).
        let on_disk = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/splash-params.json"),
        )
        .unwrap();
        assert_eq!(on_disk, CATALOG_JSON);
    }

    #[test]
    fn minimal_request() {
        let out = render(&request(json!([])), Some("1.2.0")).unwrap();
        assert_eq!(
            out.args,
            vec!["serve", "--model=incoai/Qwen3.8-27B-Splash", "--port=8012"]
        );
        assert!(out.env.is_empty());
        assert_eq!(
            out.command,
            "splash serve --model=incoai/Qwen3.8-27B-Splash --port=8012"
        );
    }

    #[test]
    fn renders_in_request_order_with_all_value_kinds() {
        let out = render(
            &request(json!([
                {"key": "allowed_origin", "value": ["tauri://localhost", "*"]},
                {"key": "offline", "value": true},
                {"key": "language_only", "value": false},
                {"key": "max_context", "value": "128K"},
                {"key": "decode_share", "value": 0.5},
                {"key": "queue_size", "value": 16.0},
                {"key": "kv_format", "value": "bf16"},
                {"key": "revision", "value": null},
                {"key": "crash_trace", "value": true},
                {"key": "hf_endpoint", "value": "https://hf.example/a b"}
            ])),
            Some("1.2.0"),
        )
        .unwrap();
        assert_eq!(
            out.args,
            vec![
                "serve",
                "--model=incoai/Qwen3.8-27B-Splash",
                "--port=8012",
                "--allowed-origin=tauri://localhost",
                "--allowed-origin=*",
                "--offline",
                "--max-context=128K",
                "--decode-share=0.5",
                "--queue-size=16",
                "--kv-format=bf16",
            ]
        );
        assert_eq!(
            out.env_pairs(),
            vec![
                ("SPLASH_CRASH_TRACE".to_string(), "1".to_string()),
                (
                    "HF_ENDPOINT".to_string(),
                    "https://hf.example/a b".to_string()
                ),
            ]
        );
        assert_eq!(
            out.command,
            "SPLASH_CRASH_TRACE=1 HF_ENDPOINT='https://hf.example/a b' splash serve \
             --model=incoai/Qwen3.8-27B-Splash --port=8012 \
             --allowed-origin=tauri://localhost --allowed-origin='*' --offline \
             --max-context=128K --decode-share=0.5 --queue-size=16 --kv-format=bf16"
        );
    }

    #[test]
    fn download_only_entries_are_refused() {
        let error = render(
            &request(json!([{"key": "hf_disable_progress_bars", "value": true}])),
            None,
        )
        .unwrap_err();
        assert!(error.to_string().contains("hf_disable_progress_bars"));
    }

    #[test]
    fn port_has_its_own_version_gate() {
        let error = render(&request(json!([])), Some("1.0")).unwrap_err();
        assert!(error.to_string().contains("--port"), "{error}");
        assert!(error.to_string().contains("1.0.1"), "{error}");
    }

    #[test]
    fn refuses_unknown_duplicate_secret_and_top_level_keys() {
        for flags in [
            json!([{"key": "turbo", "value": true}]),
            json!([{"key": "offline", "value": true}, {"key": "offline", "value": true}]),
            json!([{"key": "api_key", "value": "x"}]),
            json!([{"key": "hf_token", "value": "x"}]),
            json!([{"key": "model", "value": "a/b"}]),
            json!([{"key": "port", "value": 1}]),
        ] {
            let error = render(&request(flags.clone()), None).unwrap_err();
            assert!(
                matches!(error, AppError::InvalidRequest(_)),
                "{flags}: {error}"
            );
        }
    }

    #[test]
    fn refuses_bad_values() {
        for flags in [
            json!([{"key": "offline", "value": "yes"}]),
            json!([{"key": "max_context", "value": true}]),
            json!([{"key": "max_context", "value": ["1", "2"]}]),
            json!([{"key": "kv_format", "value": "fp4"}]),
            json!([{"key": "revision", "value": "a\u{0}b"}]),
        ] {
            assert!(render(&request(flags.clone()), None).is_err(), "{flags}");
        }
        let mut no_model = request(json!([]));
        no_model.model = "  ".into();
        assert!(render(&no_model, None).is_err());
        let mut no_port = request(json!([]));
        no_port.port = 0;
        assert!(render(&no_port, None).is_err());
    }

    #[test]
    fn version_gate_names_the_version_needed() {
        let error = render(
            &request(json!([{"key": "persistent_cache", "value": true}])),
            Some("1.1.0"),
        )
        .unwrap_err();
        match &error {
            AppError::VersionTooOld {
                setting,
                needed,
                installed,
            } => {
                assert_eq!(setting, "--persistent-cache");
                assert_eq!(needed, "1.2.0");
                assert_eq!(installed, "1.1.0");
            }
            other => panic!("unexpected {other:?}"),
        }
        assert!(error.to_string().contains("1.2.0"));
        // false/unset values are not gated.
        assert!(render(
            &request(json!([{"key": "persistent_cache", "value": false}])),
            Some("1.1.0")
        )
        .is_ok());
        assert!(render(
            &request(json!([{"key": "persistent_cache", "value": true}])),
            Some("1.2.0")
        )
        .is_ok());
    }

    #[test]
    fn secrets_are_env_only_and_redacted() {
        let out = render(
            &request(json!([{"key": "hf_endpoint", "value": "https://m.example"}])),
            None,
        )
        .unwrap()
        .with_secret("SPLASH_API_KEY", Some("s3cret"))
        .with_secret("HF_TOKEN", Some(""));
        assert_eq!(out.env.len(), 2);
        assert!(!out.command.contains("s3cret"));
        assert!(!out.args.iter().any(|a| a.contains("s3cret")));
        assert_eq!(
            out.command,
            format!(
                "HF_ENDPOINT=https://m.example SPLASH_API_KEY={REDACTED} splash serve \
                 --model=incoai/Qwen3.8-27B-Splash --port=8012"
            )
        );
        let shown = out.redacted();
        assert_eq!(shown.env[1].value, REDACTED);
        assert_eq!(shown.command, out.command);
        assert!(out
            .env_pairs()
            .contains(&("SPLASH_API_KEY".into(), "s3cret".into())));
    }

    #[test]
    fn helpers() {
        assert!(version_at_least("1.2.0", "1.2"));
        assert!(version_at_least("1.10.0", "1.2.0"));
        assert!(!version_at_least("1.0", "1.0.1"));
        assert!(version_at_least("v1.2.0rc1", "1.2.0"));
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(shell_quote(""), "''");
        assert_eq!(quote_token("--cache-dir=/a b"), "--cache-dir='/a b'");
        assert_eq!(quote_token("--offline"), "--offline");
        assert_eq!(quote_token("serve"), "serve");
        assert_eq!(
            format_number(&serde_json::Number::from_f64(3.0).unwrap()),
            "3"
        );
        assert_eq!(
            format_number(&serde_json::Number::from_f64(0.25).unwrap()),
            "0.25"
        );
    }

    /// The shared vectors (`src/lib/params/__fixtures__/serve-vectors.json`),
    /// also checked by vitest (`src/lib/params/serve.test.ts`). Skipped
    /// while the file does not exist; an unrecognized shape is reported and
    /// skipped; a value mismatch fails, naming the field.
    #[test]
    fn shared_serve_vectors() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src/lib/params/__fixtures__/serve-vectors.json");
        let Ok(text) = std::fs::read_to_string(&path) else {
            eprintln!("skipping: {} does not exist yet", path.display());
            return;
        };
        let root: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => panic!("{} is not valid JSON: {e}", path.display()),
        };
        if let Some(redacted) = root.get("redacted").and_then(Value::as_str) {
            assert_eq!(redacted, REDACTED, "redacted placeholder differs");
        }
        let cases = match &root {
            Value::Array(items) => items.clone(),
            Value::Object(map) => map
                .get("vectors")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            _ => Vec::new(),
        };
        if cases.is_empty() {
            eprintln!("skipping: no recognizable vectors in {}", path.display());
            return;
        }
        let mut checked = 0;
        for (index, case) in cases.iter().enumerate() {
            let name = case
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("#{index}"));
            // Vectors without a request are TS-only validation.
            let Some(request_value) = case.get("request") else {
                continue;
            };
            let request: ServeRequest = match serde_json::from_value(request_value.clone()) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("skipping vector {name}: request does not parse ({e})");
                    continue;
                }
            };
            let version = case.get("version").and_then(Value::as_str);
            let result = render(&request, version);

            if let Some(error) = case.get("error").filter(|e| !e.is_null()) {
                let Err(actual) = result else {
                    panic!("vector {name}: expected an error, got {result:?}");
                };
                let message = actual.to_string();
                if let Some(key) = error.get("key").and_then(Value::as_str) {
                    let param = catalog().unwrap().serve.iter().find(|p| p.key == key);
                    let names: Vec<String> = std::iter::once(key.to_string())
                        .chain(param.and_then(|p| p.flag.clone()))
                        .chain(param.and_then(|p| p.env.clone()))
                        .collect();
                    assert!(
                        names.iter().any(|n| message.contains(n.as_str())),
                        "vector {name}: error `{message}` does not name {names:?}"
                    );
                }
                if let Some(min) = error.get("min_version").and_then(Value::as_str) {
                    assert!(
                        message.contains(min),
                        "vector {name}: error `{message}` does not name {min}"
                    );
                }
                checked += 1;
                continue;
            }

            let mut out = match result {
                Ok(out) => out,
                Err(e) => panic!("vector {name}: unexpected error {e}"),
            };
            // The secrets Rust holds, in its fixed order.
            let held: Vec<&str> = case
                .get("secrets")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            for secret in ["SPLASH_API_KEY", "HF_TOKEN"] {
                if held.contains(&secret) {
                    out = out.with_secret(secret, Some("not-the-real-secret"));
                }
            }
            let shown = out.redacted();

            if let Some(argv) = case.get("argv").and_then(Value::as_array) {
                let argv: Vec<String> = argv
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect();
                assert_eq!(shown.args, argv, "vector {name}: argv differs");
            }
            if let Some(env) = case.get("env").and_then(Value::as_array) {
                let theirs: Vec<(String, String)> = env
                    .iter()
                    .filter_map(|pair| {
                        let pair = pair.as_array()?;
                        Some((
                            pair.first()?.as_str()?.to_string(),
                            pair.get(1)?.as_str()?.to_string(),
                        ))
                    })
                    .collect();
                assert_eq!(shown.env_pairs(), theirs, "vector {name}: env differs");
            }
            if let Some(command) = case.get("command").and_then(Value::as_str) {
                assert_eq!(shown.command, command, "vector {name}: command differs");
            }
            checked += 1;
        }
        assert!(checked > 0, "no vector was checked");
        eprintln!("checked {checked} shared serve vectors");
    }
}
