import { describe, expect, it } from 'vitest';
import afterIdleTimeline from '../../../fixtures/splash-1.2.0/chat_stream_after_idle.timeline.jsonl?raw';
import cancelledSse from '../../../fixtures/splash-1.2.0/chat_stream_cancelled.sse?raw';
import longPromptTimeline from '../../../fixtures/splash-1.2.0/chat_stream_long_prompt.timeline.jsonl?raw';
import longTimeline from '../../../fixtures/splash-1.2.0/chat_stream_long.timeline.jsonl?raw';
import noThinkingSse from '../../../fixtures/splash-1.2.0/chat_stream_no_thinking.sse?raw';
import queuedTimeline from '../../../fixtures/splash-1.2.0/chat_stream_queued.timeline.jsonl?raw';
import thinkingSse from '../../../fixtures/splash-1.2.0/chat_stream_thinking.sse?raw';
import toolsSse from '../../../fixtures/splash-1.2.0/chat_stream_tools.sse?raw';
import {
  chunkToEvents,
  frameToEvents,
  initialTurnState,
  reduceTurn,
  reduceTurnEvents,
  streamTurn,
  toAssistantMessage,
  turnWaitMs,
  type TurnEvent,
  type TurnPhase,
  type TurnState,
} from './chat-stream';
import { SplashHttpError, SplashTransportError } from './errors';
import {
  manualClock,
  parseTimeline,
  replayTransport,
  sseRows,
  type ReplayOptions,
  type TimelineRow,
} from './replay.testutil';
import type { ChatCompletionChunk, ChatCompletionRequest } from './types';

const REQUEST: ChatCompletionRequest = {
  messages: [{ role: 'user', content: 'In one sentence: why is the sky blue?' }],
  max_tokens: 1024,
};

interface Replay {
  events: TurnEvent[];
  states: TurnState[];
  final: TurnState;
  body: unknown;
}

async function replay(
  rows: TimelineRow[],
  options: ReplayOptions & { signal?: AbortSignal; onEvent?: (e: TurnEvent) => void } = {},
): Promise<Replay> {
  const clock = options.clock ?? manualClock();
  const transport = replayTransport(rows, { ...options, clock });
  const events: TurnEvent[] = [];
  const states: TurnState[] = [];
  let state = initialTurnState();
  for await (const event of streamTurn(transport, REQUEST, {
    signal: options.signal,
    now: clock.now,
  })) {
    events.push(event);
    state = reduceTurn(state, event);
    states.push(state);
    options.onEvent?.(event);
  }
  return { events, states, final: state, body: transport.lastInit?.body };
}

function phases(states: TurnState[]): TurnPhase[] {
  const out: TurnPhase[] = [];
  for (const state of states) if (out[out.length - 1] !== state.phase) out.push(state.phase);
  return out;
}

function count(events: TurnEvent[], type: TurnEvent['type']): number {
  return events.filter((event) => event.type === type).length;
}

describe('frameToEvents / chunkToEvents', () => {
  const base = { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm' } as const;

  it('maps the start chunk to admitted (not a token)', () => {
    const events = chunkToEvents(
      {
        ...base,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      },
      5,
    );
    expect(events).toEqual([{ type: 'admitted', t: 5, id: 'c', model: 'm', created: 1 }]);
  });

  it('maps an empty-delta chunk after START to a keepalive', () => {
    expect(
      chunkToEvents({ ...base, choices: [{ index: 0, delta: {}, finish_reason: null }] }, 1),
    ).toEqual([{ type: 'keepalive', t: 1, source: 'chunk' }]);
  });

  it('maps prompt_progress, finish with timings and the usage chunk', () => {
    const progress: ChatCompletionChunk = {
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: null }],
      prompt_progress: { total: 13116, cache: 0, processed: 2048, time_ms: 9399.76 },
    };
    expect(chunkToEvents(progress, 1)).toEqual([
      { type: 'prefillProgress', t: 1, done: 2048, total: 13116, cached: 0, elapsedMs: 9399.76 },
    ]);
    const usage = chunkToEvents(
      {
        ...base,
        choices: [],
        usage: {
          prompt_tokens: 62,
          completion_tokens: 57,
          total_tokens: 119,
          prompt_tokens_details: { cached_tokens: 32 },
          completion_tokens_details: { reasoning_tokens: 27 },
        },
      },
      2,
    );
    expect(usage[0]).toMatchObject({
      type: 'usage',
      promptTokens: 62,
      cachedTokens: 32,
      reasoningTokens: 27,
      latency: null,
    });
  });

  it('maps an error frame and garbage', () => {
    expect(
      frameToEvents(
        '{"error":{"message":"grammar stalled","type":"server_error","code":"mask_timeout"}}',
        3,
      ),
    ).toEqual([
      {
        type: 'error',
        t: 3,
        kind: 'stream',
        code: 'mask_timeout',
        message: 'grammar stalled',
        retryable: true,
      },
    ]);
    expect(frameToEvents('nope', 4)[0]).toMatchObject({ type: 'error', code: 'invalid_response' });
  });
});

describe('streamTurn + reduceTurn: recorded streams', () => {
  it('replays chat_stream_thinking.sse (thinking on, include_usage)', async () => {
    const { events, states, final, body } = await replay(sseRows(thinkingSse));
    expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(events[0]?.type).toBe('sent');
    expect(count(events, 'admitted')).toBe(1);
    expect(count(events, 'reasoningDelta')).toBe(27);
    expect(count(events, 'contentDelta')).toBe(27);
    expect(phases(states)).toEqual(['queued', 'prefilling', 'thinking', 'answering', 'done']);
    expect(final.reasoning.startsWith('We need to respond')).toBe(true);
    expect(final.reasoning.endsWith('\n')).toBe(true);
    expect(final.content.startsWith('The sky is blue because')).toBe(true);
    expect(final.content.endsWith('Rayleigh scattering.')).toBe(true);
    expect(final.stats).toMatchObject({
      promptTokens: 62,
      completionTokens: 57,
      cachedTokens: 0,
      reasoningTokens: 27,
      finishReason: 'stop',
      approximate: false,
    });
    expect(final.stats.ttftMs).toBeCloseTo(607.637, 3);
    expect(final.stats.decodeTokPerSec).toBeCloseTo(75.166, 2);
    expect(final.stats.prefillTokPerSec).toBeCloseTo(102.04, 2);
    expect(final.stats.queueToStartMs).toBeCloseTo(0.061, 3);
    expect(final.stats.wallMs).toBeCloseTo(1259.526, 3);
    // Rows are 1 ms apart: first reasoning at line 2, first answer at line 56.
    expect(final.stats.thinkingMs).toBe(56 - 2);
    expect(toAssistantMessage(final)).toEqual({
      role: 'assistant',
      content: final.content,
      reasoning_content: final.reasoning,
    });
  });

  it('replays chat_stream_no_thinking.sse (reasoning_effort none)', async () => {
    const { events, states, final } = await replay(sseRows(noThinkingSse));
    expect(count(events, 'reasoningDelta')).toBe(0);
    expect(phases(states)).toEqual(['queued', 'prefilling', 'answering', 'done']);
    expect(final.reasoning).toBe('');
    expect(final.stats).toMatchObject({
      promptTokens: 22,
      completionTokens: 36,
      reasoningTokens: 0,
      thinkingMs: null,
    });
    expect(toAssistantMessage(final)).toEqual({ role: 'assistant', content: final.content });
  });

  it('accumulates tool calls from chat_stream_tools.sse', async () => {
    const { final, events } = await replay(sseRows(toolsSse));
    expect(count(events, 'toolCallDelta')).toBe(6);
    expect(final.toolCalls).toEqual([
      {
        index: 0,
        id: 'call_58f5fbf40256ed700197361230c82af8_0',
        name: 'get_weather',
        arguments: '{"city":"Paris"}',
      },
    ]);
    expect(final.phase).toBe('done');
    expect(final.stats.finishReason).toBe('tool_calls');
    expect(final.stats.reasoningTokens).toBe(46);
    const message = toAssistantMessage(final);
    expect(message.content).toBeNull();
    expect(message.tool_calls?.[0]?.function).toEqual({
      name: 'get_weather',
      arguments: '{"city":"Paris"}',
    });
  });

  it('uses the engine decode speed once the finish chunk arrives (chat_stream_long)', async () => {
    const { final } = await replay(parseTimeline(longTimeline));
    expect(final.frames.content).toBe(400);
    expect(final.stats.finishReason).toBe('length');
    expect(final.stats.decodeTokPerSec).toBeCloseTo(41.72, 2);
    expect(final.stats.ttftMs).toBeCloseTo(480.749, 3);
  });

  it('live stats before the final chunks are approximate and close to the engine values', async () => {
    const { states } = await replay(parseTimeline(longTimeline));
    const live = states.filter((s) => s.frames.content === 400 && s.timings === null).pop();
    expect(live?.stats.approximate).toBe(true);
    // Client-side: 399 frames over the time since the first token.
    expect(live?.stats.decodeTokPerSec).toBeGreaterThan(38);
    expect(live?.stats.decodeTokPerSec).toBeLessThan(45);
    // Client-side TTFT counts from `sent` (clock 0) to the first frame, dispatched by
    // its terminating blank line at 483.952 ms.
    expect(live?.stats.ttftMs).toBeCloseTo(483.952, 3);
  });

  it('handles the idle-weight-reload wait (chat_stream_after_idle)', async () => {
    const clock = manualClock();
    const { events, states, final } = await replay(parseTimeline(afterIdleTimeline), { clock });
    // Headers and a keepalive comment arrive at 2.08 s while still queued.
    const open = events.find((e) => e.type === 'open');
    expect(open?.t).toBeCloseTo(2077.375, 3);
    const comment = events.find((e) => e.type === 'keepalive');
    expect(comment).toMatchObject({ source: 'comment' });
    const atComment = states[events.indexOf(comment as TurnEvent)];
    expect(atComment?.phase).toBe('queued');
    expect(turnWaitMs(atComment as TurnState, 2500)).toBe(2500);
    // START at 3.07 s, prefill progress, one token, finish.
    expect(phases(states)).toEqual(['queued', 'prefilling', 'answering', 'done']);
    const admitted = states.find((s) => s.timeline.admittedAt !== null && s.usage === null);
    // The start chunk's event is dispatched by its blank line at 3074.012 ms.
    expect(admitted?.stats.queueToStartMs).toBeCloseTo(3074.012, 3);
    expect(final.prefill).toEqual({ done: 18, total: 18, cached: 0, elapsedMs: 270.361 });
    expect(final.content).toBe('Hello');
    // Engine values replace the client-side ones.
    expect(final.stats.queueToStartMs).toBeCloseTo(3070.606, 3);
    expect(final.stats.ttftMs).toBeCloseTo(3401.831, 3);
    // predicted_per_second is 0 (one emission): no rate rather than a bogus one.
    expect(final.stats.decodeTokPerSec).toBeNull();
    expect(final.keepalives).toBe(1);
  });

  it('streams keepalive comments while queued behind busy lanes (chat_stream_queued)', async () => {
    const { events, states, final } = await replay(parseTimeline(queuedTimeline));
    const admittedIndex = events.findIndex((e) => e.type === 'admitted');
    const beforeStart = events.slice(0, admittedIndex);
    expect(beforeStart.filter((e) => e.type === 'keepalive')).toHaveLength(18);
    expect(beforeStart.every((e) => ['sent', 'open', 'keepalive'].includes(e.type))).toBe(true);
    expect(states[admittedIndex - 1]?.phase).toBe('queued');
    expect(final.stats.queueToStartMs).toBeCloseTo(37991.719, 3);
    expect(final.content).toBe('Bonjour !');
  });

  it('tracks prefill progress and ignores empty-delta keepalives (chat_stream_long_prompt)', async () => {
    const { events, states, final } = await replay(parseTimeline(longPromptTimeline));
    const progress = events.filter((e) => e.type === 'prefillProgress');
    expect(progress.map((e) => (e.type === 'prefillProgress' ? e.done : -1))).toEqual([
      0, 2048, 4096, 6144, 8192, 10240, 12288, 13088, 13116,
    ]);
    expect(count(events, 'keepalive')).toBeGreaterThan(20);
    // Keepalive chunks are not tokens.
    const prefilling = states.filter((s) => s.phase === 'prefilling');
    expect(prefilling.every((s) => s.frames.content === 0 && s.content === '')).toBe(true);
    expect(final.content).toBe('400');
    expect(final.stats.promptTokens).toBe(13116);
    expect(final.stats.prefillTokPerSec).toBeCloseTo(183.29, 2);
  });
});

describe('streamTurn: failures and cancellation', () => {
  it('aborting mid-stream ends with cancelled and keeps the partial text (chat_stream_cancelled)', async () => {
    const controller = new AbortController();
    const { events, final } = await replay(sseRows(cancelledSse), {
      signal: controller.signal,
      afterEvent: (_event, index) => {
        if (index === 50) controller.abort();
      },
    });
    expect(events[events.length - 1]?.type).toBe('cancelled');
    expect(final.phase).toBe('cancelled');
    expect(final.content.startsWith('1\n2\n3\n')).toBe(true);
    expect(final.frames.content).toBe(50);
    expect(final.error).toBeNull();
  });

  it('a server close without finish or [DONE] is stream_incomplete', async () => {
    const { final } = await replay(sseRows(cancelledSse));
    expect(final.phase).toBe('error');
    expect(final.error).toMatchObject({ code: 'stream_incomplete', retryable: true });
    expect(final.frames.content).toBe(160);
  });

  it('a mid-stream error frame then [DONE] ends in error with the partial content', async () => {
    const lines = thinkingSse.split('\n').slice(0, 60);
    lines.push(
      'data: {"error":{"message":"grammar mask timed out","type":"server_error","code":"mask_timeout"}}',
      '',
      'data: [DONE]',
      '',
    );
    const { final, events } = await replay(sseRows(lines.join('\n')));
    expect(events[events.length - 1]).toMatchObject({ type: 'error', code: 'mask_timeout' });
    expect(final.phase).toBe('error');
    expect(final.error).toMatchObject({ kind: 'stream', code: 'mask_timeout', retryable: true });
    expect(final.reasoning.length).toBeGreaterThan(0);
  });

  it('a 503 before the stream is an error event with Retry-After', async () => {
    const failWith = new SplashHttpError(
      503,
      '{"error":{"message":"frontend request capacity is exhausted","type":"server_error","code":"frontend_overloaded"}}',
      { 'retry-after': '1' },
    );
    const { events, final } = await replay([], { failWith });
    expect(events.map((e) => e.type)).toEqual(['sent', 'error']);
    expect(final.error).toEqual({
      kind: 'overloaded',
      code: 'frontend_overloaded',
      message: 'frontend request capacity is exhausted',
      status: 503,
      retryAfter: 1,
      retryable: true,
    });
  });

  it('a connection failure is an unreachable error event', async () => {
    const { final } = await replay([], {
      failWith: new SplashTransportError('could not reach Splash: ECONNREFUSED', 'unreachable'),
    });
    expect(final.error).toMatchObject({
      kind: 'unreachable',
      code: 'unreachable',
      retryable: true,
    });
  });

  it('an already-aborted signal yields sent then cancelled without a request', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = replayTransport(sseRows(thinkingSse));
    const events: TurnEvent[] = [];
    for await (const event of streamTurn(transport, REQUEST, { signal: controller.signal })) {
      events.push(event);
    }
    expect(events.map((e) => e.type)).toEqual(['sent', 'cancelled']);
    expect(transport.lastInit).toBeUndefined();
  });

  it('breaking out of the loop aborts the transport request', async () => {
    const transport = replayTransport(sseRows(thinkingSse));
    for await (const event of streamTurn(transport, REQUEST)) {
      if (event.type === 'reasoningDelta') break;
    }
    expect(transport.lastInit?.signal?.aborted).toBe(true);
  });

  it('keeps the request stream_options when the caller sets them', async () => {
    const transport = replayTransport(sseRows(noThinkingSse));
    const request = { ...REQUEST, stream_options: { include_usage: false } };
    for await (const _ of streamTurn(transport, request)) {
      // drain
    }
    expect(transport.lastInit?.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: false },
    });
  });
});

describe('reduceTurn', () => {
  it('does not leave a terminal phase and ignores cancel after done', () => {
    const done = reduceTurnEvents([
      { type: 'sent', t: 0 },
      { type: 'contentDelta', t: 10, text: 'Hi' },
      { type: 'finish', t: 11, reason: 'stop', timings: null },
    ]);
    expect(done.phase).toBe('done');
    expect(reduceTurn(done, { type: 'cancelled', t: 12 }).phase).toBe('done');
    expect(reduceTurn(done, { type: 'contentDelta', t: 12, text: '!' }).phase).toBe('done');
  });

  it('does not mutate the previous state', () => {
    const before = initialTurnState();
    const after = reduceTurn(before, { type: 'contentDelta', t: 1, text: 'x' });
    expect(before.content).toBe('');
    expect(before.frames.content).toBe(0);
    expect(after.content).toBe('x');
  });

  it('turnWaitMs is null once admitted', () => {
    const state = reduceTurnEvents([
      { type: 'sent', t: 100 },
      { type: 'admitted', t: 300, id: 'c', model: 'm', created: 0 },
    ]);
    expect(turnWaitMs(state, 400)).toBeNull();
  });
});
