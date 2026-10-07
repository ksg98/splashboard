//! `splash serve` log lines -> typed events -> lifecycle phases.
//!
//! Grammar: docs/splash-api.md section 4.4. Server lines are
//! `HH:MM:SS <Label>( · <field>)*`; launcher/installer and native-engine lines
//! have no timestamp. Pure functions only, so the fixtures can be replayed.

use serde::Serialize;

use super::events::{DownloadProgress, Phase};

pub const SEP: &str = " · ";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LogEvent {
    /// `Splash model <id> is already installed in <path>` /
    /// `Installed verified Splash model <id> in <link>`.
    Installed {
        model: String,
    },
    /// `Installing <id> as <family> (<format>); ...`.
    Installing {
        model: String,
    },
    /// `Fetching <n> file(s), <X.XX> GB, from <repo>@<rev>; cached files are reused.`
    Fetching {
        files: u32,
        total_bytes: u64,
        repo: String,
    },
    /// `Another Splash model installation is running; waiting...`
    WaitingForInstall,
    Loading {
        model: String,
    },
    ChatTemplate,
    WeightsLoaded {
        seconds: f64,
    },
    KernelPolicy {
        gpu_family: Option<u32>,
        cores: Option<u32>,
    },
    Ready {
        model: String,
        /// As printed: `256K` or `102,393`.
        context: Option<String>,
        context_tokens: Option<u64>,
        language_only: bool,
        url: Option<String>,
    },
    RequestDone {
        cancelled: bool,
        input: Option<u64>,
        cached: Option<u64>,
        output: Option<u64>,
        ttft_s: Option<f64>,
        tok_s: Option<f64>,
    },
    /// `Error · <code> · <METHOD> <path>`: an API error answered to a client.
    ApiError {
        code: String,
        method: String,
        path: String,
    },
    /// `Error · <code>`: one request failed at runtime.
    RequestError {
        code: String,
    },
    Refused {
        origin: Option<String>,
    },
    Warning {
        message: String,
    },
    WeightsReleased,
    WeightsRestored {
        seconds: Option<f64>,
    },
    /// `Engine failed · <e>` or `Engine restart failed · <e>`: Splash is
    /// relaunching its native engine.
    EngineFailed {
        message: String,
    },
    /// `Engine stopped · <why>`: Splash gave up relaunching (server alive).
    EngineStopped {
        message: String,
    },
    EngineRestarted,
    MemoryPaused,
    MemoryAvailable,
    Stopping,
    /// `Error · <message>` before exit: a fatal server error.
    FatalError {
        message: String,
    },
    /// `error: <message>`: a launcher error (exit 1 follows).
    LauncherError {
        message: String,
    },
    Other,
}

/// Strips a leading `HH:MM:SS ` and returns (time, rest).
pub fn split_timestamp(line: &str) -> (Option<&str>, &str) {
    let bytes = line.as_bytes();
    if bytes.len() > 9
        && bytes[2] == b':'
        && bytes[5] == b':'
        && bytes[8] == b' '
        && [0, 1, 3, 4, 6, 7]
            .iter()
            .all(|&i| bytes[i].is_ascii_digit())
    {
        (Some(&line[..8]), &line[9..])
    } else {
        (None, line)
    }
}

fn parse_count(text: &str) -> Option<u64> {
    text.trim().replace(',', "").parse().ok()
}

/// `256K` -> 262144, `102,393` -> 102393.
pub fn parse_context_tokens(text: &str) -> Option<u64> {
    let text = text.trim();
    if let Some(k) = text.strip_suffix('K') {
        return parse_count(k).map(|n| n * 1024);
    }
    parse_count(text)
}

fn first_number(text: &str) -> Option<f64> {
    let start = text.find(|c: char| c.is_ascii_digit())?;
    let rest = &text[start..];
    let end = rest
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(rest.len());
    rest[..end].trim_end_matches('.').parse().ok()
}

const HTTP_METHODS: &[&str] = &["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

fn parse_request_done(fields: &[&str], cancelled: bool) -> LogEvent {
    let mut done = (None, None, None, None, None);
    for field in fields {
        let field = field.trim();
        if let Some(v) = field.strip_prefix("input ") {
            done.0 = parse_count(v);
        } else if let Some(v) = field.strip_prefix("cached ") {
            done.1 = parse_count(v);
        } else if let Some(v) = field.strip_prefix("output ") {
            done.2 = parse_count(v);
        } else if let Some(v) = field.strip_prefix("TTFT ") {
            done.3 = v.trim_end_matches('s').parse().ok();
        } else if let Some(v) = field.strip_suffix(" tok/s") {
            done.4 = v.parse().ok();
        }
    }
    LogEvent::RequestDone {
        cancelled,
        input: done.0,
        cached: done.1,
        output: done.2,
        ttft_s: done.3,
        tok_s: done.4,
    }
}

fn parse_ready(fields: &[&str]) -> LogEvent {
    let model = fields.get(1).map(|s| s.to_string()).unwrap_or_default();
    let mut context = None;
    let mut language_only = false;
    let mut url = None;
    for field in fields.iter().skip(2) {
        if let Some(c) = field.strip_prefix("context ") {
            context = Some(c.to_string());
        } else if *field == "language only" {
            language_only = true;
        } else if field.starts_with("http://") || field.starts_with("https://") {
            url = Some(field.to_string());
        }
    }
    LogEvent::Ready {
        model,
        context_tokens: context.as_deref().and_then(parse_context_tokens),
        context,
        language_only,
        url,
    }
}

fn parse_fetching(rest: &str) -> LogEvent {
    // Fetching 3 file(s), 16.43 GB, from owner/repo@0123456789ab; cached files are reused.
    let files = rest
        .strip_prefix("Fetching ")
        .and_then(|r| r.split_whitespace().next())
        .and_then(|n| n.parse().ok())
        .unwrap_or(0);
    let total_bytes = rest
        .split(", ")
        .find(|part| part.ends_with(" GB"))
        .and_then(|part| part.trim_end_matches(" GB").trim().parse::<f64>().ok())
        .map(|gb| (gb * 1e9).round() as u64)
        .unwrap_or(0);
    let repo = rest
        .split_once(" from ")
        .map(|(_, r)| r)
        .and_then(|r| r.split(['@', ';']).next())
        .unwrap_or_default()
        .trim()
        .to_string();
    LogEvent::Fetching {
        files,
        total_bytes,
        repo,
    }
}

/// Classifies one log line (stdout or stderr; the stream does not matter).
pub fn parse_line(line: &str) -> LogEvent {
    let (_time, rest) = split_timestamp(line.trim_end());
    let rest = rest.trim();
    let fields: Vec<&str> = rest.split(SEP).collect();
    let label = fields.first().copied().unwrap_or_default();

    match label {
        "Loading" => {
            return LogEvent::Loading {
                model: fields.get(1).map(|s| s.to_string()).unwrap_or_default(),
            }
        }
        "Chat template" => return LogEvent::ChatTemplate,
        "Ready" => return parse_ready(&fields),
        "Done" => return parse_request_done(&fields[1..], false),
        "Cancelled" => return parse_request_done(&fields[1..], true),
        "Refused" => {
            return LogEvent::Refused {
                origin: fields
                    .get(1)
                    .and_then(|f| f.strip_prefix("Origin "))
                    .map(str::to_string),
            }
        }
        "Warning" => {
            return LogEvent::Warning {
                message: fields[1..].join(SEP),
            }
        }
        "Stopping" => return LogEvent::Stopping,
        "Engine failed" | "Engine restart failed" => {
            return LogEvent::EngineFailed {
                message: fields[1..].join(SEP),
            }
        }
        "Engine stopped" => {
            return LogEvent::EngineStopped {
                message: fields[1..].join(SEP),
            }
        }
        "Engine restarted" => return LogEvent::EngineRestarted,
        "Error" => {
            if fields.len() == 3 {
                if let Some((method, path)) = fields[2].split_once(' ') {
                    if HTTP_METHODS.contains(&method) && path.starts_with('/') {
                        return LogEvent::ApiError {
                            code: fields[1].to_string(),
                            method: method.to_string(),
                            path: path.to_string(),
                        };
                    }
                }
            }
            let message = fields[1..].join(SEP);
            let is_code = fields.len() == 2
                && !message.is_empty()
                && message
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
            return if is_code {
                LogEvent::RequestError { code: message }
            } else {
                LogEvent::FatalError { message }
            };
        }
        _ => {}
    }

    if let Some(message) = rest.strip_prefix("error: ") {
        return LogEvent::LauncherError {
            message: message.to_string(),
        };
    }
    if let Some(message) = rest.strip_prefix("Warning: ") {
        return LogEvent::Warning {
            message: message.to_string(),
        };
    }
    if rest.starts_with("Weights loaded in ") {
        return LogEvent::WeightsLoaded {
            seconds: first_number(rest).unwrap_or(0.0),
        };
    }
    if let Some(policy) = rest.strip_prefix("Kernel policy for GPU family ") {
        let mut words = policy.split_whitespace();
        let gpu_family = words.next().and_then(|w| w.parse().ok());
        let cores = policy
            .split_once(" with ")
            .and_then(|(_, r)| r.split_whitespace().next())
            .and_then(|w| w.parse().ok());
        return LogEvent::KernelPolicy { gpu_family, cores };
    }
    if rest.starts_with("Weights released after ") {
        return LogEvent::WeightsReleased;
    }
    if let Some(r) = rest.strip_prefix("Weights restored in ") {
        return LogEvent::WeightsRestored {
            seconds: first_number(r),
        };
    }
    if rest.starts_with("Memory: growth paused") {
        return LogEvent::MemoryPaused;
    }
    if rest.starts_with("Memory: growth available") {
        return LogEvent::MemoryAvailable;
    }
    if rest.starts_with("Fetching ") && rest.contains(" file(s), ") {
        return parse_fetching(rest);
    }
    if let Some(r) = rest.strip_prefix("Splash model ") {
        if let Some((model, _)) = r.split_once(" is already installed") {
            return LogEvent::Installed {
                model: model.to_string(),
            };
        }
    }
    if let Some(r) = rest.strip_prefix("Installed verified Splash model ") {
        return LogEvent::Installed {
            model: r.split(" in ").next().unwrap_or_default().to_string(),
        };
    }
    if let Some(r) = rest.strip_prefix("Installing ") {
        if let Some((model, _)) = r.split_once(" as ") {
            return LogEvent::Installing {
                model: model.to_string(),
            };
        }
    }
    if rest.starts_with("Another Splash model installation is running") {
        return LogEvent::WaitingForInstall;
    }
    LogEvent::Other
}

/// Phases before the HTTP listener is up.
pub fn is_pre_ready(phase: &Phase) -> bool {
    matches!(
        phase,
        Phase::Starting | Phase::Downloading { .. } | Phase::LoadingWeights | Phase::Warming
    )
}

/// Phases in which the listener is up and the server is alive.
pub fn is_serving(phase: &Phase) -> bool {
    matches!(
        phase,
        Phase::Ready
            | Phase::Busy
            | Phase::IdleReleased
            | Phase::Restoring
            | Phase::Recovering { .. }
    )
}

/// The phase a log event moves the engine to, or `None` to stay.
/// `Failed` from `Engine stopped` comes back without log lines; the
/// supervisor fills them in.
pub fn apply(phase: &Phase, event: &LogEvent) -> Option<Phase> {
    let next = match event {
        LogEvent::Fetching {
            files,
            total_bytes,
            repo,
        } if matches!(phase, Phase::Starting | Phase::Downloading { .. }) => Phase::Downloading {
            progress: Some(DownloadProgress {
                repo: repo.clone(),
                files: *files,
                total_bytes: *total_bytes,
                done_bytes: 0,
                fraction: (*total_bytes > 0).then_some(0.0),
            }),
        },
        LogEvent::Loading { .. } if is_pre_ready(phase) && *phase != Phase::Warming => {
            Phase::LoadingWeights
        }
        LogEvent::WeightsLoaded { .. } | LogEvent::KernelPolicy { .. } if is_pre_ready(phase) => {
            Phase::Warming
        }
        LogEvent::Ready { .. }
            if is_pre_ready(phase) || matches!(phase, Phase::Recovering { .. }) =>
        {
            Phase::Ready
        }
        LogEvent::WeightsReleased if matches!(phase, Phase::Ready | Phase::Busy) => {
            Phase::IdleReleased
        }
        LogEvent::WeightsRestored { .. }
            if matches!(phase, Phase::IdleReleased | Phase::Restoring) =>
        {
            Phase::Ready
        }
        LogEvent::EngineFailed { message } if is_serving(phase) => Phase::Recovering {
            reason: Some(message.clone()),
        },
        LogEvent::EngineRestarted if matches!(phase, Phase::Recovering { .. }) => Phase::Ready,
        LogEvent::EngineStopped { message } if is_serving(phase) => Phase::Failed {
            reason: message.clone(),
            exit_code: None,
            signal: None,
            last_log_lines: Vec::new(),
        },
        LogEvent::Stopping if is_pre_ready(phase) || is_serving(phase) => Phase::Stopping,
        _ => return None,
    };
    (next != *phase).then_some(next)
}

/// The most useful explanation for an exit, from the newest matching line:
/// a launcher `error:`, a fatal `Error · <message>`, or `Engine stopped`.
pub fn failure_reason<'a>(lines: impl DoubleEndedIterator<Item = &'a str>) -> Option<String> {
    lines.rev().find_map(|line| match parse_line(line) {
        LogEvent::LauncherError { message } => Some(message),
        LogEvent::FatalError { message } => Some(message),
        LogEvent::EngineStopped { message } => Some(message),
        _ => None,
    })
}

/// True when the newest error line is a launcher error (bad flag, busy port,
/// failed download): restarting would only fail again.
pub fn is_launcher_failure<'a>(lines: impl DoubleEndedIterator<Item = &'a str>) -> bool {
    lines
        .rev()
        .find_map(|line| match parse_line(line) {
            LogEvent::LauncherError { .. } => Some(true),
            LogEvent::FatalError { .. } | LogEvent::EngineStopped { .. } => Some(false),
            _ => None,
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures/splash-1.2.0")
            .join(name);
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    }

    /// Replays a log from `Starting` and returns each phase entered.
    fn replay(log: &str) -> Vec<&'static str> {
        let mut phase = Phase::Starting;
        let mut seen = vec![phase.name()];
        for line in log.lines() {
            if let Some(next) = apply(&phase, &parse_line(line)) {
                phase = next;
                seen.push(phase.name());
            }
        }
        seen
    }

    #[test]
    fn serve_log_phases() {
        assert_eq!(
            replay(&fixture("serve.log")),
            vec![
                "starting",
                "loading_weights",
                "warming",
                "ready",
                "stopping"
            ]
        );
    }

    #[test]
    fn idle_release_log_phases() {
        assert_eq!(
            replay(&fixture("serve_idle_release.log")),
            vec![
                "starting",
                "loading_weights",
                "warming",
                "ready",
                "idle_released",
                "ready",
                "stopping"
            ]
        );
    }

    #[test]
    fn cors_log_phases_and_refusal() {
        let log = fixture("serve_cors_apikey.log");
        assert_eq!(
            replay(&log),
            vec![
                "starting",
                "loading_weights",
                "warming",
                "ready",
                "stopping"
            ]
        );
        assert!(log.lines().any(|l| parse_line(l)
            == LogEvent::Refused {
                origin: Some("http://localhost:3000".into())
            }));
    }

    #[test]
    fn port_in_use_log_is_a_launcher_failure() {
        let log = fixture("serve_port_in_use.log");
        assert_eq!(replay(&log), vec!["starting"]);
        let reason = failure_reason(log.lines()).unwrap();
        assert!(
            reason.starts_with("Splash is already serving (PID 75278"),
            "{reason}"
        );
        assert!(is_launcher_failure(log.lines()));
    }

    #[test]
    fn every_fixture_line_classifies() {
        let log = fixture("serve.log");
        let events: Vec<LogEvent> = log.lines().map(parse_line).collect();
        assert_eq!(
            events[0],
            LogEvent::Installed {
                model: "incoai/Qwen3.8-27B-Splash".into()
            }
        );
        assert_eq!(
            events[1],
            LogEvent::Loading {
                model: "incoai/Qwen3.8-27B-Splash".into()
            }
        );
        assert_eq!(events[2], LogEvent::ChatTemplate);
        assert_eq!(events[3], LogEvent::WeightsLoaded { seconds: 3.59 });
        assert_eq!(
            events[4],
            LogEvent::KernelPolicy {
                gpu_family: Some(9),
                cores: Some(40)
            }
        );
        assert_eq!(
            events[5],
            LogEvent::Ready {
                model: "incoai/Qwen3.8-27B-Splash".into(),
                context: Some("256K".into()),
                context_tokens: Some(262_144),
                language_only: false,
                url: Some("http://127.0.0.1:8011".into()),
            }
        );
        assert_eq!(
            events[6],
            LogEvent::RequestDone {
                cancelled: false,
                input: Some(62),
                cached: Some(0),
                output: Some(57),
                ttft_s: Some(0.6),
                tok_s: Some(75.2)
            }
        );
        assert!(events.contains(&LogEvent::ApiError {
            code: "context_length_exceeded".into(),
            method: "POST".into(),
            path: "/v1/chat/completions".into()
        }));
        assert!(events.iter().any(|e| matches!(
            e,
            LogEvent::RequestDone {
                cancelled: true,
                ..
            }
        )));
        assert!(events.contains(&LogEvent::RequestDone {
            cancelled: false,
            input: Some(13_116),
            cached: Some(0),
            output: Some(4),
            ttft_s: Some(71.6),
            tok_s: None
        }));
        assert_eq!(events.last(), Some(&LogEvent::Stopping));
        // Nothing in a normal log is a failure.
        assert_eq!(failure_reason(log.lines()), None);
        let idle = fixture("serve_idle_release.log");
        assert!(idle.lines().any(|l| parse_line(l)
            == LogEvent::WeightsRestored {
                seconds: Some(3.07)
            }));
    }

    #[test]
    fn source_lines_not_in_fixtures() {
        assert_eq!(
            parse_line("Fetching 3 file(s), 16.43 GB, from unsloth/Qwen3.8-27B-GGUF@0123456789ab; cached files are reused."),
            LogEvent::Fetching {
                files: 3,
                total_bytes: 16_430_000_000,
                repo: "unsloth/Qwen3.8-27B-GGUF".into()
            }
        );
        assert_eq!(
            parse_line(
                "01:02:03 Ready · a/b · context 102,393 · language only · http://0.0.0.0:8000"
            ),
            LogEvent::Ready {
                model: "a/b".into(),
                context: Some("102,393".into()),
                context_tokens: Some(102_393),
                language_only: true,
                url: Some("http://0.0.0.0:8000".into())
            }
        );
        assert_eq!(
            parse_line("01:02:03 Engine failed · native engine exited with signal 6"),
            LogEvent::EngineFailed {
                message: "native engine exited with signal 6".into()
            }
        );
        assert_eq!(
            parse_line("01:02:03 Engine restart failed · boom"),
            LogEvent::EngineFailed {
                message: "boom".into()
            }
        );
        assert_eq!(
            parse_line("01:02:03 Engine restarted"),
            LogEvent::EngineRestarted
        );
        assert!(matches!(
            parse_line("01:02:03 Engine stopped · the inference engine failed 3 times"),
            LogEvent::EngineStopped { .. }
        ));
        assert_eq!(
            parse_line("01:02:03 Error · runtime_error"),
            LogEvent::RequestError {
                code: "runtime_error".into()
            }
        );
        assert_eq!(
            parse_line(
                "01:02:03 Error · unable to start HTTP server: [Errno 48] Address already in use"
            ),
            LogEvent::FatalError {
                message: "unable to start HTTP server: [Errno 48] Address already in use".into()
            }
        );
        assert_eq!(
            parse_line("Memory: growth paused; waiting=1; suspended=0"),
            LogEvent::MemoryPaused
        );
        assert_eq!(
            parse_line("Another Splash model installation is running; waiting..."),
            LogEvent::WaitingForInstall
        );
        assert_eq!(
            parse_line("Installing a/b as qwen3.8-27b (gguf); draft c/d; vision enabled."),
            LogEvent::Installing {
                model: "a/b".into()
            }
        );
        assert_eq!(parse_line(""), LogEvent::Other);
        assert_eq!(parse_line("12:34:56"), LogEvent::Other);
    }

    #[test]
    fn recovery_and_download_transitions() {
        let fetching =
            parse_line("Fetching 1 file(s), 2.00 GB, from a/b@abc; cached files are reused.");
        let downloading = apply(&Phase::Starting, &fetching).unwrap();
        assert_eq!(downloading.name(), "downloading");
        assert_eq!(
            apply(&downloading, &parse_line("00:00:01 Loading · a/b")),
            Some(Phase::LoadingWeights)
        );
        let recovering = apply(&Phase::Busy, &parse_line("00:00:01 Engine failed · x")).unwrap();
        assert_eq!(recovering.name(), "recovering");
        assert_eq!(
            apply(&recovering, &parse_line("00:00:02 Engine restarted")),
            Some(Phase::Ready)
        );
        let failed = apply(
            &recovering,
            &parse_line("00:00:02 Engine stopped · gave up"),
        )
        .unwrap();
        assert_eq!(failed.name(), "failed");
        // Lines that do not apply leave the phase alone.
        assert_eq!(
            apply(&Phase::Ready, &parse_line("00:00:01 Loading · a/b")),
            None
        );
        assert_eq!(
            apply(&Phase::Stopped, &parse_line("00:00:01 Stopping · x")),
            None
        );
        assert!(!is_launcher_failure(
            ["00:00:01 Error · boom happened"].into_iter()
        ));
    }
}
