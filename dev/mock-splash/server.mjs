#!/usr/bin/env node
/**
 * Mock Splash 1.2.0 server: replays the recorded fixtures in
 * fixtures/splash-1.2.0/ over real HTTP. Zero dependencies (Node 22+).
 *
 *   node dev/mock-splash/server.mjs [--port 8090] [--host 127.0.0.1] [--speed 1]
 *   SPLASH_URL=http://127.0.0.1:8090 pnpm web
 *
 * See dev/mock-splash/README.md for routes, scenarios and error injection.
 * Programmatic use (tests): `const mock = await startMockSplash({ port: 0 })`.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURES_DIR = resolve(HERE, '../../fixtures/splash-1.2.0');

const PUBLIC_PATHS = new Set(['/health', '/ready', '/', '/index.html', '/favicon.ico']);
const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

/** Snapshot sequences per status mode, each monotonic in its counters. */
const STATUS_SEQUENCES = {
  cycle: [
    'status_idle',
    'status_busy',
    'status_busy_2',
    'status_after_cancel',
    'status_after',
    'status_saturated',
  ],
  busy: ['status_busy', 'status_busy_2'],
  idle: ['status_idle'],
  saturated: ['status_saturated'],
};

/** Cumulative /status counters, offset on every wrap so they never decrease. */
const COUNTER_PATHS = [
  'requests.submitted',
  'requests.completed',
  'requests.cancelled',
  'requests.failed',
  'metrics.prefill_input_tokens',
  'metrics.prefill_wall_ms',
  'metrics.decode_output_tokens',
  'metrics.decode_wall_ms',
  'metrics.decode_cycle_ms',
  'metrics.drafted_tokens',
  'metrics.accepted_draft_tokens',
  'scheduler.prefill_batches',
  'scheduler.prefill_rows',
  'scheduler.decode_batches',
  'scheduler.decode_batches_by_width.b1',
  'scheduler.decode_batches_by_width.b2',
  'scheduler.decode_batches_by_width.b3',
  'scheduler.decode_batches_by_width.b4',
  'cache.hits',
  'cache.cold_misses',
  'cache.kv_hit_tokens',
  'cache.reused_tokens',
];

const ERRORS = {
  400: { status: 400, file: 'error_400.json' },
  401: { status: 401, file: 'error_401.json', headers: { 'www-authenticate': 'Bearer' } },
  403: { status: 403, file: 'origin_forbidden.json' },
  404: { status: 404, file: 'error_model_not_found.json' },
  context: { status: 400, file: 'error_context_length.json' },
  500: {
    status: 500,
    body: {
      error: {
        message: 'engine failed permanently; restart the server (crash trace: none)',
        type: 'server_error',
        code: 'engine_failed',
      },
    },
  },
  503: {
    status: 503,
    headers: { 'retry-after': '1' },
    body: {
      error: {
        message: 'frontend request capacity is exhausted',
        type: 'server_error',
        code: 'frontend_overloaded',
      },
    },
  },
  recovering: {
    status: 503,
    headers: { 'retry-after': '1' },
    body: {
      error: {
        message: 'engine is recovering; retry shortly (last failure: mock)',
        type: 'server_error',
        code: 'engine_recovering',
      },
    },
  },
};

const STREAM_SCENARIOS = {
  thinking: { kind: 'sse', file: 'chat_stream_thinking.sse' },
  no_thinking: { kind: 'sse', file: 'chat_stream_no_thinking.sse' },
  tools: { kind: 'sse', file: 'chat_stream_tools.sse' },
  long: { kind: 'timeline', file: 'chat_stream_long.timeline.jsonl' },
  long_prompt: { kind: 'timeline', file: 'chat_stream_long_prompt.timeline.jsonl' },
  queued: { kind: 'timeline', file: 'chat_stream_queued.timeline.jsonl' },
  after_idle: { kind: 'timeline', file: 'chat_stream_after_idle.timeline.jsonl' },
};

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function loadFixtures(dir) {
  const text = (name) => readFileSync(join(dir, name), 'utf8');
  const json = (name) => JSON.parse(text(name));
  const status = {};
  for (const name of [
    'status_idle',
    'status_busy',
    'status_busy_2',
    'status_after_cancel',
    'status_after',
    'status_saturated',
    'status_idle_released',
  ]) {
    status[name] = json(`${name}.json`);
  }
  const streams = {};
  for (const [name, scenario] of Object.entries(STREAM_SCENARIOS)) {
    streams[name] =
      scenario.kind === 'sse'
        ? parseSseFile(text(scenario.file))
        : parseTimeline(text(scenario.file));
  }
  return {
    text,
    json,
    status,
    streams,
    models: json('models.json'),
    modelGet: json('model_get.json'),
    health: json('health.json'),
    ready: json('ready.json'),
    metrics: text('metrics.txt'),
    tokenize: json('tokenize.json'),
    applyTemplate: json('apply_template.json'),
    completions: json('completions_nonstream.json'),
    chat: {
      default: json('chat_nonstream.json'),
      effortLow: json('chat_nonstream_effort_low.json'),
      thinkingOff: json('chat_nonstream_enable_thinking_false.json'),
      jsonSchema: json('chat_nonstream_json_schema.json'),
      image: json('chat_nonstream_image.json'),
    },
    tokenGapsMs: tokenGaps(parseTimeline(text('chat_stream_long.timeline.jsonl'))),
  };
}

/** `.sse` text -> SSE frames (`data:` payloads and comments), without timing. */
function parseSseFile(text) {
  const frames = [];
  for (const block of text.split(/\n\n/)) {
    const line = block.trim();
    if (line.startsWith('data: ')) frames.push({ data: line.slice(6) });
    else if (line.startsWith(':')) frames.push({ comment: line.slice(1).trim() });
  }
  return { kind: 'sse', frames };
}

/** `.timeline.jsonl` -> { headerAt, frames: [{ t, data | comment }] }. */
function parseTimeline(text) {
  const rows = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
  const header = rows.find((row) => 'status' in row);
  const frames = [];
  for (const row of rows) {
    if (typeof row.line !== 'string') continue;
    if (row.line.startsWith('data: ')) frames.push({ t: row.t_ms, data: row.line.slice(6) });
    else if (row.line.startsWith(':'))
      frames.push({ t: row.t_ms, comment: row.line.slice(1).trim() });
  }
  return { kind: 'timeline', headerAt: header ? header.t_ms : 0, frames };
}

/** Gaps between consecutive token frames of the 400-token stream (speculative bursts). */
function tokenGaps(timeline) {
  const times = timeline.frames
    .filter((frame) => frame.data && /"(content|reasoning_content)":"[^"]/.test(frame.data))
    .map((frame) => frame.t);
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(Math.max(0, times[i] - times[i - 1]));
  return gaps.length > 0 ? gaps : [20];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPath(object, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function setPath(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let target = object;
  for (const key of keys) {
    if (target == null || typeof target !== 'object') return;
    target = target[key];
  }
  if (target != null && typeof target === 'object' && last in target) target[last] = value;
}

function isTokenFrame(data) {
  return /"(content|reasoning_content)":"[^"]/.test(data) || data.includes('"tool_calls"');
}

function errorBody(message, code, status) {
  return {
    error: {
      message,
      type: status >= 500 ? 'server_error' : 'invalid_request_error',
      code,
    },
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/**
 * Starts the mock. Options (all optional):
 * - host ('127.0.0.1'), port (8090; 0 = random free port)
 * - speed (1): pacing multiplier; 10 replays ten times faster, Infinity without delays
 * - statusMode ('cycle' | 'busy' | 'idle' | 'saturated'), statusAdvance ('time' | 'poll'),
 *   statusStepMs (1000): how the /status snapshots advance
 * - idleReleaseMs (0 = off): simulate the 1.2 idle weight release after this
 *   long without a chat request; the next chat waits for a "restore"
 * - apiKey: require `Authorization: Bearer` / `x-api-key` on non-public routes
 * - allowedOrigins ([]): Origins admitted with CORS headers ('*' = any)
 * - fixturesDir, quiet (true)
 */
export async function startMockSplash(options = {}) {
  const config = {
    host: options.host ?? '127.0.0.1',
    port: options.port ?? 8090,
    speed: options.speed ?? 1,
    statusMode: options.statusMode ?? 'cycle',
    statusAdvance: options.statusAdvance ?? 'time',
    statusStepMs: options.statusStepMs ?? 1000,
    idleReleaseMs: options.idleReleaseMs ?? 0,
    apiKey: options.apiKey,
    allowedOrigins: options.allowedOrigins ?? [],
    quiet: options.quiet ?? true,
  };
  if (!STATUS_SEQUENCES[config.statusMode]) {
    throw new Error(`unknown statusMode ${config.statusMode}`);
  }
  const fixtures = loadFixtures(options.fixturesDir ?? DEFAULT_FIXTURES_DIR);
  const modelId = fixtures.models.data[0].id;
  const startedAt = Date.now();
  const instance = {
    id: randomBytes(12).toString('hex'),
    pid: process.pid,
    model: modelId,
    host: config.host,
    port: config.port,
    started_at: startedAt / 1000,
  };

  const stats = {
    requests: 0,
    statusPolls: 0,
    streams: { started: 0, active: 0, completed: 0, cancelled: 0 },
    lastChatRequest: null,
  };
  let lastChatAt = Date.now();
  let releasedSince = null;
  let restoringUntil = 0;

  const scale = (ms) => (config.speed === Infinity || config.speed <= 0 ? 0 : ms / config.speed);
  const log = (...args) => {
    if (!config.quiet) console.log(...args);
  };

  // --- /status -------------------------------------------------------------
  const sequence = STATUS_SEQUENCES[config.statusMode].map((name) => fixtures.status[name]);
  const first = sequence[0];
  const last = sequence[sequence.length - 1];

  function snapshotAtStep(step) {
    const index = step % sequence.length;
    const wraps = Math.floor(step / sequence.length);
    const snapshot = structuredClone(sequence[index]);
    if (wraps > 0) {
      for (const path of COUNTER_PATHS) {
        const value = getPath(snapshot, path);
        const span = (getPath(last, path) ?? 0) - (getPath(first, path) ?? 0);
        if (typeof value === 'number' && span > 0) setPath(snapshot, path, value + wraps * span);
      }
      offsetLatency(snapshot, wraps);
    }
    return snapshot;
  }

  /** latency histograms are cumulative too: offset count, sum and buckets. */
  function offsetLatency(snapshot, wraps) {
    for (const [stage, histogram] of Object.entries(snapshot.latency ?? {})) {
      const a = first.latency?.[stage];
      const b = last.latency?.[stage];
      if (!a || !b) continue;
      histogram.count += wraps * Math.max(0, b.count - a.count);
      histogram.sum += wraps * Math.max(0, b.sum - a.sum);
      for (const key of Object.keys(histogram.buckets ?? {})) {
        histogram.buckets[key] +=
          wraps * Math.max(0, (b.buckets[key] ?? 0) - (a.buckets[key] ?? 0));
      }
    }
  }

  function currentStep(now) {
    if (config.statusAdvance === 'poll') return stats.statusPolls;
    return Math.floor((now - startedAt) / Math.max(1, config.statusStepMs));
  }

  function isReleased(now) {
    if (config.idleReleaseMs <= 0) return false;
    if (releasedSince === null && now - lastChatAt >= config.idleReleaseMs) releasedSince = now;
    return releasedSince !== null;
  }

  function statusSnapshot(now) {
    const released = isReleased(now) || now < restoringUntil;
    // While released, counters freeze at the release moment.
    const step = currentStep(released && releasedSince !== null ? releasedSince : now);
    const snapshot = snapshotAtStep(step);
    if (released) {
      const r = fixtures.status.status_idle_released;
      snapshot.memory_actual = structuredClone(r.memory_actual);
      snapshot.memory_governor = structuredClone(r.memory_governor);
      for (const key of [
        'queued',
        'waiting_resources',
        'waiting_prefix',
        'prefilling',
        'decoding',
      ]) {
        snapshot.scheduler[key] = 0;
      }
      snapshot.admission = structuredClone(r.admission);
      snapshot.transport.pending = 0;
      snapshot.http.requests.active = 0;
      if (now < restoringUntil) {
        snapshot.scheduler.queued = 1;
        snapshot.transport.pending = 1;
        snapshot.http.requests.active = 1;
      }
    }
    snapshot.instance = { ...instance };
    return snapshot;
  }

  // --- responses -----------------------------------------------------------
  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin) return {};
    if (config.allowedOrigins.includes('*')) return { 'access-control-allow-origin': '*' };
    return {
      'access-control-allow-origin': origin,
      vary: 'Origin',
      'access-control-expose-headers': 'Retry-After, WWW-Authenticate',
    };
  }

  function send(req, res, status, body, headers = {}, contentType = 'application/json') {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
      server: 'Splash',
      'content-type': contentType,
      'content-length': Buffer.byteLength(payload),
      connection: 'close',
      ...corsHeaders(req),
      ...headers,
    });
    res.end(req.method === 'HEAD' ? undefined : payload);
    if (status >= 400) log(`Error · ${status} · ${req.method} ${req.url}`);
  }

  function sendError(req, res, key) {
    const spec = ERRORS[key];
    if (!spec) return false;
    const body = spec.body ?? fixtures.json(spec.file);
    send(req, res, spec.status, body, spec.headers ?? {});
    return true;
  }

  function readBody(req) {
    return new Promise((resolveBody, reject) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  /** Splash-style validation of a chat body; returns an error response or null. */
  function validateChat(body) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) {
      return [400, errorBody('messages must be a non-empty array', 'invalid_request_error', 400)];
    }
    if (!body.messages.some((message) => message && message.role === 'user')) {
      return [400, errorBody('messages must include a user message', 'invalid_request_error', 400)];
    }
    if (body.model !== undefined && body.model !== null) {
      const known = fixtures.models.data.some((entry) => entry.id === body.model);
      if (!known) {
        return [404, errorBody(`model ${body.model} not found`, 'model_not_found', 404)];
      }
    }
    if (body.reasoning_effort != null && !REASONING_EFFORTS.has(body.reasoning_effort)) {
      return [400, fixtures.json('error_reasoning_effort.json')];
    }
    if (
      body.temperature != null &&
      (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2)
    ) {
      return [400, fixtures.json('error_400.json')];
    }
    if (body.return_progress === true && body.stream !== true) {
      return [
        400,
        errorBody(
          'return_progress requires stream: true and must be a boolean',
          'invalid_request_error',
          400,
        ),
      ];
    }
    return null;
  }

  function nonStreamChat(body) {
    const kwargs = body.chat_template_kwargs ?? {};
    const hasImage = body.messages.some(
      (message) =>
        Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'),
    );
    if (body.response_format?.type === 'json_schema') return fixtures.chat.jsonSchema;
    if (hasImage) return fixtures.chat.image;
    if (kwargs.enable_thinking === false || body.reasoning_effort === 'none') {
      return fixtures.chat.thinkingOff;
    }
    if (body.reasoning_effort === 'low') return fixtures.chat.effortLow;
    return fixtures.chat.default;
  }

  function pickScenario(body, requested) {
    if (requested && STREAM_SCENARIOS[requested]) return requested;
    if (Array.isArray(body.tools) && body.tools.length > 0) return 'tools';
    const kwargs = body.chat_template_kwargs ?? {};
    if (kwargs.enable_thinking === true) return 'thinking';
    if (kwargs.enable_thinking === false || body.reasoning_effort === 'none') return 'no_thinking';
    return 'thinking';
  }

  /**
   * Builds the timed frame list for a stream: [{ at (ms), data | comment | 'headers' }].
   * `.sse` fixtures are paced like the live server: start chunk at once,
   * the first token after the fixture's own prefill time (timings.prompt_ms),
   * then the burst gaps recorded in chat_stream_long.timeline.jsonl.
   */
  function planStream(scenario, body, waitBeforeStartMs) {
    const recorded = fixtures.streams[scenario];
    const includeUsage = body.stream_options?.include_usage === true;
    const progress = body.return_progress === true;
    const keep = (frame) => {
      if (!frame.data) return true;
      if (!includeUsage && frame.data.includes('"choices":[]') && frame.data.includes('"usage"')) {
        return false;
      }
      if (!progress && frame.data.includes('"prompt_progress"')) return false;
      return true;
    };
    const plan = [];
    if (recorded.kind === 'timeline') {
      plan.push({ at: recorded.headerAt, headers: true });
      for (const frame of recorded.frames) if (keep(frame)) plan.push({ ...frame, at: frame.t });
      return plan;
    }
    // Weight restore after an idle release: headers + keepalive at 2 s, START later.
    let at = 0;
    if (waitBeforeStartMs > 0) {
      for (let k = 2000; k < waitBeforeStartMs; k += 2000) {
        if (k === 2000) plan.push({ at: k, headers: true });
        plan.push({ at: k, comment: 'splash-keepalive' });
      }
      at = waitBeforeStartMs;
    }
    if (!plan.some((step) => step.headers)) plan.push({ at, headers: true });
    const finish = recorded.frames.find((frame) => frame.data?.includes('"timings"'));
    const promptMs = finish ? (JSON.parse(finish.data).timings?.prompt_ms ?? 300) : 300;
    let gapIndex = 0;
    let firstToken = true;
    for (const frame of recorded.frames) {
      if (!keep(frame)) continue;
      if (frame.data && isTokenFrame(frame.data)) {
        if (firstToken) {
          at += promptMs;
          firstToken = false;
        } else {
          at += fixtures.tokenGapsMs[gapIndex++ % fixtures.tokenGapsMs.length];
        }
      }
      let data = frame.data;
      if (data && waitBeforeStartMs > 0 && data.includes('"queue_to_start_ms"')) {
        const parsed = JSON.parse(data);
        const latency = parsed.metrics?.request_latency;
        if (latency) {
          latency.queue_to_start_ms = waitBeforeStartMs;
          latency.ttft_ms += waitBeforeStartMs;
          latency.wall_ms += waitBeforeStartMs;
        }
        data = JSON.stringify(parsed);
      }
      plan.push(data === undefined ? { ...frame, at } : { ...frame, data, at });
    }
    return plan;
  }

  function streamChat(req, res, body, url) {
    const scenario = pickScenario(
      body,
      url.searchParams.get('scenario') ?? req.headers['x-mock-scenario'],
    );
    const injected = url.searchParams.get('mock_error') ?? req.headers['x-mock-error'];
    const now = Date.now();
    let waitMs = 0;
    if (isReleased(now)) {
      waitMs = 3070.606;
      restoringUntil = now + scale(waitMs);
      releasedSince = null;
    }
    lastChatAt = now;
    const plan = planStream(scenario, body, waitMs);
    if (injected === 'midstream') {
      const index = plan.findIndex((step, i) => i > 0 && step.data && isTokenFrame(step.data)) + 10;
      const at = plan[Math.min(index, plan.length - 1)]?.at ?? 0;
      plan.splice(
        Math.min(index, plan.length),
        plan.length,
        {
          at,
          data: JSON.stringify(
            errorBody('grammar mask was not answered within 5 s', 'mask_timeout', 503),
          ),
        },
        { at, data: '[DONE]' },
      );
    }

    stats.streams.started++;
    stats.streams.active++;
    const t0 = Date.now();
    let index = 0;
    let timer = null;
    let finished = false;

    const end = (cancelled) => {
      if (finished) return;
      finished = true;
      stats.streams.active--;
      if (cancelled) stats.streams.cancelled++;
      else stats.streams.completed++;
      if (timer) clearTimeout(timer);
      lastChatAt = Date.now();
    };

    res.on('close', () => {
      if (!finished) {
        log(`Cancelled · ${scenario}`);
        end(true);
      }
    });

    const step = () => {
      timer = null;
      if (finished) return;
      while (index < plan.length) {
        const item = plan[index];
        const due = t0 + scale(item.at);
        const wait = due - Date.now();
        if (wait > 1) {
          timer = setTimeout(step, wait);
          return;
        }
        index++;
        if (item.headers) {
          res.writeHead(200, {
            server: 'Splash',
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'close',
            ...corsHeaders(req),
          });
          res.flushHeaders?.();
        } else if (item.comment !== undefined) {
          res.write(`: ${item.comment}\n\n`);
        } else if (item.data !== undefined) {
          res.write(`data: ${item.data}\n\n`);
        }
      }
      if (!res.headersSent) {
        res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
      }
      // Timeline fixtures end with [DONE]; .sse fixtures include it too.
      end(false);
      res.end();
    };
    step();
  }

  async function handle(req, res) {
    stats.requests++;
    const url = new URL(req.url ?? '/', 'http://mock');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // Origin check (Splash refuses foreign Origins; same-origin and no Origin pass).
    const origin = req.headers.origin;
    if (origin) {
      const sameOrigin = origin === `http://${req.headers.host}`;
      const allowed =
        sameOrigin || config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin);
      if (!allowed) {
        return send(
          req,
          res,
          403,
          errorBody(
            `Origin ${origin} is not allowed; restart the server with --allowed-origin ${origin} to accept it`,
            'forbidden',
            403,
          ),
        );
      }
    }
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        allow: 'GET, HEAD, POST, DELETE, OPTIONS',
        'access-control-allow-methods': 'GET, HEAD, POST, DELETE, OPTIONS',
        'access-control-allow-headers': req.headers['access-control-request-headers'] ?? '',
        'access-control-max-age': '600',
        connection: 'close',
        ...corsHeaders(req),
      });
      return res.end();
    }

    // Mock control (not part of Splash).
    if (path === '/__mock/stats') return send(req, res, 200, stats);

    // Error injection: ?mock_error=400|401|403|404|500|503|recovering|context, or x-mock-error.
    const injected = url.searchParams.get('mock_error') ?? req.headers['x-mock-error'];
    if (injected && injected !== 'midstream' && sendError(req, res, String(injected))) return;

    if (config.apiKey && !PUBLIC_PATHS.has(path)) {
      const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      const key = req.headers['x-api-key'];
      if (bearer !== config.apiKey && key !== config.apiKey) return sendError(req, res, '401');
    }

    const get = method === 'GET' || method === 'HEAD';
    if (get && path === '/health') return send(req, res, 200, fixtures.health);
    if (get && path === '/ready') return send(req, res, 200, fixtures.ready);
    if (get && path === '/status') {
      const snapshot = statusSnapshot(Date.now());
      stats.statusPolls++;
      return send(req, res, 200, snapshot);
    }
    if (get && path === '/metrics') {
      return send(req, res, 200, fixtures.metrics, {}, 'text/plain; version=0.0.4; charset=utf-8');
    }
    if (get && path === '/v1/models') {
      return send(req, res, 200, fixtures.models, {
        'x-typesafe-request-id': `req_${randomBytes(8).toString('hex')}`,
      });
    }
    if (get && path.startsWith('/v1/models/')) {
      const id = decodeURIComponent(path.slice('/v1/models/'.length));
      if (fixtures.models.data.some((entry) => entry.id === id)) {
        return send(req, res, 200, fixtures.modelGet);
      }
      return send(req, res, 404, errorBody(`model ${id} not found`, 'model_not_found', 404));
    }

    if (method === 'POST') {
      const contentType = req.headers['content-type'] ?? '';
      const raw = await readBody(req);
      if (!/^application\/([\w.+-]+\+)?json/i.test(contentType)) {
        return send(
          req,
          res,
          415,
          errorBody('Content-Type must be application/json', 'invalid_request_error', 415),
        );
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(
          req,
          res,
          400,
          errorBody('request body must be valid JSON', 'invalid_request_error', 400),
        );
      }
      if (path === '/v1/chat/completions') {
        const invalid = validateChat(body);
        if (invalid) return send(req, res, invalid[0], invalid[1]);
        stats.lastChatRequest = body;
        if (body.stream === true) return streamChat(req, res, body, url);
        lastChatAt = Date.now();
        releasedSince = null;
        return send(req, res, 200, nonStreamChat(body));
      }
      if (path === '/v1/completions') return send(req, res, 200, fixtures.completions);
      if (path === '/tokenize') return send(req, res, 200, fixtures.tokenize);
      if (path === '/apply-template') return send(req, res, 200, fixtures.applyTemplate);
    }
    return send(req, res, 404, fixtures.json('error_404.json'));
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) {
        send(
          req,
          res,
          500,
          errorBody(String(error?.message ?? error), 'internal_server_error', 500),
        );
      } else {
        res.destroy();
      }
    });
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolveListen();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  instance.port = port;
  const url = `http://${config.host}:${port}`;

  return {
    url,
    host: config.host,
    port,
    server,
    stats,
    close: () =>
      new Promise((resolveClose) => {
        server.closeAllConnections?.();
        server.close(() => resolveClose());
      }),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.split('=', 2);
    const value = () => inline ?? argv[++i];
    switch (flag) {
      case '--port':
        options.port = Number(value());
        break;
      case '--host':
        options.host = value();
        break;
      case '--speed':
        options.speed = Number(value());
        break;
      case '--status':
        options.statusMode = value();
        break;
      case '--status-step-ms':
        options.statusStepMs = Number(value());
        break;
      case '--idle-release':
        options.idleReleaseMs = Number(value()) * 1000;
        break;
      case '--api-key':
        options.apiKey = value();
        break;
      case '--allowed-origin':
        options.allowedOrigins = [...(options.allowedOrigins ?? []), value()];
        break;
      case '--fixtures':
        options.fixturesDir = resolve(value());
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '-h':
      case '--help':
        console.log(
          'node dev/mock-splash/server.mjs [--port 8090] [--host 127.0.0.1] [--speed 1] ' +
            '[--status cycle|busy|idle|saturated] [--status-step-ms 1000] [--idle-release SECONDS] ' +
            '[--api-key KEY] [--allowed-origin ORIGIN]... [--fixtures DIR] [--quiet]',
        );
        process.exit(0);
        break;
      default:
        console.error(`unknown argument ${arg}`);
        process.exit(2);
    }
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  options.port ??= Number(process.env.SPLASH_PORT ?? 8090);
  if (options.apiKey === undefined && process.env.SPLASH_API_KEY) {
    options.apiKey = process.env.SPLASH_API_KEY;
  }
  startMockSplash(options).then(
    (mock) => {
      console.log(`Ready · mock Splash 1.2.0 (fixtures) · http://${mock.host}:${mock.port}`);
      const stop = () => {
        console.log('Stopping · mock');
        mock.close().then(() => process.exit(0));
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    },
    (error) => {
      console.error(`error: ${error.message}`);
      process.exit(1);
    },
  );
}
