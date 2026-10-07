/**
 * Chat turn streaming: Transport SSE frames -> typed `TurnEvent`s -> a
 * `TurnState` (pure reducer). docs/splash-api.md sections 6.2 and 6.3.
 *
 *   for await (const event of streamTurn(transport, request, { signal })) {
 *     state = reduceTurn(state, event);
 *   }
 *
 * Every event carries `t`, a timestamp from the injectable `now()` clock
 * (default `Date.now`), so the reducer computes client-side timings without
 * reading a clock itself. The first event is always `sent`.
 *
 * Stream grammar handled here:
 * - `: splash-keepalive` comments (queued for a lane, or weights restoring)
 *   and empty-delta chunks after START are `keepalive` events, never tokens.
 * - The start chunk (`delta:{role:"assistant",content:""}`) is `admitted`.
 * - `prompt_progress` chunks are `prefillProgress`.
 * - A mid-stream `{"error":{...}}` frame is an `error` event; Splash then
 *   sends `[DONE]`. Pre-stream HTTP errors and connection failures are
 *   `error` events too, classified by `classifySplashError`.
 * - Aborting the signal closes the connection (Splash cancels the request)
 *   and ends the stream with a `cancelled` event. `streamTurn` never throws
 *   for transport, HTTP or abort failures.
 * - A stream that closes without a finish chunk or an error frame ends with
 *   an `error` event, code `stream_incomplete`.
 */
import { classifySplashError, isAbortError, type SplashErrorKind } from './errors';
import type { SplashStreamInit, Transport } from './transport';
import type {
  AssistantMessage,
  ChatCompletionChunk,
  ChatCompletionRequest,
  FinishReason,
  RequestLatency,
  RequestMetrics,
  StreamErrorFrame,
  Timings,
  ToolCall,
  Usage,
} from './types';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface TurnErrorInfo {
  kind: SplashErrorKind;
  /** Splash `error.code`, the transport kind, or `stream_incomplete` / `invalid_response`. */
  code: string;
  message: string;
  /** HTTP status when the request failed before the stream started. */
  status?: number;
  /** Seconds, from `Retry-After` (every Splash 503 sends 1). */
  retryAfter?: number;
  retryable: boolean;
}

export interface TurnUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  latency: RequestLatency | null;
  /** Raw objects, for anything not flattened above. */
  usage: Usage;
  metrics: RequestMetrics | null;
}

export type TurnEvent =
  /** The request is about to be sent. Always first. */
  | { type: 'sent'; t: number }
  /** Response headers arrived. Queued requests get them with the first keepalive. */
  | { type: 'open'; t: number; status: number }
  /** Liveness without progress: a `: splash-keepalive` comment or an empty-delta chunk. */
  | { type: 'keepalive'; t: number; source: 'comment' | 'chunk' }
  /** The start chunk: the engine admitted the request (before prefill). */
  | { type: 'admitted'; t: number; id: string; model: string; created: number }
  | {
      type: 'prefillProgress';
      t: number;
      /** Tokens processed, cache included. */
      done: number;
      total: number;
      /** Tokens served from the prefix cache. */
      cached: number;
      /** Ms since prefill admission (not an ETA). */
      elapsedMs: number;
    }
  | { type: 'reasoningDelta'; t: number; text: string }
  | { type: 'contentDelta'; t: number; text: string }
  | {
      type: 'toolCallDelta';
      t: number;
      index: number;
      id?: string;
      name?: string;
      /** JSON text fragment ('' for the header delta). */
      argumentsDelta: string;
    }
  | { type: 'finish'; t: number; reason: FinishReason; timings: Timings | null }
  | ({ type: 'usage'; t: number } & TurnUsage)
  | ({ type: 'error'; t: number } & TurnErrorInfo)
  | { type: 'cancelled'; t: number };

export type TurnEventType = TurnEvent['type'];
export type ToolCallDeltaEvent = Extract<TurnEvent, { type: 'toolCallDelta' }>;
export type TurnErrorEvent = Extract<TurnEvent, { type: 'error' }>;

// ---------------------------------------------------------------------------
// Frame -> events (pure)
// ---------------------------------------------------------------------------

/** Turns one SSE `data:` payload (JSON text) into events. Never throws. */
export function frameToEvents(data: string, t: number): TurnEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [
      {
        type: 'error',
        t,
        kind: 'invalid-response',
        code: 'invalid_response',
        message: `Splash sent a stream frame that is not JSON: ${data.slice(0, 120)}`,
        retryable: false,
      },
    ];
  }
  if (!parsed || typeof parsed !== 'object') return [{ type: 'keepalive', t, source: 'chunk' }];
  if ('error' in parsed) return [errorFrameEvent(parsed as StreamErrorFrame, t)];
  return chunkToEvents(parsed as ChatCompletionChunk, t);
}

function errorFrameEvent(frame: StreamErrorFrame, t: number): TurnEvent {
  const error: Partial<StreamErrorFrame['error']> =
    frame.error && typeof frame.error === 'object' ? frame.error : {};
  const code = typeof error.code === 'string' ? error.code : 'stream_error';
  return {
    type: 'error',
    t,
    kind: 'stream',
    code,
    message: typeof error.message === 'string' ? error.message : 'Splash reported an error',
    retryable: RETRYABLE_STREAM_CODES.has(code),
  };
}

const RETRYABLE_STREAM_CODES = new Set(['mask_timeout', 'resource_timeout', 'engine_recovering']);

/** Turns one parsed chat chunk into events. Never throws. */
export function chunkToEvents(chunk: ChatCompletionChunk, t: number): TurnEvent[] {
  const events: TurnEvent[] = [];
  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  const choice = choices.find((c) => c.index === 0) ?? choices[0];
  const delta = choice?.delta ?? {};

  if (delta.role !== undefined) {
    events.push({
      type: 'admitted',
      t,
      id: chunk.id,
      model: chunk.model,
      created: chunk.created,
    });
  }
  const progress = chunk.prompt_progress;
  if (progress) {
    events.push({
      type: 'prefillProgress',
      t,
      done: progress.processed,
      total: progress.total,
      cached: progress.cache,
      elapsedMs: progress.time_ms,
    });
  }
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '') {
    events.push({ type: 'reasoningDelta', t, text: delta.reasoning_content });
  }
  if (typeof delta.content === 'string' && delta.content !== '') {
    events.push({ type: 'contentDelta', t, text: delta.content });
  }
  for (const call of delta.tool_calls ?? []) {
    const event: ToolCallDeltaEvent = {
      type: 'toolCallDelta',
      t,
      index: call.index,
      argumentsDelta: call.function?.arguments ?? '',
    };
    if (call.id !== undefined) event.id = call.id;
    if (call.function?.name !== undefined) event.name = call.function.name;
    events.push(event);
  }
  if (choice && choice.finish_reason !== null && choice.finish_reason !== undefined) {
    events.push({
      type: 'finish',
      t,
      reason: choice.finish_reason,
      timings: chunk.timings ?? null,
    });
  }
  if (chunk.usage) {
    events.push(usageEvent(chunk.usage, chunk.metrics ?? null, t));
  }
  if (events.length === 0) events.push({ type: 'keepalive', t, source: 'chunk' });
  return events;
}

function usageEvent(usage: Usage, metrics: RequestMetrics | null, t: number): TurnEvent {
  return {
    type: 'usage',
    t,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
    latency: metrics?.request_latency ?? null,
    usage,
    metrics,
  };
}

// ---------------------------------------------------------------------------
// Transport -> events
// ---------------------------------------------------------------------------

export interface StreamTurnOptions {
  /** Abort = Stop: closes the connection, which cancels the request in Splash. */
  signal?: AbortSignal;
  /** Clock for event timestamps, in ms. Default `Date.now`. */
  now?: () => number;
  /** Default `/v1/chat/completions`. */
  path?: string;
  headers?: Record<string, string>;
}

/**
 * POSTs `request` with `stream: true` (and `stream_options.include_usage:
 * true` unless the request sets `stream_options`) and yields `TurnEvent`s as
 * they happen, including keepalive comments while no data arrives.
 */
export async function* streamTurn(
  transport: Transport,
  request: ChatCompletionRequest,
  options: StreamTurnOptions = {},
): AsyncGenerator<TurnEvent, void, undefined> {
  const now = options.now ?? Date.now;
  const external = options.signal;
  const controller = new AbortController();
  const onAbort = () => controller.abort(external?.reason);
  external?.addEventListener('abort', onAbort, { once: true });

  const body: ChatCompletionRequest = {
    ...request,
    stream: true,
    stream_options: request.stream_options ?? { include_usage: true },
  };

  yield { type: 'sent', t: now() };
  if (external?.aborted) {
    external.removeEventListener('abort', onAbort);
    yield { type: 'cancelled', t: now() };
    return;
  }

  const queue = new EventQueue<TurnEvent>();
  const init: SplashStreamInit = {
    path: options.path ?? '/v1/chat/completions',
    body,
    signal: controller.signal,
    onOpen: (info) => queue.push({ type: 'open', t: now(), status: info.status }),
    onComment: () => queue.push({ type: 'keepalive', t: now(), source: 'comment' }),
  };
  if (options.headers) init.headers = options.headers;

  const pump = async () => {
    try {
      for await (const sse of transport.stream(init)) {
        for (const event of frameToEvents(sse.data, now())) queue.push(event);
      }
    } catch (error) {
      if (external?.aborted || isAbortError(error)) {
        queue.push({ type: 'cancelled', t: now() });
      } else {
        queue.push(errorEvent(error, now()));
      }
    } finally {
      queue.close();
    }
  };
  void pump();

  let ended = false;
  try {
    for (;;) {
      const next = await queue.next();
      if (next.done) break;
      const event = next.value;
      if (event.type === 'finish' || event.type === 'error' || event.type === 'cancelled') {
        ended = true;
      }
      yield event;
    }
    if (!ended) {
      yield {
        type: 'error',
        t: now(),
        kind: 'stream',
        code: 'stream_incomplete',
        message: 'The stream ended before the reply finished',
        retryable: true,
      };
    }
  } finally {
    external?.removeEventListener('abort', onAbort);
    // Ends the HTTP request if the consumer stopped early.
    controller.abort();
  }
}

function errorEvent(error: unknown, t: number): TurnErrorEvent {
  const info = classifySplashError(error);
  const event: TurnErrorEvent = {
    type: 'error',
    t,
    kind: info.kind,
    code: info.code ?? (info.status !== undefined ? `http_${info.status}` : info.kind),
    message: info.message,
    retryable: info.retryable,
  };
  if (info.status !== undefined) event.status = info.status;
  if (info.retryAfter !== undefined) event.retryAfter = info.retryAfter;
  return event;
}

/** Unbounded single-consumer async queue. */
class EventQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: ((result: IteratorResult<T, undefined>) => void)[] = [];
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

  next(): Promise<IteratorResult<T, undefined>> {
    if (this.items.length > 0) {
      return Promise.resolve({ value: this.items.shift() as T, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

// ---------------------------------------------------------------------------
// Reducer (pure)
// ---------------------------------------------------------------------------

/**
 * - `queued`: sent, not yet admitted (waiting for a lane, or for weights to
 *   reload after an idle release; keepalive comments arrive every 2 s).
 * - `prefilling`: admitted (start chunk), reading the prompt.
 * - `thinking`: reasoning deltas. `answering`: content or tool-call deltas.
 * - `done`: finish chunk received. `cancelled`: aborted. `error`: failed.
 */
export type TurnPhase =
  'queued' | 'prefilling' | 'thinking' | 'answering' | 'done' | 'cancelled' | 'error';

export interface TurnToolCall {
  index: number;
  id: string;
  name: string;
  /** Accumulated JSON text (may be incomplete while streaming). */
  arguments: string;
}

/**
 * Per-turn numbers. While streaming they are client-side approximations
 * (`approximate: true`); the finish chunk's `timings` and the usage chunk
 * replace them with the engine's exact values.
 */
export interface TurnStats {
  /** Engine `ttft_ms` (includes the queue), else send -> first reasoning/content/tool frame. */
  ttftMs: number | null;
  /** `timings.predicted_per_second`, fallback completion_tokens / first_token_to_done; live: frames/s. */
  decodeTokPerSec: number | null;
  /** `timings.prompt_per_second` (uncached tokens). */
  prefillTokPerSec: number | null;
  promptTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  completionTokens: number | null;
  finishReason: FinishReason | null;
  /** First reasoning frame -> first answer frame (or last reasoning frame). Client-side. */
  thinkingMs: number | null;
  /** Engine `queue_to_start_ms` (the weight-restore time after an idle release); live: send -> start chunk. */
  queueToStartMs: number | null;
  /** Engine `wall_ms`, else send -> finish. */
  wallMs: number | null;
  /** True until the engine's own numbers arrive. */
  approximate: boolean;
}

export interface TurnTimeline {
  sentAt: number | null;
  openedAt: number | null;
  admittedAt: number | null;
  firstTokenAt: number | null;
  firstReasoningAt: number | null;
  lastReasoningAt: number | null;
  firstAnswerAt: number | null;
  lastTokenAt: number | null;
  finishedAt: number | null;
  /** Last event of any kind, keepalives included (stall detection). */
  lastActivityAt: number | null;
}

export interface TurnState {
  phase: TurnPhase;
  /** Chat completion id and model, from the start chunk. */
  id: string | null;
  model: string | null;
  reasoning: string;
  content: string;
  toolCalls: TurnToolCall[];
  prefill: { done: number; total: number; cached: number; elapsedMs: number } | null;
  error: TurnErrorInfo | null;
  /** Keepalive comments and empty chunks seen. */
  keepalives: number;
  /** Delta frames (about one token each). */
  frames: { reasoning: number; content: number; toolCalls: number };
  timings: Timings | null;
  usage: TurnUsage | null;
  timeline: TurnTimeline;
  stats: TurnStats;
}

const EMPTY_STATS: TurnStats = {
  ttftMs: null,
  decodeTokPerSec: null,
  prefillTokPerSec: null,
  promptTokens: null,
  cachedTokens: null,
  reasoningTokens: null,
  completionTokens: null,
  finishReason: null,
  thinkingMs: null,
  queueToStartMs: null,
  wallMs: null,
  approximate: true,
};

export function initialTurnState(): TurnState {
  return {
    phase: 'queued',
    id: null,
    model: null,
    reasoning: '',
    content: '',
    toolCalls: [],
    prefill: null,
    error: null,
    keepalives: 0,
    frames: { reasoning: 0, content: 0, toolCalls: 0 },
    timings: null,
    usage: null,
    timeline: {
      sentAt: null,
      openedAt: null,
      admittedAt: null,
      firstTokenAt: null,
      firstReasoningAt: null,
      lastReasoningAt: null,
      firstAnswerAt: null,
      lastTokenAt: null,
      finishedAt: null,
      lastActivityAt: null,
    },
    stats: EMPTY_STATS,
  };
}

const TERMINAL: ReadonlySet<TurnPhase> = new Set(['done', 'cancelled', 'error']);

export function isTurnTerminal(state: TurnState): boolean {
  return TERMINAL.has(state.phase);
}

/** Pure reducer: returns a new state; never mutates `state`. */
export function reduceTurn(state: TurnState, event: TurnEvent): TurnState {
  const timeline: TurnTimeline = { ...state.timeline, lastActivityAt: event.t };
  const next: TurnState = { ...state, timeline };
  const terminal = TERMINAL.has(state.phase);
  const advance = (phase: TurnPhase) => {
    if (!terminal) next.phase = phase;
  };
  const token = () => {
    timeline.firstTokenAt ??= event.t;
    timeline.lastTokenAt = event.t;
  };

  switch (event.type) {
    case 'sent':
      timeline.sentAt = event.t;
      break;
    case 'open':
      timeline.openedAt ??= event.t;
      break;
    case 'keepalive':
      next.keepalives = state.keepalives + 1;
      break;
    case 'admitted':
      timeline.admittedAt ??= event.t;
      next.id = event.id;
      next.model = event.model;
      if (state.phase === 'queued') advance('prefilling');
      break;
    case 'prefillProgress':
      next.prefill = {
        done: event.done,
        total: event.total,
        cached: event.cached,
        elapsedMs: event.elapsedMs,
      };
      if (state.phase === 'queued') advance('prefilling');
      break;
    case 'reasoningDelta':
      next.reasoning = state.reasoning + event.text;
      next.frames = { ...state.frames, reasoning: state.frames.reasoning + 1 };
      timeline.firstReasoningAt ??= event.t;
      timeline.lastReasoningAt = event.t;
      token();
      advance('thinking');
      break;
    case 'contentDelta':
      next.content = state.content + event.text;
      next.frames = { ...state.frames, content: state.frames.content + 1 };
      timeline.firstAnswerAt ??= event.t;
      token();
      advance('answering');
      break;
    case 'toolCallDelta': {
      next.toolCalls = applyToolCallDelta(state.toolCalls, event);
      next.frames = { ...state.frames, toolCalls: state.frames.toolCalls + 1 };
      timeline.firstAnswerAt ??= event.t;
      token();
      advance('answering');
      break;
    }
    case 'finish':
      timeline.finishedAt ??= event.t;
      next.timings = event.timings ?? state.timings;
      next.stats = { ...state.stats, finishReason: event.reason };
      advance('done');
      break;
    case 'usage': {
      const { type: _type, t: _t, ...usage } = event;
      next.usage = usage;
      break;
    }
    case 'error': {
      const { type: _type, t: _t, ...error } = event;
      next.error = error;
      if (state.phase !== 'cancelled') next.phase = 'error';
      break;
    }
    case 'cancelled':
      advance('cancelled');
      break;
  }
  next.stats = computeStats(next);
  return next;
}

function applyToolCallDelta(calls: TurnToolCall[], event: ToolCallDeltaEvent): TurnToolCall[] {
  const position = calls.findIndex((call) => call.index === event.index);
  const current: TurnToolCall =
    position === -1 ? { index: event.index, id: '', name: '', arguments: '' } : calls[position]!;
  const updated: TurnToolCall = {
    index: current.index,
    id: event.id ?? current.id,
    name: current.name + (event.name ?? ''),
    arguments: current.arguments + event.argumentsDelta,
  };
  if (position === -1) return [...calls, updated].sort((a, b) => a.index - b.index);
  const out = calls.slice();
  out[position] = updated;
  return out;
}

function positive(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function nonNegative(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function since(start: number | null, end: number | null): number | null {
  return start !== null && end !== null ? nonNegative(end - start) : null;
}

/** Shorter decode windows give meaningless rates (one speculative burst). */
const MIN_DECODE_WINDOW_MS = 50;

function computeStats(state: TurnState): TurnStats {
  const { timeline, timings, usage } = state;
  const latency = usage?.latency ?? null;
  const frames = state.frames.reasoning + state.frames.content + state.frames.toolCalls;

  let decode: number | null = null;
  if (timings) {
    // 0 when the whole reply came in one emission: no meaningful rate ("—").
    decode = positive(timings.predicted_per_second);
  } else if (usage) {
    // Servers before 1.1 send no timings: use the engine's request latency.
    decode = positive(latency?.stream_tokens_per_second);
    const ms = positive(latency?.first_token_to_done_ms);
    if (decode === null && ms !== null && ms >= MIN_DECODE_WINDOW_MS) {
      const tokens = usage.metrics?.decode?.tokens ?? usage.completionTokens;
      decode = positive(tokens / (ms / 1000));
    }
  } else if (frames > 1) {
    const ms = since(timeline.firstTokenAt, timeline.lastTokenAt);
    decode =
      ms !== null && ms >= MIN_DECODE_WINDOW_MS ? positive((frames - 1) / (ms / 1000)) : null;
  }

  const thinkingEnd = timeline.firstAnswerAt ?? timeline.lastReasoningAt;
  return {
    ttftMs:
      nonNegative(latency?.ttft_ms) ??
      (timeline.firstTokenAt !== null ? since(timeline.sentAt, timeline.firstTokenAt) : null),
    decodeTokPerSec: decode,
    prefillTokPerSec: positive(timings?.prompt_per_second),
    promptTokens: usage?.promptTokens ?? timings?.prompt_n ?? state.prefill?.total ?? null,
    cachedTokens: usage?.cachedTokens ?? timings?.cache_n ?? state.prefill?.cached ?? null,
    reasoningTokens:
      usage?.reasoningTokens ?? (state.frames.reasoning > 0 ? state.frames.reasoning : null),
    completionTokens:
      usage?.completionTokens ?? timings?.predicted_n ?? (frames > 0 ? frames : null),
    finishReason: state.stats.finishReason,
    thinkingMs:
      timeline.firstReasoningAt !== null ? since(timeline.firstReasoningAt, thinkingEnd) : null,
    queueToStartMs:
      nonNegative(latency?.queue_to_start_ms) ?? since(timeline.sentAt, timeline.admittedAt),
    wallMs: nonNegative(latency?.wall_ms) ?? since(timeline.sentAt, timeline.finishedAt),
    approximate: timings === null && usage === null,
  };
}

/** Reduces a whole event list (tests, replays). */
export function reduceTurnEvents(
  events: Iterable<TurnEvent>,
  state: TurnState = initialTurnState(),
): TurnState {
  let out = state;
  for (const event of events) out = reduceTurn(out, event);
  return out;
}

/**
 * Ms the turn has waited for admission (headers not yet sent, or a lane /
 * weight restore pending), or null once admitted or ended. Splash sends the
 * first keepalive after 2 s; past that the UI can show "Waiting for a free
 * slot" (or "Waking model" when the dashboard says the weights are released).
 */
export function turnWaitMs(state: TurnState, now: number): number | null {
  if (state.phase !== 'queued' || state.timeline.sentAt === null) return null;
  return Math.max(0, now - state.timeline.sentAt);
}

/**
 * The assistant message to append to the conversation history: content
 * (null when empty), `reasoning_content` when non-empty, `tool_calls` when
 * the model called tools.
 */
export function toAssistantMessage(state: TurnState): AssistantMessage {
  const message: AssistantMessage = {
    role: 'assistant',
    content: state.content === '' ? null : state.content,
  };
  if (state.reasoning !== '') message.reasoning_content = state.reasoning;
  if (state.toolCalls.length > 0) {
    message.tool_calls = state.toolCalls.map((call): ToolCall => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  return message;
}
