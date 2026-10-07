/**
 * Desktop transport: every request goes through the Rust commands in
 * src-tauri/src/transport/, which reach Splash on 127.0.0.1 without an
 * Origin header.
 */
import { Channel, invoke } from '@tauri-apps/api/core';
import { newId } from '../env';
import { SplashHttpError, SplashTransportError, abortError, throwIfAborted } from './errors';
import { SseParser, isDoneEvent, type SseEvent } from './sse';
import type { SplashRequestInit, SplashResponse, SplashStreamInit, Transport } from './transport';

/** Wire format of `splash_request`'s result (Rust `SplashHttpResponse`). */
interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Wire format of `splash_stream` channel messages (Rust `StreamEvent`). */
export type RawStreamEvent =
  | { event: 'start'; data: { status: number; headers: Record<string, string> } }
  | { event: 'chunk'; data: { text: string } }
  | { event: 'done'; data: { cancelled: boolean } }
  | { event: 'error'; data: { message: string; status: number | null; body: string | null } };

/** Rust `AppError` as it arrives in a rejected invoke. */
interface RawAppError {
  kind: string;
  message: string;
}

export class TauriTransport implements Transport {
  readonly kind = 'tauri' as const;

  async request(init: SplashRequestInit): Promise<SplashResponse> {
    throwIfAborted(init.signal);
    const call = invoke<RawResponse>('splash_request', {
      method: init.method ?? 'GET',
      path: init.path,
      headers: init.headers ?? null,
      body: init.body === undefined ? null : init.body,
      timeoutMs: init.timeoutMs ?? null,
    }).catch((error: unknown) => {
      throw fromInvokeError(error);
    });
    // The Rust request cannot be interrupted midway; abort just stops waiting.
    const response = await raceAbort(call, init.signal);
    return { ...response, ok: response.status >= 200 && response.status < 300 };
  }

  async *stream(init: SplashStreamInit): AsyncGenerator<SseEvent> {
    throwIfAborted(init.signal);
    const id = newId();
    const queue = new AsyncQueue<RawStreamEvent>();
    const channel = new Channel<RawStreamEvent>((message) => queue.push(message));
    let ended = false;
    const cancel = () => {
      invoke('splash_stream_cancel', { id }).catch(() => undefined);
    };
    init.signal?.addEventListener('abort', cancel, { once: true });

    invoke('splash_stream', {
      id,
      path: init.path,
      headers: init.headers ?? null,
      body: init.body === undefined ? {} : init.body,
      onEvent: channel,
    }).catch((error: unknown) => {
      const { message } = fromInvokeError(error);
      queue.push({ event: 'error', data: { message, status: null, body: null } });
    });

    const parser = new SseParser({ onComment: init.onComment });
    try {
      for await (const message of queue) {
        switch (message.event) {
          case 'start':
            init.onOpen?.(message.data);
            break;
          case 'chunk':
            for (const event of parser.push(message.data.text)) {
              if (isDoneEvent(event)) return;
              yield event;
            }
            break;
          case 'done':
            ended = true;
            if (message.data.cancelled) throw abortError(init.signal?.reason);
            for (const event of parser.end()) {
              if (isDoneEvent(event)) return;
              yield event;
            }
            return;
          case 'error':
            ended = true;
            if (message.data.status !== null) {
              throw new SplashHttpError(message.data.status, message.data.body ?? '');
            }
            throw new SplashTransportError(message.data.message, 'unreachable');
        }
      }
    } finally {
      init.signal?.removeEventListener('abort', cancel);
      queue.close();
      // Consumer stopped early (break, [DONE], exception): end the request.
      if (!ended) cancel();
    }
  }
}

function fromInvokeError(error: unknown): SplashTransportError {
  if (error && typeof error === 'object' && 'message' in error) {
    const raw = error as RawAppError;
    return new SplashTransportError(String(raw.message), raw.kind ?? 'other');
  }
  return new SplashTransportError(String(error), 'other');
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal.reason));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Push-to-pull bridge from a Tauri Channel callback to `for await`. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) {
          return Promise.resolve({ value: this.items.shift() as T, done: false });
        }
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
