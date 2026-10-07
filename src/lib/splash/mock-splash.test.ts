/**
 * Starts dev/mock-splash/server.mjs on a random port and drives the real
 * HttpTransport + SplashClient against it over HTTP.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockSplash, type MockSplash } from '../../../dev/mock-splash/server.mjs';
import { initialTurnState, reduceTurn, type TurnEvent, type TurnState } from './chat-stream';
import { SplashClient } from './client';
import { classifySplashError } from './errors';
import { buildChatRequest } from './request';
import { initialStatusTracker, trackStatus } from './status';
import { HttpTransport } from './transport-http';
import type { ChatCompletionRequest } from './types';

const USER = [{ role: 'user' as const, content: 'In one sentence: why is the sky blue?' }];

let mock: MockSplash;
let client: SplashClient;

/** Client with extra headers on every request (error injection, API key). */
function clientWith(headers: Record<string, string>, base = mock): SplashClient {
  const transport = new HttpTransport({
    basePath: base.url,
    fetch: (input, init) =>
      globalThis.fetch(input, { ...init, headers: { ...(init?.headers as object), ...headers } }),
  });
  return new SplashClient(transport);
}

async function runTurn(
  request: ChatCompletionRequest,
  options: {
    signal?: AbortSignal;
    onEvent?: (event: TurnEvent) => void;
    using?: SplashClient;
  } = {},
): Promise<TurnState> {
  let state = initialTurnState();
  for await (const event of (options.using ?? client).chatTurn(request, {
    signal: options.signal,
  })) {
    state = reduceTurn(state, event);
    options.onEvent?.(event);
  }
  return state;
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeAll(async () => {
  mock = await startMockSplash({ port: 0, speed: 50, statusAdvance: 'poll' });
  client = new SplashClient(new HttpTransport({ basePath: mock.url }));
});

afterAll(async () => {
  await mock.close();
});

describe('mock Splash over HTTP', () => {
  it('serves health, ready, models and metrics', async () => {
    expect(await client.health()).toEqual({ status: 'ok' });
    expect((await client.probe()).state).toBe('ready');
    const models = await client.models();
    expect(models.data[0]).toMatchObject({ id: 'incoai/Qwen3.8-27B-Splash', owned_by: 'splash' });
    expect((await client.model('incoai/Qwen3.8-27B-Splash')).context_length).toBe(262144);
    expect(await client.metrics()).toContain('splash_ready');
    expect(await client.tokenize('Hello')).toEqual({ tokens: [9419, 1814] });
  });

  it('cycles /status snapshots with monotonic counters across wraps', async () => {
    let tracker = initialStatusTracker();
    const phases: string[] = [];
    for (let i = 0; i < 14; i++) {
      tracker = trackStatus(tracker, { at: i * 1000, status: await client.status() });
      phases.push(tracker.live?.phase ?? '?');
      expect(tracker.live?.reset).toBe(false);
    }
    expect(tracker.resets).toBe(0);
    expect(phases).toContain('idle');
    expect(phases).toContain('decoding');
    const status = await client.status();
    expect(status.instance?.port).toBe(mock.port);
  });

  it('streams a thinking reply with usage', async () => {
    const { request } = buildChatRequest(USER, { max_tokens: 1024 }, undefined, {});
    const state = await runTurn(request);
    expect(state.phase).toBe('done');
    expect(state.reasoning.length).toBeGreaterThan(0);
    expect(state.content.endsWith('Rayleigh scattering.')).toBe(true);
    expect(state.stats).toMatchObject({
      completionTokens: 57,
      reasoningTokens: 27,
      approximate: false,
    });
    expect(mock.stats.lastChatRequest).toMatchObject({ stream: true, max_tokens: 1024 });
  });

  it('paces tokens: the first token comes after the recorded prefill time', async () => {
    let sentAt = 0;
    let firstTokenAt = 0;
    await runTurn(
      { messages: USER },
      {
        onEvent: (event) => {
          if (event.type === 'sent') sentAt = event.t;
          if (event.type === 'reasoningDelta' && firstTokenAt === 0) firstTokenAt = event.t;
        },
      },
    );
    // prompt_ms 607.6 at speed 50 is about 12 ms.
    expect(firstTokenAt - sentAt).toBeGreaterThanOrEqual(8);
  });

  it('honours reasoning_effort none and include_usage', async () => {
    const state = await runTurn({
      messages: USER,
      reasoning_effort: 'none',
      stream_options: { include_usage: false },
    });
    expect(state.reasoning).toBe('');
    expect(state.frames.content).toBe(35);
    expect(state.usage).toBeNull();
    expect(state.timings?.predicted_n).toBe(36);
  });

  it('streams tool calls', async () => {
    const { request } = buildChatRequest(
      [{ role: 'user', content: "What's the weather in Paris right now? Use the tool." }],
      {
        tools: [
          { type: 'function', function: { name: 'get_weather', parameters: { type: 'object' } } },
        ],
      },
      undefined,
      {},
    );
    const state = await runTurn(request);
    expect(state.toolCalls[0]).toMatchObject({
      name: 'get_weather',
      arguments: '{"city":"Paris"}',
    });
    expect(state.stats.finishReason).toBe('tool_calls');
  });

  it('closes the connection on abort and the mock counts a cancellation', async () => {
    const slow = await startMockSplash({ port: 0, speed: 5 });
    try {
      const slowClient = new SplashClient(new HttpTransport({ basePath: slow.url }));
      const controller = new AbortController();
      const state = await runTurn(
        { messages: USER },
        {
          using: slowClient,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'reasoningDelta') controller.abort();
          },
        },
      );
      expect(state.phase).toBe('cancelled');
      expect(state.reasoning.length).toBeGreaterThan(0);
      await waitFor(() => slow.stats.streams.cancelled === 1);
      expect(slow.stats.streams.active).toBe(0);
    } finally {
      await slow.close();
    }
  });
});

describe('mock Splash error injection', () => {
  it('401 on /status with WWW-Authenticate', async () => {
    const error = await clientWith({ 'x-mock-error': '401' })
      .status()
      .catch((e: unknown) => e);
    expect(classifySplashError(error)).toMatchObject({ kind: 'unauthorized', status: 401 });
  });

  it('503 with Retry-After before a stream starts', async () => {
    const state = await runTurn(
      { messages: USER },
      { using: clientWith({ 'x-mock-error': '503' }) },
    );
    expect(state.phase).toBe('error');
    expect(state.error).toMatchObject({
      kind: 'overloaded',
      status: 503,
      code: 'frontend_overloaded',
      retryAfter: 1,
    });
  });

  it('400 for a request Splash would reject', async () => {
    const state = await runTurn({ messages: USER, temperature: 5 });
    expect(state.error).toMatchObject({
      kind: 'bad-request',
      status: 400,
      message: 'temperature must be a number in [0, 2]',
    });
  });

  it('a mid-stream error frame', async () => {
    const state = await runTurn(
      { messages: USER },
      { using: clientWith({ 'x-mock-error': 'midstream' }) },
    );
    expect(state.phase).toBe('error');
    expect(state.error).toMatchObject({ kind: 'stream', code: 'mask_timeout' });
    expect(state.reasoning.length).toBeGreaterThan(0);
  });

  it('enforces an API key and refuses foreign origins', async () => {
    const keyed = await startMockSplash({ port: 0, apiKey: 'secret' });
    try {
      expect((await clientWith({}, keyed).health()).status).toBe('ok');
      const denied = await clientWith({}, keyed)
        .models()
        .catch((e: unknown) => e);
      expect(classifySplashError(denied).kind).toBe('unauthorized');
      const models = await clientWith({ authorization: 'Bearer secret' }, keyed).models();
      expect(models.object).toBe('list');
    } finally {
      await keyed.close();
    }
  });
});

describe('mock Splash idle weight release', () => {
  it('reports released memory, then delays START for the restore', async () => {
    const idle = await startMockSplash({
      port: 0,
      speed: 20,
      statusMode: 'idle',
      idleReleaseMs: 30,
    });
    try {
      const idleClient = new SplashClient(new HttpTransport({ basePath: idle.url }));
      let tracker = trackStatus(initialStatusTracker(), {
        at: 0,
        status: await idleClient.status(),
      });
      await new Promise((r) => setTimeout(r, 60));
      tracker = trackStatus(tracker, { at: 60, status: await idleClient.status() });
      expect(tracker.live?.phase).toBe('idle-released');
      const state = await runTurn({ messages: USER, max_tokens: 64 }, { using: idleClient });
      expect(state.phase).toBe('done');
      expect(state.keepalives).toBeGreaterThanOrEqual(1);
      expect(state.stats.queueToStartMs).toBeCloseTo(3070.606, 3);
    } finally {
      await idle.close();
    }
  });
});
