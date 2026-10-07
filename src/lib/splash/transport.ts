/**
 * How the app talks to the local Splash server.
 *
 * Splash refuses requests whose Origin is not its own, so the webview never
 * fetches it directly:
 * - `TauriTransport` (desktop app) calls the Rust commands `splash_request`,
 *   `splash_stream` and `splash_stream_cancel`; Rust makes the request
 *   without an Origin header and adds the API key.
 * - `HttpTransport` (browser dev, `pnpm web`) fetches `/splash/*`, which the
 *   Vite dev server proxies to Splash with the Origin header removed.
 *
 * `getTransport()` picks one automatically. Code above this layer
 * (src/lib/splash/client.ts, features) only ever sees the `Transport`
 * interface.
 */
import { isTauri } from '../env';
import type { SseEvent } from './sse';
import { HttpTransport } from './transport-http';
import { TauriTransport } from './transport-tauri';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export interface SplashRequestInit {
  /** Defaults to GET. */
  method?: HttpMethod;
  /** Absolute path on the Splash server, e.g. `/v1/models`. */
  path: string;
  headers?: Record<string, string>;
  /** Sent as JSON when present. */
  body?: unknown;
  signal?: AbortSignal;
  /** Defaults to 30 s. */
  timeoutMs?: number;
}

export interface SplashResponse {
  status: number;
  ok: boolean;
  /** Lower-case header names. */
  headers: Record<string, string>;
  /** Raw body text; see `client.ts` for JSON helpers. */
  body: string;
}

export interface StreamOpenInfo {
  status: number;
  headers: Record<string, string>;
}

export interface SplashStreamInit {
  /** POSTed to, e.g. `/v1/chat/completions`. */
  path: string;
  /** Sent as JSON. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Aborting cancels the request; the iterator then throws an AbortError. */
  signal?: AbortSignal;
  /** Called once the response headers arrive (time to first byte). */
  onOpen?: (info: StreamOpenInfo) => void;
  /** Called for SSE comments such as `: splash-keepalive`. */
  onComment?: (comment: string) => void;
}

export interface Transport {
  readonly kind: 'tauri' | 'http';
  /**
   * One request/response. Resolves for any HTTP status (check `ok`); rejects
   * with `SplashTransportError` when Splash cannot be reached, or an
   * AbortError.
   */
  request(init: SplashRequestInit): Promise<SplashResponse>;
  /**
   * POSTs and yields the response's SSE events. Iteration ends after
   * `data: [DONE]` (not yielded) or when the server closes the stream
   * (Anthropic-style streams end with `message_stop` and no [DONE]).
   * Throws `SplashHttpError` for a non-2xx response, `SplashTransportError`
   * for connection failures, and an AbortError when `signal` aborts.
   * Breaking out of the loop early cancels the request.
   */
  stream(init: SplashStreamInit): AsyncIterable<SseEvent>;
}

let current: Transport | undefined;

/** The transport for this environment (Tauri webview or browser). */
export function getTransport(): Transport {
  current ??= isTauri() ? new TauriTransport() : new HttpTransport();
  return current;
}

/** Replaces the transport (tests, or a custom setup). Pass undefined to reset. */
export function setTransport(transport: Transport | undefined): void {
  current = transport;
}

export { HttpTransport } from './transport-http';
export { TauriTransport } from './transport-tauri';
export { SplashHttpError, SplashTransportError, isAbortError } from './errors';
export type { SseEvent } from './sse';
