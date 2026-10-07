/**
 * Typed Splash client over a `Transport` (docs/splash-api.md). Features use
 * `getSplashClient()`.
 *
 * Errors: non-2xx answers throw `SplashHttpError` (`status`, `code`,
 * `retryAfter`), connection failures throw `SplashTransportError` (`kind`
 * `unreachable` | `timeout` | ...), aborts throw an AbortError. Use
 * `classifySplashError(error)` for one UI-facing verdict: unreachable vs 403
 * origin vs 401 vs a 4xx body vs 503 with Retry-After.
 *
 * Chat: `chatTurn()` is the one the chat screen wants (typed `TurnEvent`s
 * for `reduceTurn`, never throws). `chatStream()` yields the raw chunks.
 */
import { streamTurn, type StreamTurnOptions, type TurnEvent } from './chat-stream';
import {
  SplashHttpError,
  SplashStreamError,
  SplashTransportError,
  classifySplashError,
  type SplashErrorInfo,
} from './errors';
import { getTransport, type Transport } from './transport';
import type {
  ApplyTemplateRequest,
  ApplyTemplateResponse,
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionRequest,
  HealthResponse,
  ModelInfo,
  ModelsResponse,
  ReadyResponse,
  StatusResponse,
  StreamErrorFrame,
  TextCompletion,
  TextCompletionRequest,
  TokenizeRequest,
  TokenizeResponse,
} from './types';

export interface CallOptions {
  signal?: AbortSignal;
  /** Whole-request timeout in ms (transport default 30 s). */
  timeoutMs?: number;
  /** Extra headers (e.g. an API key in browser dev, where Rust does not add it). */
  headers?: Record<string, string>;
}

export interface StreamOptions {
  signal?: AbortSignal;
  /** Response headers arrived. */
  onOpen?: () => void;
  /** An SSE comment (keepalive) arrived: the request is alive but quiet. */
  onKeepalive?: () => void;
  headers?: Record<string, string>;
}

/**
 * Outcome of a readiness probe (`GET /ready` with a timeout of 1 s or less),
 * read against docs/splash-api.md 4.2-4.3:
 * - `ready`: 200, the engine accepts requests.
 * - `unavailable`: 503; the listener is up but the engine is recovering,
 *   under critical memory pressure, or its status is stale.
 * - `unreachable`: connection refused. Nothing listens: not started, still
 *   in the launcher phase (about the first 6 s), or stopped.
 * - `timeout`: no answer within the timeout. While loading and warming up
 *   Splash binds the port but does not listen, so connects hang; also a hung
 *   server. With a live child process this means "starting".
 * - `forbidden`: 403 from the Host/Origin check (`--allowed-origin`).
 * - `unauthorized`: 401 (only if a proxy in front requires a key; /ready is public).
 * - `error`: anything else.
 */
export type ReadinessState =
  'ready' | 'unavailable' | 'unreachable' | 'timeout' | 'forbidden' | 'unauthorized' | 'error';

export interface ReadinessProbe {
  state: ReadinessState;
  /** Wall time the probe took, in ms. */
  latencyMs: number;
  /** Set for every state except `ready` and `unavailable`. */
  error?: SplashErrorInfo;
}

/** Longest timeout `probe()` uses (a starting server makes connects hang). */
export const PROBE_TIMEOUT_MS = 1000;

export class SplashClient {
  constructor(private readonly transport: Transport) {}

  /** GET /health: the HTTP server is up (the model may still be loading). */
  health(options: CallOptions = {}): Promise<HealthResponse> {
    return this.getJson<HealthResponse>('/health', options);
  }

  /** GET /ready: whether the model accepts requests. Never throws on 503. */
  async ready(options: CallOptions = {}): Promise<ReadyResponse> {
    const response = await this.transport.request({ path: '/ready', ...options });
    if (response.status !== 200 && response.status !== 503) {
      throw new SplashHttpError(response.status, response.body, response.headers);
    }
    return parseJson<ReadyResponse>(response.body);
  }

  /**
   * Readiness probe with a timeout of at most `PROBE_TIMEOUT_MS` (default
   * and cap 1 s). Never throws except for an abort of `options.signal`.
   */
  async probe(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ReadinessProbe> {
    const timeoutMs = Math.min(options.timeoutMs ?? PROBE_TIMEOUT_MS, PROBE_TIMEOUT_MS);
    const started = Date.now();
    try {
      const ready = await this.ready({ signal: options.signal, timeoutMs });
      return {
        state: ready.status === 'ready' ? 'ready' : 'unavailable',
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      const info = classifySplashError(error);
      if (info.kind === 'aborted') throw error;
      const state: ReadinessState =
        info.kind === 'unreachable'
          ? 'unreachable'
          : info.kind === 'timeout'
            ? 'timeout'
            : info.kind === 'forbidden-origin' || info.kind === 'forbidden-host'
              ? 'forbidden'
              : info.kind === 'unauthorized'
                ? 'unauthorized'
                : 'error';
      return { state, latencyMs: Date.now() - started, error: info };
    }
  }

  /** GET /status: engine telemetry snapshot (needs the API key when one is set). */
  status(options: CallOptions = {}): Promise<StatusResponse> {
    return this.getJson<StatusResponse>('/status', options);
  }

  /** GET /v1/models */
  models(options: CallOptions = {}): Promise<ModelsResponse> {
    return this.getJson<ModelsResponse>('/v1/models', options);
  }

  /** GET /v1/models/{id} (the id may contain `/`). 404 `model_not_found` if unknown. */
  model(id: string, options: CallOptions = {}): Promise<ModelInfo> {
    const path = id.split('/').map(encodeURIComponent).join('/');
    return this.getJson<ModelInfo>(`/v1/models/${path}`, options);
  }

  /** GET /metrics: Prometheus text exposition. */
  async metrics(options: CallOptions = {}): Promise<string> {
    const response = await this.transport.request({ path: '/metrics', ...options });
    if (!response.ok) throw new SplashHttpError(response.status, response.body, response.headers);
    return response.body;
  }

  /** POST /v1/chat/completions without streaming. */
  chat(request: ChatCompletionRequest, options: CallOptions = {}): Promise<ChatCompletion> {
    const body: ChatCompletionRequest = { ...request, stream: false };
    delete body.stream_options;
    delete body.return_progress;
    return this.postJson<ChatCompletion>('/v1/chat/completions', body, options);
  }

  /**
   * POST /v1/chat/completions streaming, as typed turn events (see
   * chat-stream.ts). Failures and aborts become `error` / `cancelled`
   * events; it never throws.
   */
  chatTurn(
    request: ChatCompletionRequest,
    options: StreamTurnOptions = {},
  ): AsyncGenerator<TurnEvent, void, undefined> {
    return streamTurn(this.transport, request, options);
  }

  /**
   * POST /v1/chat/completions with `stream: true`, yielding parsed chunks.
   * Ends after `[DONE]`. Abort with `options.signal`. A mid-stream error
   * frame throws `SplashStreamError`.
   */
  async *chatStream(
    request: ChatCompletionRequest,
    options: StreamOptions = {},
  ): AsyncGenerator<ChatCompletionChunk> {
    const events = this.transport.stream({
      path: '/v1/chat/completions',
      body: { ...request, stream: true },
      signal: options.signal,
      headers: options.headers,
      onOpen: options.onOpen ? () => options.onOpen?.() : undefined,
      onComment: options.onKeepalive ? () => options.onKeepalive?.() : undefined,
    });
    for await (const event of events) {
      const chunk = parseJson<ChatCompletionChunk | StreamErrorFrame>(event.data);
      if ('error' in chunk) {
        const error = chunk.error ?? { message: 'Splash reported an error' };
        throw new SplashStreamError(
          typeof error.message === 'string' ? error.message : 'Splash reported an error',
          typeof error.code === 'string' ? error.code : undefined,
          typeof error.type === 'string' ? error.type : undefined,
        );
      }
      yield chunk;
    }
  }

  /** POST /v1/completions (Splash 1.2+), non-streaming. `max_tokens` defaults to 16 server-side. */
  completions(request: TextCompletionRequest, options: CallOptions = {}): Promise<TextCompletion> {
    return this.postJson<TextCompletion>('/v1/completions', { ...request, stream: false }, options);
  }

  /** POST /tokenize: token ids of `content` (pass a string or the full request). */
  tokenize(input: string | TokenizeRequest, options: CallOptions = {}): Promise<TokenizeResponse> {
    const body: TokenizeRequest = typeof input === 'string' ? { content: input } : input;
    return this.postJson<TokenizeResponse>('/tokenize', body, options);
  }

  /** POST /apply-template: the exact prompt the model would see. */
  applyTemplate(
    request: ApplyTemplateRequest,
    options: CallOptions = {},
  ): Promise<ApplyTemplateResponse> {
    return this.postJson<ApplyTemplateResponse>('/apply-template', request, options);
  }

  private async getJson<T>(path: string, options: CallOptions): Promise<T> {
    const response = await this.transport.request({ path, ...options });
    if (!response.ok) throw new SplashHttpError(response.status, response.body, response.headers);
    return parseJson<T>(response.body);
  }

  private async postJson<T>(path: string, body: unknown, options: CallOptions): Promise<T> {
    const response = await this.transport.request({ method: 'POST', path, body, ...options });
    if (!response.ok) throw new SplashHttpError(response.status, response.body, response.headers);
    return parseJson<T>(response.body);
  }
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new SplashTransportError(
      `Splash sent a response that is not JSON: ${text.slice(0, 120)}`,
      'invalidResponse',
      { cause },
    );
  }
}

let client: SplashClient | undefined;

/** The shared client on the environment's transport. */
export function getSplashClient(): SplashClient {
  client ??= new SplashClient(getTransport());
  return client;
}

/** Replaces the shared client (tests). Pass undefined to reset. */
export function setSplashClient(next: SplashClient | undefined): void {
  client = next;
}
