/**
 * Pure derivations over successive `/status` snapshots
 * (docs/splash-api.md sections 4.3, 4.5, 9 and 9.1).
 *
 * `/status` counters are cumulative since engine start and its ratios are
 * lifetime values, so live numbers come from the difference between two
 * polls A and B (`Δ = B − A`, `dt` = wall time between the polls):
 *
 *   let tracker = initialStatusTracker();
 *   // every poll (1-2 Hz while visible):
 *   tracker = trackStatus(tracker, { at: Date.now(), status });
 *   tracker.live // LiveStatus for the dashboard
 *
 * Guards: a changed `instance.id` or `transport.restarts`, or any counter
 * that decreased, is a restart: the sample's rates are null and `reset` is
 * true (charts should restart). A `transport.status_stale` poll yields null
 * rates and is not used as the next baseline. Negative or NaN values become
 * null ("—").
 */
import type { MemoryPressure, StatusHistogram, StatusResponse } from './types';

export interface StatusSample {
  /** Wall-clock ms when the poll was answered (e.g. `Date.now()`). */
  at: number;
  status: StatusResponse;
}

/**
 * Whether the model weights are in memory (Splash 1.2 releases them after
 * 600 s without a generation request; no status field says so).
 * - `resident`: loaded.
 * - `released`: Metal memory is far below the weight size and nothing waits.
 * - `restoring`: released, and a request is queued while they reload
 *   ("Waking model"); lasts until prefill starts.
 * - `unknown`: not enough data (no memory section and no baseline yet).
 */
export type WeightsResidency = 'resident' | 'released' | 'restoring' | 'unknown';

/**
 * Engine phase for the status pill, most important first:
 * `failed` (restarts stopped) > `recovering` > `unavailable` (not ready, e.g.
 * critical memory pressure or no snapshot yet) > `waking` (weights restoring
 * for a queued request) > `decoding` > `prefilling` > `queued` (waiting for
 * a lane or memory) > `idle-released` > `idle`; `unknown` without a
 * scheduler section.
 */
export type EnginePhase =
  | 'failed'
  | 'recovering'
  | 'unavailable'
  | 'waking'
  | 'decoding'
  | 'prefilling'
  | 'queued'
  | 'idle-released'
  | 'idle'
  | 'unknown';

export type ResetReason = 'instance' | 'engine-restart' | 'counter-decrease';

/** Live values over the window between two polls; null without a valid previous poll. */
export interface StatusRates {
  /** Δdecode_output_tokens / dt (wall clock, all lanes). */
  decodeTokPerSec: number | null;
  /** Δdecode_output_tokens / Δdecode_wall_ms (GPU-busy rate). */
  decodeGpuTokPerSec: number | null;
  /** Δdecode_output_tokens / Δdecode_cycle_ms (incl. host overhead; 1.2+). */
  decodeCycleTokPerSec: number | null;
  /** Δprefill_input_tokens / dt. */
  prefillTokPerSec: number | null;
  /** Δprefill_input_tokens / Δprefill_wall_ms. */
  prefillGpuTokPerSec: number | null;
  /** Δaccepted_draft_tokens / Δdrafted_tokens. */
  draftAcceptanceRate: number | null;
  /** Lane decode cycles in the window: Σ width × Δdecode_batches_by_width.b<width>. */
  laneCycles: number | null;
  /** Drafted tokens per lane cycle (7 for DFlash2). */
  draftedPerCycle: number | null;
  /** Accepted draft tokens per lane cycle (out of `draftedPerCycle`). */
  acceptedPerCycle: number | null;
  /** Emitted tokens per lane cycle (= accepted + 1). */
  tokensPerCycle: number | null;
  /** Mean decode batch width (lanes per batch). */
  meanBatchWidth: number | null;
  /** Δrequests.completed / dt. */
  requestsPerSec: number | null;
  /** Δcache.hits / (Δhits + Δcold_misses): prefix-cache hit rate of requests in the window. */
  prefixCacheHitRate: number | null;
  /** Mean HTTP time to first token of requests in the window (`latency.http_ttft`, `ttft` on schema 5). */
  ttftMs: number | null;
}

/** Lifetime figures the server reports (not live; label them as averages). */
export interface StatusLifetime {
  decodeTokPerSec: number | null;
  prefillTokPerSec: number | null;
  draftAcceptanceRate: number | null;
  prefixCacheHitRate: number | null;
  ttftP50Ms: number | null;
  ttftP95Ms: number | null;
  itlP50Ms: number | null;
  itlP95Ms: number | null;
}

export interface StatusRequestsView {
  /** prefilling + decoding (native requests holding a lane). */
  running: number;
  prefilling: number;
  decoding: number;
  /** scheduler.queued + waiting_resources + waiting_prefix. */
  queued: number;
  /** admission.waiting and its reasons. */
  admissionWaiting: number;
  waitingMemory: number;
  waitingConcurrency: number;
  oldestWaitMs: number;
  /** HTTP requests in flight (includes preparation). */
  httpActive: number;
  /** Requests admitted by the Python side (running + waiting), and its limit (`--queue-size`). */
  pending: number;
  pendingLimit: number | null;
  submitted: number | null;
  completed: number | null;
  cancelled: number | null;
  failed: number | null;
}

export interface StatusKvView {
  blockTokens: number | null;
  activePages: number;
  cachePages: number;
  capacityPages: number | null;
  /** (active + cache) / capacity. */
  utilisation: number | null;
  /** active / capacity ("in use"). */
  activeUtilisation: number | null;
  /** (active + cache) × block tokens. */
  usedTokens: number | null;
  capacityTokens: number | null;
  allocatedPages: number;
  freePages: number;
  /** (allocated − free) / allocated. */
  residentRatio: number | null;
  allocatedBytes: number | null;
}

export interface StatusMemoryView {
  /** memory_actual.current_bytes (Metal, not RSS). */
  usedBytes: number | null;
  allocatedBytes: number | null;
  /** memory_governor.limit_bytes. */
  limitBytes: number | null;
  /** memory_governor.headroom_bytes (budget). */
  headroomBytes: number | null;
  /** Lifetime peak. */
  peakBytes: number | null;
  chargedBytes: number | null;
  /** used / limit. */
  usedRatio: number | null;
  hostHeadroomBytes: number | null;
  hostAvailableBytes: number | null;
  pressure: MemoryPressure | null;
  growthAllowed: boolean | null;
  /** target + draft weights (what an idle release frees). */
  weightsBytes: number | null;
}

export interface LiveStatus {
  at: number;
  schemaVersion: number;
  ready: boolean;
  /** `transport.status_stale`: the server returned its last snapshot. */
  stale: boolean;
  staleAgeMs: number | null;
  /** True when this poll could not be compared with the previous one (restart). */
  reset: boolean;
  resetReason: ResetReason | null;
  /** Ms since the previous poll used for the rates, or null. */
  intervalMs: number | null;
  phase: EnginePhase;
  /** scheduler.prefilling + decoding > 0, or HTTP requests in flight. */
  busy: boolean;
  weights: WeightsResidency;
  rates: StatusRates;
  lifetime: StatusLifetime;
  requests: StatusRequestsView;
  kv: StatusKvView;
  memory: StatusMemoryView;
  instance: { id: string; pid: number; model: string; startedAt: number } | null;
  engine: {
    restarts: number | null;
    recovering: boolean;
    stopped: boolean;
    error: string | null;
    metalHealthy: boolean | null;
  };
  contextTokens: number | null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** null for NaN, ±Infinity and negatives. */
function clean(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return clean(numerator / denominator);
}

function delta(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : b - a;
}

/** The cumulative counters checked for decreases (a restart). */
const COUNTERS: readonly ((s: StatusResponse) => unknown)[] = [
  (s) => s.requests?.submitted,
  (s) => s.requests?.completed,
  (s) => s.requests?.cancelled,
  (s) => s.requests?.failed,
  (s) => s.metrics?.decode_output_tokens,
  (s) => s.metrics?.prefill_input_tokens,
  (s) => s.metrics?.drafted_tokens,
  (s) => s.metrics?.accepted_draft_tokens,
  (s) => s.metrics?.decode_wall_ms,
  (s) => s.scheduler?.decode_batches,
  (s) => s.scheduler?.prefill_batches,
  (s) => s.cache?.hits,
  (s) => s.cache?.cold_misses,
];

/** Why `curr` cannot be compared with `prev`, or null if it can. */
export function detectReset(prev: StatusResponse, curr: StatusResponse): ResetReason | null {
  const prevId = prev.instance?.id;
  const currId = curr.instance?.id;
  if (prevId !== undefined && currId !== undefined && prevId !== currId) return 'instance';
  const prevRestarts = finite(prev.transport?.restarts);
  const currRestarts = finite(curr.transport?.restarts);
  if (prevRestarts !== null && currRestarts !== null && prevRestarts !== currRestarts) {
    return 'engine-restart';
  }
  for (const read of COUNTERS) {
    const a = finite(read(prev));
    const b = finite(read(curr));
    if (a !== null && b !== null && b < a) return 'counter-decrease';
  }
  return null;
}

/** target + draft weight bytes from the memory plan, if reported. */
export function weightsBytes(status: StatusResponse): number | null {
  const memory = status.memory_plan?.model?.memory;
  const budget = status.memory_plan?.budget;
  const target = finite(memory?.target_weights_bytes) ?? finite(budget?.target_weights_bytes);
  const draft = finite(memory?.draft_weights_bytes) ?? finite(budget?.draft_weights_bytes) ?? 0;
  return target !== null && target > 0 ? target + draft : null;
}

function running(status: StatusResponse): number {
  return (status.scheduler?.prefilling ?? 0) + (status.scheduler?.decoding ?? 0);
}

function waitingForStart(status: StatusResponse): boolean {
  const scheduler = status.scheduler;
  return (
    (scheduler?.queued ?? 0) + (scheduler?.waiting_resources ?? 0) > 0 ||
    (status.admission?.waiting ?? 0) > 0 ||
    (status.admission?.restoring ?? 0) > 0 ||
    ((status.transport?.pending ?? 0) > 0 && running(status) === 0)
  );
}

/**
 * Weight residency from one snapshot plus the previous verdict.
 *
 * Released = `memory_actual.current_bytes` below half of target + draft
 * weights (observed: 1.5 GB released vs 16.4 GB of weights, 18.9 GB
 * resident). Without a memory plan, `residentBaseline` (the idle memory seen
 * while resident) stands in for the weight size. Once released, a queued
 * request with nothing running is `restoring` until prefill starts, even
 * after memory has climbed past the threshold.
 */
export function weightsResidency(
  status: StatusResponse,
  previous: WeightsResidency = 'unknown',
  residentBaseline: number | null = null,
): WeightsResidency {
  const current = finite(status.memory_actual?.current_bytes);
  if (current === null) return 'unknown';
  const weights = weightsBytes(status) ?? residentBaseline;
  if (weights === null) return 'unknown';
  const waiting = waitingForStart(status) && running(status) === 0;
  if (current < weights * 0.5) return waiting ? 'restoring' : 'released';
  if ((previous === 'released' || previous === 'restoring') && waiting) return 'restoring';
  return 'resident';
}

export function enginePhase(status: StatusResponse, weights: WeightsResidency): EnginePhase {
  const transport = status.transport;
  if (transport?.stopped) return 'failed';
  if (transport?.recovering) return 'recovering';
  if (!status.ready) return 'unavailable';
  if (weights === 'restoring') return 'waking';
  const scheduler = status.scheduler;
  if (!scheduler) return weights === 'released' ? 'idle-released' : 'unknown';
  if (scheduler.decoding > 0) return 'decoding';
  if (scheduler.prefilling > 0) return 'prefilling';
  if (waitingForStart(status)) return 'queued';
  if (weights === 'released') return 'idle-released';
  return 'idle';
}

function histogramMeanMs(
  a: StatusHistogram | undefined,
  b: StatusHistogram | undefined,
): number | null {
  if (!a || !b) return null;
  const count = b.count - a.count;
  if (count <= 0) return null;
  return clean(((b.sum - a.sum) / count) * 1000);
}

function ttftHistogram(status: StatusResponse): StatusHistogram | undefined {
  return status.latency?.http_ttft ?? status.latency?.ttft;
}

function laneCycles(prev: StatusResponse, curr: StatusResponse): number | null {
  const a = prev.scheduler?.decode_batches_by_width;
  const b = curr.scheduler?.decode_batches_by_width;
  if (!a || !b) return null;
  let total = 0;
  for (const [key, value] of Object.entries(b)) {
    const width = Number(key.replace(/^b/, ''));
    const before = a[key] ?? 0;
    if (!Number.isFinite(width) || typeof value !== 'number') continue;
    total += width * (value - before);
  }
  return clean(total);
}

const NULL_RATES: StatusRates = {
  decodeTokPerSec: null,
  decodeGpuTokPerSec: null,
  decodeCycleTokPerSec: null,
  prefillTokPerSec: null,
  prefillGpuTokPerSec: null,
  draftAcceptanceRate: null,
  laneCycles: null,
  draftedPerCycle: null,
  acceptedPerCycle: null,
  tokensPerCycle: null,
  meanBatchWidth: null,
  requestsPerSec: null,
  prefixCacheHitRate: null,
  ttftMs: null,
};

/** Live rates between two comparable snapshots `dtMs` apart. */
export function computeRates(
  prev: StatusResponse,
  curr: StatusResponse,
  dtMs: number,
): StatusRates {
  if (!(dtMs > 0)) return NULL_RATES;
  const seconds = dtMs / 1000;
  const m0 = prev.metrics;
  const m1 = curr.metrics;
  const decoded = delta(finite(m0?.decode_output_tokens), finite(m1?.decode_output_tokens));
  const prefilled = delta(finite(m0?.prefill_input_tokens), finite(m1?.prefill_input_tokens));
  const drafted = delta(finite(m0?.drafted_tokens), finite(m1?.drafted_tokens));
  const accepted = delta(finite(m0?.accepted_draft_tokens), finite(m1?.accepted_draft_tokens));
  const decodeWall = delta(finite(m0?.decode_wall_ms), finite(m1?.decode_wall_ms));
  const decodeCycle = delta(finite(m0?.decode_cycle_ms), finite(m1?.decode_cycle_ms));
  const prefillWall = delta(finite(m0?.prefill_wall_ms), finite(m1?.prefill_wall_ms));
  const batches = delta(
    finite(prev.scheduler?.decode_batches),
    finite(curr.scheduler?.decode_batches),
  );
  const cycles = laneCycles(prev, curr) ?? (drafted !== null && drafted > 0 ? drafted / 7 : null);
  const hits = delta(finite(prev.cache?.hits), finite(curr.cache?.hits));
  const misses = delta(finite(prev.cache?.cold_misses), finite(curr.cache?.cold_misses));
  const completed = delta(finite(prev.requests?.completed), finite(curr.requests?.completed));
  const lookups = hits !== null && misses !== null ? hits + misses : null;
  return {
    decodeTokPerSec: clean(decoded === null ? null : decoded / seconds),
    decodeGpuTokPerSec: ratio(decoded, decodeWall === null ? null : decodeWall / 1000),
    decodeCycleTokPerSec: ratio(decoded, decodeCycle === null ? null : decodeCycle / 1000),
    prefillTokPerSec: clean(prefilled === null ? null : prefilled / seconds),
    prefillGpuTokPerSec: ratio(prefilled, prefillWall === null ? null : prefillWall / 1000),
    draftAcceptanceRate: ratio(accepted, drafted),
    laneCycles: cycles,
    draftedPerCycle: ratio(drafted, cycles),
    acceptedPerCycle: ratio(accepted, cycles),
    tokensPerCycle: ratio(decoded, cycles),
    meanBatchWidth: ratio(cycles, batches),
    requestsPerSec: clean(completed === null ? null : completed / seconds),
    prefixCacheHitRate: ratio(hits, lookups),
    ttftMs: histogramMeanMs(ttftHistogram(prev), ttftHistogram(curr)),
  };
}

export function lifetimeStats(status: StatusResponse): StatusLifetime {
  const metrics = status.metrics;
  return {
    decodeTokPerSec: clean(finite(metrics?.decode_tokens_per_second)),
    prefillTokPerSec: clean(finite(metrics?.prefill_tokens_per_second)),
    draftAcceptanceRate: clean(finite(metrics?.draft_acceptance_rate)),
    prefixCacheHitRate: clean(finite(status.cache?.hit_rate)),
    ttftP50Ms: metrics?.ttft_ms?.samples ? clean(finite(metrics.ttft_ms.p50)) : null,
    ttftP95Ms: metrics?.ttft_ms?.samples ? clean(finite(metrics.ttft_ms.p95)) : null,
    itlP50Ms: metrics?.itl_ms?.samples ? clean(finite(metrics.itl_ms.p50)) : null,
    itlP95Ms: metrics?.itl_ms?.samples ? clean(finite(metrics.itl_ms.p95)) : null,
  };
}

export function requestsView(status: StatusResponse): StatusRequestsView {
  const scheduler = status.scheduler;
  const admission = status.admission;
  return {
    running: running(status),
    prefilling: scheduler?.prefilling ?? 0,
    decoding: scheduler?.decoding ?? 0,
    queued:
      (scheduler?.queued ?? 0) +
      (scheduler?.waiting_resources ?? 0) +
      (scheduler?.waiting_prefix ?? 0),
    admissionWaiting: admission?.waiting ?? 0,
    waitingMemory: admission?.waiting_memory ?? 0,
    waitingConcurrency: admission?.waiting_concurrency ?? 0,
    oldestWaitMs: admission?.oldest_wait_ms ?? 0,
    httpActive: status.http?.requests.active ?? 0,
    pending: status.transport?.pending ?? 0,
    pendingLimit: finite(status.transport?.pending_limit),
    submitted: finite(status.requests?.submitted),
    completed: finite(status.requests?.completed),
    cancelled: finite(status.requests?.cancelled),
    failed: finite(status.requests?.failed),
  };
}

export function kvView(status: StatusResponse): StatusKvView {
  const kv = status.kv;
  const budget = status.memory_plan?.budget;
  const active = kv?.pages_active ?? 0;
  const cache = kv?.pages_cache ?? 0;
  const capacity = finite(budget?.kv_capacity_pages);
  const blockTokens = finite(kv?.block_tokens) ?? finite(budget?.kv_page_tokens);
  const allocated = kv?.pages_allocated ?? 0;
  const free = kv?.pages_free ?? 0;
  return {
    blockTokens,
    activePages: active,
    cachePages: cache,
    capacityPages: capacity,
    utilisation: ratio(active + cache, capacity),
    activeUtilisation: ratio(active, capacity),
    usedTokens: blockTokens === null ? null : (active + cache) * blockTokens,
    capacityTokens:
      finite(budget?.kv_capacity_tokens) ??
      (capacity !== null && blockTokens !== null ? capacity * blockTokens : null),
    allocatedPages: allocated,
    freePages: free,
    residentRatio: ratio(allocated - free, allocated),
    allocatedBytes: finite(kv?.allocated_bytes),
  };
}

export function memoryView(status: StatusResponse): StatusMemoryView {
  const actual = status.memory_actual;
  const governor = status.memory_governor;
  const used = finite(actual?.current_bytes);
  const limit = finite(governor?.limit_bytes);
  return {
    usedBytes: used,
    allocatedBytes: finite(actual?.allocated_bytes),
    limitBytes: limit,
    headroomBytes: finite(governor?.headroom_bytes),
    peakBytes: finite(actual?.peak_bytes),
    chargedBytes: finite(governor?.charged_bytes),
    usedRatio: ratio(used, limit),
    hostHeadroomBytes: finite(governor?.host_headroom_bytes),
    hostAvailableBytes: finite(governor?.host_available_bytes),
    pressure: status.memory_pressure ?? governor?.system_pressure ?? null,
    growthAllowed: governor?.growth_allowed ?? null,
    weightsBytes: weightsBytes(status),
  };
}

export interface DeriveOptions {
  /** Residency verdict of the previous poll (enables `restoring`). */
  previousWeights?: WeightsResidency;
  /** Idle resident memory seen earlier (stands in for the weight size on old servers). */
  residentBaseline?: number | null;
}

/**
 * Everything the dashboard shows for one poll. `prev` is the last
 * comparable (non-stale) poll, or undefined for the first one.
 */
export function deriveLiveStatus(
  prev: StatusSample | undefined,
  curr: StatusSample,
  options: DeriveOptions = {},
): LiveStatus {
  const status = curr.status;
  const stale = status.transport?.status_stale === true;
  const resetReason = prev ? detectReset(prev.status, status) : null;
  const comparable = prev !== undefined && !stale && resetReason === null;
  const intervalMs = comparable ? curr.at - prev.at : null;
  const rates =
    comparable && intervalMs !== null ? computeRates(prev.status, status, intervalMs) : NULL_RATES;
  const weights = weightsResidency(
    status,
    resetReason === null ? options.previousWeights : 'unknown',
    options.residentBaseline ?? null,
  );
  const scheduler = status.scheduler;
  const instance = status.instance;
  return {
    at: curr.at,
    schemaVersion: status.schema_version,
    ready: status.ready,
    stale,
    staleAgeMs: stale ? finite(status.transport?.status_age_ms) : null,
    reset: resetReason !== null,
    resetReason,
    intervalMs,
    phase: enginePhase(status, weights),
    busy:
      (scheduler ? scheduler.prefilling + scheduler.decoding > 0 : false) ||
      (status.http?.requests.active ?? 0) > 0,
    weights,
    rates,
    lifetime: lifetimeStats(status),
    requests: requestsView(status),
    kv: kvView(status),
    memory: memoryView(status),
    instance: instance
      ? {
          id: instance.id,
          pid: instance.pid,
          model: instance.model,
          startedAt: instance.started_at,
        }
      : null,
    engine: {
      restarts: finite(status.transport?.restarts),
      recovering: status.transport?.recovering ?? false,
      stopped: status.transport?.stopped ?? false,
      error: status.transport?.error ?? null,
      metalHealthy: status.metal?.healthy ?? null,
    },
    contextTokens:
      finite(status.maximum_context_tokens) ?? finite(status.memory_plan?.maximum_context_tokens),
  };
}

// ---------------------------------------------------------------------------
// Tracker (pure reducer over polls)
// ---------------------------------------------------------------------------

export interface StatusTrackerState {
  /** Last non-stale poll: the baseline for the next rates. */
  last: StatusSample | null;
  /** Derived view of the most recent poll. */
  live: LiveStatus | null;
  weights: WeightsResidency;
  /** Idle resident Metal memory (fallback weight size for old servers). */
  residentBaseline: number | null;
  /** Wall ms of the last observed generation activity (submitted changed, or busy). */
  lastActivityAt: number | null;
  /** Restarts detected so far; charts reset when it changes. */
  resets: number;
}

export function initialStatusTracker(): StatusTrackerState {
  return {
    last: null,
    live: null,
    weights: 'unknown',
    residentBaseline: null,
    lastActivityAt: null,
    resets: 0,
  };
}

/** Folds one poll into the tracker. Pure. */
export function trackStatus(state: StatusTrackerState, sample: StatusSample): StatusTrackerState {
  const live = deriveLiveStatus(state.last ?? undefined, sample, {
    previousWeights: state.weights,
    residentBaseline: state.residentBaseline,
  });
  if (live.stale) {
    return { ...state, live };
  }
  const status = sample.status;
  const submittedChanged =
    state.last !== null &&
    !live.reset &&
    finite(state.last.status.requests?.submitted) !== finite(status.requests?.submitted);
  const active = live.busy || live.requests.queued > 0 || submittedChanged;
  const idleResident =
    live.weights === 'resident' && !live.busy && live.requests.queued === 0 && !live.reset;
  return {
    last: sample,
    live,
    weights: live.weights,
    residentBaseline: idleResident
      ? (finite(status.memory_actual?.current_bytes) ?? state.residentBaseline)
      : state.residentBaseline,
    lastActivityAt: active ? sample.at : state.lastActivityAt,
    resets: state.resets + (live.reset ? 1 : 0),
  };
}

/** Splash 1.2 releases the weights after this long without a generation request. */
export const IDLE_RELEASE_MS = 600_000;

/**
 * Ms until the engine would release its weights, from the tracker's last
 * observed activity (0 when due), or null if no activity was seen. A
 * heuristic: the release is decided by the engine, not by polls.
 */
export function msUntilIdleRelease(state: StatusTrackerState, now: number): number | null {
  if (state.lastActivityAt === null) return null;
  return Math.max(0, IDLE_RELEASE_MS - (now - state.lastActivityAt));
}
