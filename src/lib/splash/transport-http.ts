/**
 * Browser-dev transport: fetches `/splash/*` on the Vite dev server, which
 * proxies to Splash with the Origin header removed (vite.config.ts). Lets the
 * UI run in a normal browser or Playwright without the Tauri webview.
 */
import { SplashHttpError, SplashTransportError, abortError, throwIfAborted } from './errors';
import { SseParser, isDoneEvent, type SseEvent } from './sse';
import type { SplashRequestInit, SplashResponse, SplashStreamInit, Transport } from './transport';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface HttpTransportOptions {
  /** URL prefix the dev proxy listens on. Default `/splash`. */
  basePath?: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export class HttpTransport implements Transport {
  readonly kind = 'http' as const;
  private readonly basePath: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpTransportOptions = {}) {
    this.basePath = (options.basePath ?? '/splash').replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
  }

  async request(init: SplashRequestInit): Promise<SplashResponse> {
    throwIfAborted(init.signal);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new SplashTransportError('request timed out', 'timeout')),
      init.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const onAbort = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await this.fetchImpl(this.url(init.path), {
        method: init.method ?? 'GET',
        headers: jsonHeaders(init.headers, init.body !== undefined),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      return {
        status: response.status,
        ok: response.ok,
        headers: headersToRecord(response.headers),
        body: await response.text(),
      };
    } catch (error) {
      throw toError(error, controller.signal, init.signal);
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', onAbort);
    }
  }

  async *stream(init: SplashStreamInit): AsyncGenerator<SseEvent> {
    throwIfAborted(init.signal);
    const controller = new AbortController();
    const onAbort = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(this.url(init.path), {
          method: 'POST',
          headers: { accept: 'text/event-stream', ...jsonHeaders(init.headers, true) },
          body: JSON.stringify(init.body ?? {}),
          signal: controller.signal,
        });
      } catch (error) {
        throw toError(error, controller.signal, init.signal);
      }
      const headers = headersToRecord(response.headers);
      if (!response.ok) {
        throw new SplashHttpError(response.status, await response.text(), headers);
      }
      init.onOpen?.({ status: response.status, headers });
      if (!response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser({ onComment: init.onComment });
      try {
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch (error) {
            throw toError(error, controller.signal, init.signal);
          }
          if (chunk.done) break;
          for (const event of parser.push(decoder.decode(chunk.value, { stream: true }))) {
            if (isDoneEvent(event)) return;
            yield event;
          }
        }
        for (const event of [...parser.push(decoder.decode()), ...parser.end()]) {
          if (isDoneEvent(event)) return;
          yield event;
        }
      } finally {
        reader.releaseLock();
      }
    } finally {
      init.signal?.removeEventListener('abort', onAbort);
      // Ends the HTTP request if the consumer stopped early.
      controller.abort();
    }
  }

  private url(path: string): string {
    if (!path.startsWith('/'))
      throw new SplashTransportError(`invalid path ${path}`, 'invalidRequest');
    return `${this.basePath}${path}`;
  }
}

function jsonHeaders(headers: Record<string, string> | undefined, hasBody: boolean) {
  return hasBody ? { 'content-type': 'application/json', ...headers } : { ...headers };
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function toError(error: unknown, internal: AbortSignal, external: AbortSignal | undefined): Error {
  if (external?.aborted) return abortError(external.reason);
  if (internal.aborted && internal.reason instanceof SplashTransportError) return internal.reason;
  if (error instanceof SplashTransportError || error instanceof SplashHttpError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SplashTransportError(`could not reach Splash: ${message}`, 'unreachable', {
    cause: error,
  });
}
