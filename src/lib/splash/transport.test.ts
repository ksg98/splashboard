import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAbortError, SplashHttpError, SplashTransportError } from './errors';
import type { SseEvent } from './sse';
import { getTransport, HttpTransport, setTransport, TauriTransport } from './transport';
import type { RawStreamEvent } from './transport-tauri';

// --- Tauri IPC mock ---------------------------------------------------------
const ipc = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => {
  class Channel<T> {
    onmessage: (message: T) => void;
    constructor(onmessage?: (message: T) => void) {
      this.onmessage = onmessage ?? (() => undefined);
    }
  }
  return { invoke: ipc.invoke, Channel };
});

function streamBody(chunks: string[], { delayMs = 0 } = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(iterable: AsyncIterable<SseEvent>): Promise<string[]> {
  const out: string[] = [];
  for await (const event of iterable) out.push(event.data);
  return out;
}

afterEach(() => {
  ipc.invoke.mockReset();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  setTransport(undefined);
});

describe('getTransport', () => {
  it('uses HTTP in a browser and Tauri in the webview', () => {
    expect(getTransport().kind).toBe('http');
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    setTransport(undefined);
    expect(getTransport().kind).toBe('tauri');
  });
});

describe('HttpTransport', () => {
  it('requests through the /splash proxy prefix', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response('{"status":"ok"}', { status: 200 }),
    );
    const transport = new HttpTransport({ fetch });
    const response = await transport.request({ path: '/health' });
    expect(fetch).toHaveBeenCalledWith(
      '/splash/health',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toMatchObject({ status: 200, ok: true, body: '{"status":"ok"}' });
  });

  it('streams SSE events and stops at [DONE]', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          streamBody([
            'data: {"n":1}\n',
            '\n: splash-keepalive\n\ndata: {"n":2}\n\nda',
            'ta: [DONE]\n\ndata: after\n\n',
          ]),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const onOpen = vi.fn();
    const onComment = vi.fn();
    const transport = new HttpTransport({ fetch });
    const data = await collect(
      transport.stream({ path: '/v1/chat/completions', body: { stream: true }, onOpen, onComment }),
    );
    expect(data).toEqual(['{"n":1}', '{"n":2}']);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
    expect(onComment).toHaveBeenCalledWith('splash-keepalive');
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"stream":true}');
  });

  it('throws SplashHttpError for a non-2xx stream response', async () => {
    const body = '{"error":{"message":"Origin refused","type":"forbidden"}}';
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body, { status: 403 }));
    const transport = new HttpTransport({ fetch });
    const error = await collect(transport.stream({ path: '/v1/messages' })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SplashHttpError);
    expect(error).toMatchObject({ status: 403, message: 'Origin refused' });
  });

  it('reports unreachable servers as SplashTransportError', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await new HttpTransport({ fetch })
      .request({ path: '/health' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SplashTransportError);
  });

  it('aborts a stream with the signal', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const signal = init?.signal;
      return new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('data: first\n\n'));
            signal?.addEventListener('abort', () => stream.error(signal.reason));
          },
        }),
        { status: 200 },
      );
    });
    const seen: string[] = [];
    const error = await (async () => {
      for await (const event of new HttpTransport({ fetch }).stream({
        path: '/v1/chat/completions',
        signal: controller.signal,
      })) {
        seen.push(event.data);
        controller.abort();
      }
    })().catch((e: unknown) => e);
    expect(seen).toEqual(['first']);
    expect(isAbortError(error)).toBe(true);
  });
});

describe('TauriTransport', () => {
  it('maps splash_request', async () => {
    ipc.invoke.mockResolvedValueOnce({
      status: 503,
      headers: {},
      body: '{"status":"unavailable"}',
    });
    const response = await new TauriTransport().request({ path: '/ready' });
    expect(ipc.invoke).toHaveBeenCalledWith('splash_request', {
      method: 'GET',
      path: '/ready',
      headers: null,
      body: null,
      timeoutMs: null,
    });
    expect(response.ok).toBe(false);
    expect(response.status).toBe(503);
  });

  it('turns channel events into SSE events', async () => {
    ipc.invoke.mockImplementation(async (cmd, args) => {
      if (cmd !== 'splash_stream') return undefined;
      const channel = args?.onEvent as { onmessage: (m: RawStreamEvent) => void };
      const send = (m: RawStreamEvent) => channel.onmessage(m);
      setTimeout(() => {
        send({ event: 'start', data: { status: 200, headers: {} } });
        send({ event: 'chunk', data: { text: 'event: message_start\ndata: {"a"' } });
        send({ event: 'chunk', data: { text: ':1}\n\n' } });
        send({ event: 'chunk', data: { text: 'event: message_stop\ndata: {}\n\n' } });
        send({ event: 'done', data: { cancelled: false } });
      }, 0);
      return undefined;
    });
    const data = await collect(new TauriTransport().stream({ path: '/v1/messages', body: {} }));
    expect(data).toEqual(['{"a":1}', '{}']);
    expect(ipc.invoke).not.toHaveBeenCalledWith('splash_stream_cancel', expect.anything());
  });

  it('raises HTTP errors from the channel', async () => {
    ipc.invoke.mockImplementation(async (cmd, args) => {
      if (cmd !== 'splash_stream') return undefined;
      const channel = args?.onEvent as { onmessage: (m: RawStreamEvent) => void };
      setTimeout(() =>
        channel.onmessage({
          event: 'error',
          data: {
            message: 'HTTP 400',
            status: 400,
            body: '{"error":{"message":"bad","type":"x"}}',
          },
        }),
      );
      return undefined;
    });
    const error = await collect(
      new TauriTransport().stream({ path: '/v1/chat/completions' }),
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'SplashHttpError', status: 400, message: 'bad' });
  });

  it('cancels the Rust stream when the consumer stops at [DONE]', async () => {
    ipc.invoke.mockImplementation(async (cmd, args) => {
      if (cmd !== 'splash_stream') return undefined;
      const channel = args?.onEvent as { onmessage: (m: RawStreamEvent) => void };
      setTimeout(() =>
        channel.onmessage({ event: 'chunk', data: { text: 'data: x\n\ndata: [DONE]\n\n' } }),
      );
      return undefined;
    });
    const data = await collect(new TauriTransport().stream({ path: '/v1/chat/completions' }));
    expect(data).toEqual(['x']);
    const streamId = (
      ipc.invoke.mock.calls.find(([cmd]) => cmd === 'splash_stream')?.[1] as {
        id: string;
      }
    ).id;
    expect(ipc.invoke).toHaveBeenCalledWith('splash_stream_cancel', { id: streamId });
  });
});
