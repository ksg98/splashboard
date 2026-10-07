//! Tauri commands for the Splash HTTP transport. The frontend wrapper is
//! `src/lib/splash/transport.ts` (`TauriTransport`).

use std::collections::HashMap;
use std::time::Duration;

use tauri::ipc::Channel;
use tauri::State;

use super::{
    SplashHttpResponse, SplashTransport, StreamEvent, TransportConfigPatch, TransportConfigView,
};
use crate::error::AppResult;

/// One request/response exchange with Splash.
/// JS: `invoke('splash_request', { method, path, headers?, body?, timeoutMs? })`
#[tauri::command]
pub async fn splash_request(
    transport: State<'_, SplashTransport>,
    method: String,
    path: String,
    headers: Option<HashMap<String, String>>,
    body: Option<serde_json::Value>,
    timeout_ms: Option<u64>,
) -> AppResult<SplashHttpResponse> {
    transport
        .request(
            &method,
            &path,
            headers,
            body,
            timeout_ms.map(Duration::from_millis),
        )
        .await
}

/// POSTs a JSON body and streams the response back over `onEvent`. Resolves
/// once the stream has ended (after its `done`/`error` event).
/// JS: `invoke('splash_stream', { id, path, headers?, body?, onEvent: channel })`
#[tauri::command]
pub async fn splash_stream(
    transport: State<'_, SplashTransport>,
    id: String,
    path: String,
    headers: Option<HashMap<String, String>>,
    body: Option<serde_json::Value>,
    on_event: Channel<StreamEvent>,
) -> AppResult<()> {
    transport
        .stream(&id, &path, headers, body, |event| {
            on_event.send(event).is_ok()
        })
        .await
}

/// JS: `invoke('splash_stream_cancel', { id })`
#[tauri::command]
pub fn splash_stream_cancel(transport: State<'_, SplashTransport>, id: String) {
    transport.cancel(&id);
}

/// JS: `invoke('splash_config_get')`
#[tauri::command]
pub fn splash_config_get(transport: State<'_, SplashTransport>) -> TransportConfigView {
    transport.view()
}

/// JS: `invoke('splash_config_set', { patch: { port?, apiKey? } })`
#[tauri::command]
pub fn splash_config_set(
    transport: State<'_, SplashTransport>,
    patch: TransportConfigPatch,
) -> AppResult<TransportConfigView> {
    transport.update(patch)
}
