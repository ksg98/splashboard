/**
 * Errors raised by the Splash transport and client, and a classifier that
 * turns any of them into one `SplashErrorInfo` the UI can branch on.
 *
 * The transports (transport-http.ts, transport-tauri.ts) construct
 * `SplashHttpError(status, body, headers)` and `SplashTransportError(message,
 * kind)` directly, so those constructors must stay as they are.
 */

/** Splash answered with a non-2xx status. `body` is the raw response text. */
export class SplashHttpError extends Error {
  override readonly name = 'SplashHttpError';
  readonly status: number;
  readonly body: string;
  /** Lower-case header names. */
  readonly headers: Record<string, string>;

  constructor(status: number, body: string, headers: Record<string, string> = {}) {
    super(splashErrorMessage(body) ?? `Splash answered HTTP ${status}`);
    this.status = status;
    this.body = body;
    this.headers = headers;
  }

  /** `error.code` of the JSON body (e.g. `context_length_exceeded`), if any. */
  get code(): string | undefined {
    return splashErrorField(this.body, 'code');
  }

  /** `error.type` of the JSON body (`invalid_request_error`, `server_error`, ...). */
  get errorType(): string | undefined {
    return splashErrorField(this.body, 'type');
  }

  /** `Retry-After` in seconds (every Splash 503 carries `Retry-After: 1`). */
  get retryAfter(): number | undefined {
    return parseRetryAfter(this.headers['retry-after']);
  }
}

/**
 * Splash could not be reached or the request could not be made.
 * `kind` mirrors the Rust `AppError` kinds (src-tauri/src/error.rs:
 * `unreachable`, `timeout`, `http`, `invalidRequest`, `io`, `other`) plus
 * `network` for browser fetch failures and `invalidResponse` for bodies that
 * are not JSON.
 */
export class SplashTransportError extends Error {
  override readonly name = 'SplashTransportError';
  readonly kind: string;

  constructor(message: string, kind = 'network', options?: { cause?: unknown }) {
    super(message, options);
    this.kind = kind;
  }
}

/**
 * A `data: {"error":{...}}` frame inside a 200 event stream (the failure
 * happened after the headers were sent). Splash follows it with `[DONE]`.
 */
export class SplashStreamError extends Error {
  override readonly name = 'SplashStreamError';
  readonly code: string | undefined;
  readonly errorType: string | undefined;

  constructor(message: string, code?: string, errorType?: string) {
    super(message);
    this.code = code;
    this.errorType = errorType;
  }
}

export function abortError(reason?: unknown): DOMException {
  const message = typeof reason === 'string' ? reason : 'The operation was aborted';
  return new DOMException(message, 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    (error as { name?: string }).name === 'AbortError'
  );
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal.reason);
}

/** The `error.message` of an OpenAI/Anthropic-style error body, if present. */
export function splashErrorMessage(body: string): string | undefined {
  return splashErrorField(body, 'message');
}

function splashErrorField(body: string, field: 'message' | 'code' | 'type'): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const error = (parsed as { error: unknown }).error;
      if (error && typeof error === 'object' && field in error) {
        const value = (error as Record<string, unknown>)[field];
        if (typeof value === 'string') return value;
      }
    }
  } catch {
    // Not JSON.
  }
  return undefined;
}

/** Parses a `Retry-After` value (delta-seconds or an HTTP date) into seconds. */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * What went wrong, from the UI's point of view.
 *
 * - `unreachable`: connection refused / DNS / socket error. Splash is not
 *   running, or still in the launcher phase (docs/splash-api.md 4.2).
 * - `timeout`: no answer in time. During loading the socket is bound but not
 *   listening, so connects hang; also a busy or hung server.
 * - `aborted`: the caller cancelled.
 * - `forbidden-origin` / `forbidden-host`: 403 from Splash's Origin or Host
 *   check. Fix with `--allowed-origin` / `--allowed-host`.
 * - `unauthorized`: 401, missing or wrong API key.
 * - `context-length`: 400 `context_length_exceeded`.
 * - `bad-request`: any other 4xx with a JSON error body (message names the field).
 * - `not-found`: 404 (unknown route or `model_not_found`).
 * - `overloaded`: 503 `frontend_overloaded` (queue full), retry after `retryAfter`.
 * - `recovering`: 503 `engine_recovering`, retry shortly.
 * - `unavailable`: any other 503 (`server_shutdown`, `mask_timeout`, ...).
 * - `engine-failed`: 500 `engine_failed`; the server must be restarted.
 * - `server`: other 5xx.
 * - `stream`: an error frame inside a 200 stream.
 * - `invalid-response`: a body that is not what the API promises.
 * - `unknown`: anything else.
 */
export type SplashErrorKind =
  | 'unreachable'
  | 'timeout'
  | 'aborted'
  | 'forbidden-origin'
  | 'forbidden-host'
  | 'unauthorized'
  | 'context-length'
  | 'bad-request'
  | 'not-found'
  | 'overloaded'
  | 'recovering'
  | 'unavailable'
  | 'engine-failed'
  | 'server'
  | 'stream'
  | 'invalid-response'
  | 'unknown';

export interface SplashErrorInfo {
  kind: SplashErrorKind;
  /** Human-readable, usually Splash's own `error.message`. */
  message: string;
  /** HTTP status, when Splash answered. */
  status?: number;
  /** Splash `error.code`, or the transport kind for connection failures. */
  code?: string;
  /** Seconds to wait before retrying (from `Retry-After`). */
  retryAfter?: number;
  /** Retrying the same request later can succeed. */
  retryable: boolean;
}

const RETRYABLE_STREAM_CODES = new Set([
  'mask_timeout',
  'resource_timeout',
  'engine_recovering',
  'frontend_overloaded',
]);

/** Classifies any error thrown by a transport, the client or a stream. */
export function classifySplashError(error: unknown): SplashErrorInfo {
  if (isAbortError(error)) {
    return { kind: 'aborted', message: 'Cancelled', retryable: false };
  }
  if (error instanceof SplashHttpError) return classifyHttpError(error);
  if (error instanceof SplashStreamError) {
    return {
      kind: 'stream',
      message: error.message,
      code: error.code,
      retryable: error.code !== undefined && RETRYABLE_STREAM_CODES.has(error.code),
    };
  }
  if (error instanceof SplashTransportError) {
    const kind: SplashErrorKind =
      error.kind === 'timeout'
        ? 'timeout'
        : error.kind === 'invalidResponse'
          ? 'invalid-response'
          : error.kind === 'unreachable' || error.kind === 'network' || error.kind === 'http'
            ? 'unreachable'
            : 'unknown';
    return {
      kind,
      message: error.message,
      code: error.kind,
      retryable: kind === 'unreachable' || kind === 'timeout',
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: 'unknown', message, retryable: false };
}

function classifyHttpError(error: SplashHttpError): SplashErrorInfo {
  const { status } = error;
  const code = error.code;
  const base = { message: error.message, status, code, retryAfter: error.retryAfter };
  if (status === 401) return { ...base, kind: 'unauthorized', retryable: false };
  if (status === 403) {
    const host = /^Host\b/.test(error.message);
    return { ...base, kind: host ? 'forbidden-host' : 'forbidden-origin', retryable: false };
  }
  if (status === 404) return { ...base, kind: 'not-found', retryable: false };
  if (status === 503) {
    const kind: SplashErrorKind =
      code === 'frontend_overloaded'
        ? 'overloaded'
        : code === 'engine_recovering'
          ? 'recovering'
          : 'unavailable';
    return {
      ...base,
      kind,
      retryAfter: base.retryAfter ?? 1,
      retryable: code !== 'server_shutdown',
    };
  }
  if (status === 400 && code === 'context_length_exceeded') {
    return { ...base, kind: 'context-length', retryable: false };
  }
  if (status === 500 && code === 'engine_failed') {
    return { ...base, kind: 'engine-failed', retryable: false };
  }
  if (status >= 500) {
    return { ...base, kind: 'server', retryable: status === 504 || status === 502 };
  }
  if (status >= 400) {
    return { ...base, kind: 'bad-request', retryable: status === 408 || status === 429 };
  }
  return { ...base, kind: 'unknown', retryable: false };
}
