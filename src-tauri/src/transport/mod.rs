//! HTTP transport between the webview and the local Splash server.
//!
//! Splash refuses any request whose `Origin` header names an origin other than
//! its own (server/http_security.py), and the webview's origin
//! (`tauri://localhost`, or `http://localhost:1420` in dev) is never Splash's.
//! So the webview never fetches Splash itself: it calls the `splash_*`
//! commands, and this module talks to `http://127.0.0.1:<port>` with reqwest,
//! which sends no `Origin` header. The configured API key, if any, is added
//! here so it never has to live in the webview.

pub mod commands;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION};
use reqwest::{Method, RequestBuilder};
use serde::{Deserialize, Serialize};
use tokio::sync::Notify;

use crate::error::{AppError, AppResult};

pub const LOOPBACK: &str = "127.0.0.1";
pub const DEFAULT_PORT: u16 = 8000;
const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Headers a caller may not set: the transport owns them.
const BLOCKED_HEADERS: &[&str] = &[
    "origin",
    "host",
    "referer",
    "content-length",
    "connection",
    "transfer-encoding",
    "keep-alive",
    "upgrade",
];

#[derive(Debug, Clone)]
pub struct TransportConfig {
    pub port: u16,
    pub api_key: Option<String>,
}

impl Default for TransportConfig {
    fn default() -> Self {
        Self {
            port: DEFAULT_PORT,
            api_key: None,
        }
    }
}

/// What the frontend may see of the config: never the key itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportConfigView {
    pub port: u16,
    pub base_url: String,
    pub has_api_key: bool,
}

/// A partial update. `api_key: Some("")` clears the key; `None` leaves it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TransportConfigPatch {
    pub port: Option<u16>,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplashHttpResponse {
    pub status: u16,
    /// Lower-case header names; repeated headers are joined with ", ".
    pub headers: HashMap<String, String>,
    /// The body as text (JSON is parsed by the frontend client).
    pub body: String,
}

/// Events sent over the `splash_stream` channel, in order:
/// `start` (once, when response headers arrive with a 2xx status), then any
/// number of `chunk`s, then exactly one of `done` or `error`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "event",
    content = "data",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StreamEvent {
    Start {
        status: u16,
        headers: HashMap<String, String>,
    },
    /// Raw response text, decoded as UTF-8 across chunk boundaries. Not
    /// aligned to SSE events or lines: the frontend's SSE parser frames it.
    Chunk {
        text: String,
    },
    Done {
        cancelled: bool,
    },
    Error {
        message: String,
        /// HTTP status when Splash answered with a non-2xx response.
        status: Option<u16>,
        /// That response's body (usually a JSON error object).
        body: Option<String>,
    },
}

pub struct SplashTransport {
    client: reqwest::Client,
    config: Mutex<TransportConfig>,
    streams: Mutex<HashMap<String, Arc<Notify>>>,
}

impl SplashTransport {
    pub fn new() -> AppResult<Self> {
        let client = reqwest::Client::builder()
            // A system HTTP proxy must never see loopback traffic.
            .no_proxy()
            .connect_timeout(Duration::from_secs(5))
            .user_agent(concat!("Splashboard/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self {
            client,
            config: Mutex::new(TransportConfig::default()),
            streams: Mutex::new(HashMap::new()),
        })
    }

    pub fn config(&self) -> TransportConfig {
        self.config
            .lock()
            .expect("transport config poisoned")
            .clone()
    }

    pub fn view(&self) -> TransportConfigView {
        let config = self.config();
        TransportConfigView {
            port: config.port,
            base_url: base_url(config.port),
            has_api_key: config.api_key.is_some(),
        }
    }

    pub fn update(&self, patch: TransportConfigPatch) -> AppResult<TransportConfigView> {
        {
            let mut config = self.config.lock().expect("transport config poisoned");
            if let Some(port) = patch.port {
                if port == 0 {
                    return Err(AppError::InvalidRequest("port must be 1-65535".into()));
                }
                config.port = port;
            }
            if let Some(key) = patch.api_key {
                config.api_key = if key.is_empty() { None } else { Some(key) };
            }
        }
        Ok(self.view())
    }

    fn url(&self, path: &str) -> AppResult<String> {
        validate_path(path)?;
        Ok(format!("{}{}", base_url(self.config().port), path))
    }

    fn build(
        &self,
        method: Method,
        path: &str,
        headers: Option<HashMap<String, String>>,
        body: Option<serde_json::Value>,
    ) -> AppResult<RequestBuilder> {
        let url = self.url(path)?;
        let config = self.config();
        let headers = build_headers(headers.unwrap_or_default(), config.api_key.as_deref())?;
        let mut builder = self.client.request(method, url).headers(headers);
        if let Some(body) = body {
            builder = builder.json(&body);
        }
        Ok(builder)
    }

    pub async fn request(
        &self,
        method: &str,
        path: &str,
        headers: Option<HashMap<String, String>>,
        body: Option<serde_json::Value>,
        timeout: Option<Duration>,
    ) -> AppResult<SplashHttpResponse> {
        let method = Method::from_bytes(method.to_ascii_uppercase().as_bytes())
            .map_err(|_| AppError::InvalidRequest(format!("unknown HTTP method {method}")))?;
        let response = self
            .build(method, path, headers, body)?
            .timeout(timeout.unwrap_or(DEFAULT_REQUEST_TIMEOUT))
            .send()
            .await?;
        let status = response.status().as_u16();
        let headers = header_map(response.headers());
        let body = response.text().await?;
        Ok(SplashHttpResponse {
            status,
            headers,
            body,
        })
    }

    /// POSTs `body` to `path` and forwards the response through `emit` until
    /// it ends, fails, or `cancel(id)` is called. Every outcome is reported as
    /// an event; an `Err` means the request could not even be built.
    pub async fn stream<F>(
        &self,
        id: &str,
        path: &str,
        headers: Option<HashMap<String, String>>,
        body: Option<serde_json::Value>,
        emit: F,
    ) -> AppResult<()>
    where
        F: Fn(StreamEvent) -> bool,
    {
        let cancel = self.cancel_handle(id);
        let result = async {
            let mut headers = headers.unwrap_or_default();
            if !headers.keys().any(|k| k.eq_ignore_ascii_case("accept")) {
                headers.insert("accept".into(), "text/event-stream".into());
            }
            let request = self.build(Method::POST, path, Some(headers), body)?;
            run_stream(request, &cancel, &emit).await;
            Ok(())
        }
        .await;
        self.streams
            .lock()
            .expect("stream registry poisoned")
            .remove(id);
        result
    }

    /// Cancels the stream `id`. Safe to call before the stream has started
    /// (the cancellation is remembered) or after it has ended.
    pub fn cancel(&self, id: &str) {
        self.cancel_handle(id).notify_one();
    }

    fn cancel_handle(&self, id: &str) -> Arc<Notify> {
        self.streams
            .lock()
            .expect("stream registry poisoned")
            .entry(id.to_owned())
            .or_insert_with(|| Arc::new(Notify::new()))
            .clone()
    }
}

async fn run_stream<F>(request: RequestBuilder, cancel: &Notify, emit: &F)
where
    F: Fn(StreamEvent) -> bool,
{
    let response = tokio::select! {
        response = request.send() => response,
        _ = cancel.notified() => {
            emit(StreamEvent::Done { cancelled: true });
            return;
        }
    };
    let response = match response {
        Ok(response) => response,
        Err(error) => {
            emit(StreamEvent::Error {
                message: AppError::from(error).to_string(),
                status: None,
                body: None,
            });
            return;
        }
    };

    let status = response.status();
    if !status.is_success() {
        let body = tokio::select! {
            body = response.text() => body.ok(),
            _ = cancel.notified() => {
                emit(StreamEvent::Done { cancelled: true });
                return;
            }
        };
        emit(StreamEvent::Error {
            message: format!("Splash answered HTTP {}", status.as_u16()),
            status: Some(status.as_u16()),
            body,
        });
        return;
    }

    if !emit(StreamEvent::Start {
        status: status.as_u16(),
        headers: header_map(response.headers()),
    }) {
        return;
    }

    let mut bytes = response.bytes_stream();
    let mut pending: Vec<u8> = Vec::new();
    loop {
        tokio::select! {
            next = bytes.next() => match next {
                Some(Ok(chunk)) => {
                    pending.extend_from_slice(&chunk);
                    let text = decode_utf8(&mut pending, false);
                    if !text.is_empty() && !emit(StreamEvent::Chunk { text }) {
                        // The webview is gone: dropping the response closes the
                        // connection, which makes Splash cancel the job.
                        return;
                    }
                }
                Some(Err(error)) => {
                    emit(StreamEvent::Error {
                        message: AppError::from(error).to_string(),
                        status: None,
                        body: None,
                    });
                    return;
                }
                None => {
                    let text = decode_utf8(&mut pending, true);
                    if !text.is_empty() {
                        emit(StreamEvent::Chunk { text });
                    }
                    emit(StreamEvent::Done { cancelled: false });
                    return;
                }
            },
            _ = cancel.notified() => {
                emit(StreamEvent::Done { cancelled: true });
                return;
            }
        }
    }
}

pub fn base_url(port: u16) -> String {
    format!("http://{LOOPBACK}:{port}")
}

/// Accepts only an absolute path (with optional query) on the Splash server,
/// so a caller cannot point the transport at another host.
pub fn validate_path(path: &str) -> AppResult<()> {
    let ok = path.starts_with('/')
        && !path.starts_with("//")
        && !path.contains('\\')
        && !path.contains('#')
        && !path.contains("://")
        && path.chars().all(|c| !c.is_control() && !c.is_whitespace());
    if ok {
        Ok(())
    } else {
        Err(AppError::InvalidRequest(format!(
            "path must be an absolute path such as /v1/models, got {path:?}"
        )))
    }
}

fn build_headers(headers: HashMap<String, String>, api_key: Option<&str>) -> AppResult<HeaderMap> {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if BLOCKED_HEADERS.contains(&lower.as_str()) {
            continue;
        }
        let name = HeaderName::from_bytes(lower.as_bytes())
            .map_err(|_| AppError::InvalidRequest(format!("invalid header name {name:?}")))?;
        let value = HeaderValue::from_str(&value)
            .map_err(|_| AppError::InvalidRequest(format!("invalid value for header {name}")))?;
        map.insert(name, value);
    }
    // Splash accepts `Authorization: Bearer` or `x-api-key`, but refuses a
    // request whose credentials disagree, so never add one beside the other.
    if let Some(key) = api_key {
        if !map.contains_key(AUTHORIZATION) && !map.contains_key("x-api-key") {
            let mut value = HeaderValue::from_str(&format!("Bearer {key}"))
                .map_err(|_| AppError::InvalidRequest("API key is not valid ASCII".into()))?;
            value.set_sensitive(true);
            map.insert(AUTHORIZATION, value);
        }
    }
    Ok(map)
}

fn header_map(headers: &HeaderMap) -> HashMap<String, String> {
    let mut out: HashMap<String, String> = HashMap::new();
    for (name, value) in headers {
        let value = String::from_utf8_lossy(value.as_bytes()).into_owned();
        out.entry(name.as_str().to_owned())
            .and_modify(|existing| {
                existing.push_str(", ");
                existing.push_str(&value);
            })
            .or_insert(value);
    }
    out
}

/// Decodes as much of `pending` as forms complete UTF-8, leaving an incomplete
/// trailing sequence for the next chunk (unless `last`). Invalid bytes become
/// U+FFFD.
pub fn decode_utf8(pending: &mut Vec<u8>, last: bool) -> String {
    let mut out = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(text) => {
                out.push_str(text);
                pending.clear();
                return out;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                out.push_str(std::str::from_utf8(&pending[..valid]).unwrap_or_default());
                match error.error_len() {
                    Some(len) => {
                        out.push(char::REPLACEMENT_CHARACTER);
                        pending.drain(..valid + len);
                    }
                    None if last => {
                        out.push(char::REPLACEMENT_CHARACTER);
                        pending.clear();
                        return out;
                    }
                    None => {
                        pending.drain(..valid);
                        return out;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_utf8_keeps_split_sequences() {
        let bytes = "héllo 🌊".as_bytes();
        let mut pending = bytes[..2].to_vec(); // "h" + first byte of "é"
        assert_eq!(decode_utf8(&mut pending, false), "h");
        assert_eq!(pending.len(), 1);
        pending.extend_from_slice(&bytes[2..bytes.len() - 2]);
        assert_eq!(decode_utf8(&mut pending, false), "éllo ");
        pending.extend_from_slice(&bytes[bytes.len() - 2..]);
        assert_eq!(decode_utf8(&mut pending, false), "🌊");
        assert!(pending.is_empty());
    }

    #[test]
    fn decode_utf8_replaces_invalid_bytes() {
        let mut pending = vec![b'a', 0xff, b'b'];
        assert_eq!(decode_utf8(&mut pending, false), "a\u{fffd}b");
        let mut pending = vec![b'a', 0xe2, 0x82];
        assert_eq!(decode_utf8(&mut pending, true), "a\u{fffd}");
    }

    #[test]
    fn validate_path_rejects_other_hosts() {
        assert!(validate_path("/v1/models").is_ok());
        assert!(validate_path("/v1/models?x=1").is_ok());
        assert!(validate_path("v1/models").is_err());
        assert!(validate_path("//evil.example/x").is_err());
        assert!(validate_path("/x http://a").is_err());
        assert!(validate_path("/a#b").is_err());
    }

    #[test]
    fn headers_drop_origin_and_add_key_once() {
        let mut caller = HashMap::new();
        caller.insert("Origin".to_string(), "http://localhost:1420".to_string());
        caller.insert("X-Trace".to_string(), "1".to_string());
        let map = build_headers(caller, Some("secret")).unwrap();
        assert!(map.get("origin").is_none());
        assert_eq!(map.get("x-trace").unwrap(), "1");
        assert_eq!(map.get(AUTHORIZATION).unwrap(), "Bearer secret");

        let mut caller = HashMap::new();
        caller.insert("x-api-key".to_string(), "mine".to_string());
        let map = build_headers(caller, Some("secret")).unwrap();
        assert!(map.get(AUTHORIZATION).is_none());
    }

    #[test]
    fn stream_event_wire_format() {
        let json = serde_json::to_value(StreamEvent::Chunk { text: "hi".into() }).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"event": "chunk", "data": {"text": "hi"}})
        );
        let json = serde_json::to_value(StreamEvent::Done { cancelled: true }).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"event": "done", "data": {"cancelled": true}})
        );
    }

    use std::sync::Mutex as StdMutex;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// A one-connection HTTP server: sends `head`, then each part of `parts`
    /// with a short pause, then holds the socket for `hold`. Returns its port
    /// and the raw request it received.
    async fn serve_once(
        head: &'static str,
        parts: Vec<&'static [u8]>,
        hold: Duration,
    ) -> (u16, tokio::sync::oneshot::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 65536];
            let n = socket.read(&mut buf).await.unwrap();
            let _ = tx.send(String::from_utf8_lossy(&buf[..n]).into_owned());
            socket.write_all(head.as_bytes()).await.unwrap();
            for part in parts {
                socket.write_all(part).await.unwrap();
                socket.flush().await.unwrap();
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            tokio::time::sleep(hold).await;
        });
        (port, rx)
    }

    fn transport_on(port: u16, api_key: Option<&str>) -> SplashTransport {
        let transport = SplashTransport::new().unwrap();
        transport
            .update(TransportConfigPatch {
                port: Some(port),
                api_key: api_key.map(str::to_owned),
            })
            .unwrap();
        transport
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn streams_chunks_without_origin_header() {
        let (port, request) = serve_once(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n",
            vec![
                b"data: {\"a\":1}\n\n",
                b"data: h\xc3",
                b"\xa9\n\n",
                b"data: [DONE]\n\n",
            ],
            Duration::ZERO,
        )
        .await;
        let transport = transport_on(port, Some("k3y"));
        let events = StdMutex::new(Vec::new());
        let mut headers = HashMap::new();
        headers.insert("Origin".to_string(), "http://localhost:1420".to_string());
        transport
            .stream(
                "s1",
                "/v1/chat/completions",
                Some(headers),
                Some(serde_json::json!({"stream": true})),
                |e| {
                    events.lock().unwrap().push(e);
                    true
                },
            )
            .await
            .unwrap();

        let request = request.await.unwrap().to_ascii_lowercase();
        assert!(request.starts_with("post /v1/chat/completions http/1.1"));
        assert!(!request.contains("\r\norigin:"), "{request}");
        assert!(request.contains("authorization: bearer k3y"));
        assert!(request.contains("accept: text/event-stream"));

        let events = events.into_inner().unwrap();
        assert!(matches!(
            events.first(),
            Some(StreamEvent::Start { status: 200, .. })
        ));
        assert_eq!(events.last(), Some(&StreamEvent::Done { cancelled: false }));
        let text: String = events
            .iter()
            .filter_map(|e| match e {
                StreamEvent::Chunk { text } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(text, "data: {\"a\":1}\n\ndata: hé\n\ndata: [DONE]\n\n");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn reports_http_errors_with_body() {
        let (port, _request) = serve_once(
            "HTTP/1.1 403 Forbidden\r\ncontent-type: application/json\r\ncontent-length: 11\r\nconnection: close\r\n\r\n{\"e\":\"no\"}\n",
            vec![],
            Duration::ZERO,
        )
        .await;
        let transport = transport_on(port, None);
        let events = StdMutex::new(Vec::new());
        transport
            .stream("s2", "/v1/messages", None, None, |e| {
                events.lock().unwrap().push(e);
                true
            })
            .await
            .unwrap();
        let events = events.into_inner().unwrap();
        assert_eq!(events.len(), 1);
        assert!(matches!(
            &events[0],
            StreamEvent::Error { status: Some(403), body: Some(body), .. } if body.contains("no")
        ));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn cancel_ends_a_live_stream() {
        let (port, _request) = serve_once(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n",
            vec![b": splash-keepalive\n\n"],
            Duration::from_secs(30),
        )
        .await;
        let transport = Arc::new(transport_on(port, None));
        let canceller = transport.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            canceller.cancel("s3");
        });
        let events = StdMutex::new(Vec::new());
        tokio::time::timeout(
            Duration::from_secs(5),
            transport.stream("s3", "/v1/chat/completions", None, None, |e| {
                events.lock().unwrap().push(e);
                true
            }),
        )
        .await
        .expect("cancel should end the stream")
        .unwrap();
        let events = events.into_inner().unwrap();
        assert_eq!(events.last(), Some(&StreamEvent::Done { cancelled: true }));
        assert!(transport.streams.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn cancel_before_start_is_remembered() {
        let transport = SplashTransport::new().unwrap();
        transport.cancel("early");
        let handle = transport.cancel_handle("early");
        tokio::time::timeout(Duration::from_millis(200), handle.notified())
            .await
            .expect("pre-start cancellation should be pending");
    }
}
