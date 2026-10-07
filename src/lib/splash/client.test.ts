import { describe, expect, it, vi } from 'vitest';
import applyTemplateJson from '../../../fixtures/splash-1.2.0/apply_template.json';
import chatNonstreamJson from '../../../fixtures/splash-1.2.0/chat_nonstream.json';
import completionsJson from '../../../fixtures/splash-1.2.0/completions_nonstream.json';
import modelGetJson from '../../../fixtures/splash-1.2.0/model_get.json';
import thinkingSse from '../../../fixtures/splash-1.2.0/chat_stream_thinking.sse?raw';
import { reduceTurnEvents } from './chat-stream';
import { SplashClient, getSplashClient, setSplashClient } from './client';
import { SplashHttpError, SplashStreamError, SplashTransportError, abortError } from './errors';
import { replayTransport, sseRows } from './replay.testutil';
import type { SseEvent } from './sse';
import type { SplashRequestInit, SplashResponse, Transport } from './transport';

type Responder = Partial<SplashResponse> | ((init: SplashRequestInit) => Promise<SplashResponse>);

function fakeTransport(
  responses: Record<string, Responder>,
  events: SseEvent[] = [],
): Transport & {
  request: ReturnType<typeof vi.fn<(init: SplashRequestInit) => Promise<SplashResponse>>>;
  stream: ReturnType<typeof vi.fn>;
} {
  return {
    kind: 'http',
    request: vi.fn(async (init: SplashRequestInit) => {
      const response = responses[init.path] ?? {
        status: 404,
        body: '{"error":{"message":"nope","type":"not_found"}}',
      };
      if (typeof response === 'function') return response(init);
      const status = response.status ?? 200;
      return { status, ok: status >= 200 && status < 300, headers: {}, body: '', ...response };
    }),
    stream: vi.fn(async function* () {
      yield* events;
    }),
  };
}

const json = (value: unknown) => JSON.stringify(value);

describe('SplashClient', () => {
  it('reads health, status and models', async () => {
    const client = new SplashClient(
      fakeTransport({
        '/health': { body: '{"status":"ok"}' },
        '/status': { body: '{"schema_version":6,"ready":true}' },
        '/v1/models': {
          body: '{"object":"list","data":[{"id":"incoai/Qwen3.8-27B-Splash","object":"model","created":0,"owned_by":"splash"}]}',
        },
      }),
    );
    expect(await client.health()).toEqual({ status: 'ok' });
    expect((await client.status()).ready).toBe(true);
    expect((await client.models()).data[0]?.id).toBe('incoai/Qwen3.8-27B-Splash');
  });

  it('gets one model by an id containing a slash', async () => {
    const transport = fakeTransport({
      '/v1/models/incoai/Qwen3.8-27B-Splash': { body: json(modelGetJson) },
    });
    const model = await new SplashClient(transport).model('incoai/Qwen3.8-27B-Splash');
    expect(model.context_length).toBe(262144);
  });

  it('treats 503 from /ready as "unavailable", not an error', async () => {
    const client = new SplashClient(
      fakeTransport({ '/ready': { status: 503, body: '{"status":"unavailable"}' } }),
    );
    expect(await client.ready()).toEqual({ status: 'unavailable' });
  });

  it('raises SplashHttpError with the server message', async () => {
    const client = new SplashClient(fakeTransport({}));
    await expect(client.status()).rejects.toThrow(SplashHttpError);
    await expect(client.status()).rejects.toThrow('nope');
  });

  it('raises SplashTransportError for a body that is not JSON', async () => {
    const client = new SplashClient(fakeTransport({ '/health': { body: '<html>' } }));
    await expect(client.health()).rejects.toThrow(SplashTransportError);
  });

  it('posts chat (non-streaming), completions, tokenize and apply-template', async () => {
    const transport = fakeTransport({
      '/v1/chat/completions': { body: json(chatNonstreamJson) },
      '/v1/completions': { body: json(completionsJson) },
      '/tokenize': { body: '{"tokens":[9419,1814]}' },
      '/apply-template': { body: json(applyTemplateJson) },
    });
    const client = new SplashClient(transport);
    const chat = await client.chat({
      messages: [{ role: 'user', content: 'Name the primary colors.' }],
      stream: true,
      stream_options: { include_usage: true },
      return_progress: true,
    });
    expect(chat.choices[0]?.message.content).toBe('Red, yellow, and blue.');
    expect(chat.usage.prompt_tokens_details?.cached_tokens).toBe(32);
    const chatBody = transport.request.mock.calls[0]?.[0].body as Record<string, unknown>;
    expect(chatBody).toMatchObject({ stream: false });
    expect(chatBody).not.toHaveProperty('stream_options');
    expect(chatBody).not.toHaveProperty('return_progress');
    expect(transport.request.mock.calls[0]?.[0].method).toBe('POST');

    expect((await client.completions({ prompt: 'Hello', max_tokens: 8 })).object).toBe(
      'text_completion',
    );
    expect(await client.tokenize('Hello')).toEqual({ tokens: [9419, 1814] });
    expect(transport.request.mock.calls[2]?.[0].body).toEqual({ content: 'Hello' });
    const template = await client.applyTemplate({
      messages: [{ role: 'user', content: 'Hello' }],
      reasoning_effort: 'low',
    });
    expect(template.prompt.endsWith('<think>\n')).toBe(true);
  });

  it('streams parsed chat chunks with stream: true', async () => {
    const chunk = {
      id: 'c1',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'm',
      choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }],
    };
    const transport = fakeTransport({}, [{ event: 'message', data: JSON.stringify(chunk) }]);
    const client = new SplashClient(transport);
    const out = [];
    for await (const c of client.chatStream({ messages: [{ role: 'user', content: 'hello' }] })) {
      out.push(c.choices[0]?.delta.content);
    }
    expect(out).toEqual(['Hi']);
    expect(transport.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/v1/chat/completions',
        body: expect.objectContaining({ stream: true }),
      }),
    );
  });

  it('surfaces a mid-stream error event as SplashStreamError', async () => {
    const transport = fakeTransport({}, [
      {
        event: 'message',
        data: '{"error":{"message":"context too long","type":"invalid_request_error","code":"context_length_exceeded"}}',
      },
    ]);
    const iterate = async () => {
      for await (const _ of new SplashClient(transport).chatStream({ messages: [] })) {
        // drain
      }
    };
    await expect(iterate()).rejects.toThrow(SplashStreamError);
    await expect(iterate()).rejects.toThrow('context too long');
  });

  it('chatTurn yields typed turn events from the transport', async () => {
    const client = new SplashClient(replayTransport(sseRows(thinkingSse)));
    const events = [];
    for await (const event of client.chatTurn({ messages: [{ role: 'user', content: 'x' }] })) {
      events.push(event);
    }
    const state = reduceTurnEvents(events);
    expect(state.phase).toBe('done');
    expect(state.stats.completionTokens).toBe(57);
  });
});

describe('SplashClient.probe', () => {
  const probeWith = (responder: Responder) =>
    new SplashClient(fakeTransport({ '/ready': responder })).probe();

  it('passes a timeout of at most 1 s', async () => {
    const transport = fakeTransport({ '/ready': { body: '{"status":"ready"}' } });
    const client = new SplashClient(transport);
    await client.probe({ timeoutMs: 5000 });
    await client.probe({ timeoutMs: 300 });
    expect(transport.request.mock.calls.map((call) => call[0].timeoutMs)).toEqual([1000, 300]);
  });

  it('maps outcomes to readiness states', async () => {
    expect((await probeWith({ body: '{"status":"ready"}' })).state).toBe('ready');
    expect((await probeWith({ status: 503, body: '{"status":"unavailable"}' })).state).toBe(
      'unavailable',
    );
    const refused = await probeWith(() =>
      Promise.reject(new SplashTransportError('ECONNREFUSED', 'unreachable')),
    );
    expect(refused).toMatchObject({ state: 'unreachable', error: { kind: 'unreachable' } });
    expect(
      (await probeWith(() => Promise.reject(new SplashTransportError('timed out', 'timeout'))))
        .state,
    ).toBe('timeout');
    expect(
      (
        await probeWith({
          status: 403,
          body: '{"error":{"message":"Origin tauri://localhost is not allowed; restart the server with --allowed-origin tauri://localhost to accept it","type":"invalid_request_error","code":"forbidden"}}',
        })
      ).state,
    ).toBe('forbidden');
    expect((await probeWith({ status: 500, body: 'x' })).state).toBe('error');
  });

  it('rethrows an abort', async () => {
    await expect(probeWith(() => Promise.reject(abortError()))).rejects.toThrow();
  });
});

describe('getSplashClient', () => {
  it('can be replaced for tests', () => {
    const replacement = new SplashClient(fakeTransport({}));
    setSplashClient(replacement);
    expect(getSplashClient()).toBe(replacement);
    setSplashClient(undefined);
    expect(getSplashClient()).not.toBe(replacement);
    setSplashClient(undefined);
  });
});
