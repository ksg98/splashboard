import { describe, expect, it } from 'vitest';
import idleReleaseTrace from '../../../fixtures/splash-1.2.0/idle_release_trace.jsonl?raw';
import afterJson from '../../../fixtures/splash-1.2.0/status_after.json';
import afterCancelJson from '../../../fixtures/splash-1.2.0/status_after_cancel.json';
import afterRestoreJson from '../../../fixtures/splash-1.2.0/status_after_restore.json';
import busy2Json from '../../../fixtures/splash-1.2.0/status_busy_2.json';
import busyJson from '../../../fixtures/splash-1.2.0/status_busy.json';
import idleReleasedJson from '../../../fixtures/splash-1.2.0/status_idle_released.json';
import idleJson from '../../../fixtures/splash-1.2.0/status_idle.json';
import restoreStartJson from '../../../fixtures/splash-1.2.0/status_restore_start.json';
import saturatedJson from '../../../fixtures/splash-1.2.0/status_saturated.json';
import {
  computeRates,
  deriveLiveStatus,
  detectReset,
  enginePhase,
  initialStatusTracker,
  msUntilIdleRelease,
  trackStatus,
  weightsResidency,
  type StatusTrackerState,
  type WeightsResidency,
} from './status';
import type { StatusResponse } from './types';

const fixture = (json: unknown): StatusResponse => structuredClone(json) as StatusResponse;
const idle = fixture(idleJson);
const busy = fixture(busyJson);
const busy2 = fixture(busy2Json);
const saturated = fixture(saturatedJson);
const after = fixture(afterJson);
const afterCancel = fixture(afterCancelJson);
const released = fixture(idleReleasedJson);
const restoreStart = fixture(restoreStartJson);
const afterRestore = fixture(afterRestoreJson);

describe('computeRates (docs/splash-api.md 9.1 worked example)', () => {
  // status_busy_2.json was taken 1.006 s after status_busy.json.
  const rates = computeRates(busy, busy2, 1006);

  it('derives live decode speed three ways', () => {
    expect(rates.decodeTokPerSec).toBeCloseTo(42 / 1.006, 3); // 41.7 tok/s
    expect(rates.decodeGpuTokPerSec).toBeCloseTo(42.27, 2);
    expect(rates.decodeCycleTokPerSec).toBeCloseTo(42.0, 1);
    expect(rates.prefillTokPerSec).toBe(0);
    expect(rates.prefillGpuTokPerSec).toBeNull(); // no prefill in the window
  });

  it('derives draft acceptance and per-cycle figures', () => {
    expect(rates.draftAcceptanceRate).toBeCloseTo(25 / 119, 4);
    expect(rates.laneCycles).toBe(17);
    expect(rates.draftedPerCycle).toBe(7);
    expect(rates.acceptedPerCycle).toBeCloseTo(25 / 17, 4);
    expect(rates.tokensPerCycle).toBeCloseTo(2.47, 2);
    expect(rates.meanBatchWidth).toBe(1);
  });

  it('has no TTFT or cache figures when no request started in the window', () => {
    expect(rates.ttftMs).toBeNull();
    expect(rates.prefixCacheHitRate).toBeNull();
    expect(rates.requestsPerSec).toBe(0);
  });

  it('weights the batch width by lane cycles (4 lanes saturated)', () => {
    const window = computeRates(after, saturated, 2000);
    // Δb1 = 4, Δb3 = 2, Δb4 = 5 -> 4 + 6 + 20 lane cycles over 11 batches.
    expect(window.laneCycles).toBe(30);
    expect(window.meanBatchWidth).toBeCloseTo(30 / 11, 4);
    expect(window.prefixCacheHitRate).toBe(0); // 5 cold misses, no hits
    // Mean HTTP TTFT of the 5 requests that got their first token in the window.
    expect(window.ttftMs).toBeCloseTo(((84.62783270699583 - 8.107276622991776) / 5) * 1000, 3);
  });

  it('returns nulls for a zero or negative interval', () => {
    expect(computeRates(busy, busy2, 0).decodeTokPerSec).toBeNull();
  });
});

describe('deriveLiveStatus', () => {
  it('reports KV, memory, requests and lifetime values (status_busy_2)', () => {
    const live = deriveLiveStatus({ at: 0, status: busy }, { at: 1006, status: busy2 });
    expect(live.reset).toBe(false);
    expect(live.intervalMs).toBe(1006);
    expect(live.phase).toBe('decoding');
    expect(live.busy).toBe(true);
    expect(live.weights).toBe('resident');
    expect(live.kv).toMatchObject({
      activePages: 5,
      cachePages: 12,
      capacityPages: 32768,
      usedTokens: 17 * 32,
      capacityTokens: 1048576,
    });
    expect(live.kv.utilisation).toBeCloseTo(17 / 32768, 8);
    expect(live.kv.activeUtilisation).toBeCloseTo(5 / 32768, 8);
    expect(live.kv.residentRatio).toBeCloseTo(13 / 128, 6);
    expect(live.memory.usedBytes).toBe(19074908160);
    expect(live.memory.limitBytes).toBe(54549532836);
    expect(live.memory.usedRatio).toBeCloseTo(0.35, 2);
    expect(live.memory.headroomBytes).toBe(34670046884);
    expect(live.memory.peakBytes).toBe(19929497600);
    expect(live.memory.weightsBytes).toBe(15159640064 + 1266040832);
    expect(live.memory.pressure).toBe('normal');
    expect(live.requests).toMatchObject({ running: 1, decoding: 1, queued: 0, httpActive: 1 });
    expect(live.lifetime.draftAcceptanceRate).toBeCloseTo(203 / 637, 4); // lifetime, not live
    expect(live.lifetime.ttftP50Ms).toBeCloseTo(333.863, 3);
    expect(live.contextTokens).toBe(262144);
    expect(live.instance?.id).toBe('8b38709cfc5254e1f9b4fcaf');
  });

  it('shows queued requests while the lanes are saturated', () => {
    const live = deriveLiveStatus(undefined, { at: 0, status: saturated });
    expect(live.phase).toBe('decoding');
    expect(live.requests).toMatchObject({
      running: 4,
      queued: 1,
      admissionWaiting: 1,
      waitingConcurrency: 1,
      pending: 5,
      pendingLimit: 32,
    });
    expect(live.requests.oldestWaitMs).toBeCloseTo(1240.48, 2);
    expect(live.rates.decodeTokPerSec).toBeNull(); // first poll: no baseline
  });

  it('is idle with no requests (status_idle, status_after_cancel)', () => {
    expect(deriveLiveStatus(undefined, { at: 0, status: idle }).phase).toBe('idle');
    const live = deriveLiveStatus({ at: 0, status: busy2 }, { at: 1000, status: afterCancel });
    expect(live.phase).toBe('idle');
    expect(live.busy).toBe(false);
    expect(live.requests.cancelled).toBe(1);
  });

  it('detects released weights from memory alone (status_idle_released)', () => {
    const live = deriveLiveStatus(undefined, { at: 0, status: released });
    expect(live.ready).toBe(true);
    expect(live.weights).toBe('released');
    expect(live.phase).toBe('idle-released');
    expect(deriveLiveStatus(undefined, { at: 0, status: restoreStart }).phase).toBe(
      'idle-released',
    );
    expect(deriveLiveStatus(undefined, { at: 0, status: afterRestore }).weights).toBe('resident');
  });

  it('treats a stale poll as rate-less', () => {
    const stale = structuredClone(busy2);
    if (stale.transport) {
      stale.transport.status_stale = true;
      stale.transport.status_age_ms = 4200;
    }
    const live = deriveLiveStatus({ at: 0, status: busy }, { at: 1000, status: stale });
    expect(live.stale).toBe(true);
    expect(live.staleAgeMs).toBe(4200);
    expect(live.rates.decodeTokPerSec).toBeNull();
  });

  it('tolerates the minimal snapshot served before the engine has one', () => {
    const minimal: StatusResponse = {
      schema_version: 6,
      ready: false,
      transport: {
        ready: false,
        recovering: false,
        stopped: false,
        pending: 0,
        pending_limit: 32,
        restarts: 0,
        last_crash_trace: null,
        status_stale: false,
        status_age_ms: 0,
      },
    };
    const live = deriveLiveStatus({ at: 0, status: idle }, { at: 500, status: minimal });
    expect(live.phase).toBe('unavailable');
    expect(live.weights).toBe('unknown');
    expect(live.kv.utilisation).toBeNull();
    expect(live.memory.usedBytes).toBeNull();
    expect(live.rates.decodeTokPerSec).toBeNull();
  });

  it('reports recovering and failed engines first', () => {
    const recovering = structuredClone(busy2);
    recovering.ready = false;
    if (recovering.transport) {
      recovering.transport.recovering = true;
      recovering.transport.error = 'native engine exited';
    }
    const live = deriveLiveStatus(undefined, { at: 0, status: recovering });
    expect(live.phase).toBe('recovering');
    expect(live.engine.error).toBe('native engine exited');
    if (recovering.transport) recovering.transport.stopped = true;
    expect(deriveLiveStatus(undefined, { at: 0, status: recovering }).phase).toBe('failed');
  });

  it('reads schema 5 servers (no decode_cycle_ms, latency.ttft, no memory plan)', () => {
    const toV5 = (status: StatusResponse): StatusResponse => {
      const v5 = structuredClone(status);
      v5.schema_version = 5;
      if (v5.metrics) delete v5.metrics.decode_cycle_ms;
      if (v5.latency) {
        v5.latency.ttft = v5.latency.http_ttft;
        delete v5.latency.http_ttft;
      }
      delete v5.memory_plan;
      return v5;
    };
    const rates = computeRates(toV5(after), toV5(saturated), 2000);
    expect(rates.decodeCycleTokPerSec).toBeNull();
    expect(rates.decodeTokPerSec).toBeGreaterThan(0);
    expect(rates.ttftMs).toBeGreaterThan(0);
    const live = deriveLiveStatus(undefined, { at: 0, status: toV5(released) });
    expect(live.weights).toBe('unknown');
    // With a resident baseline learned earlier, the release is still detected.
    const withBaseline = deriveLiveStatus(
      undefined,
      { at: 0, status: toV5(released) },
      { residentBaseline: 18878824448 },
    );
    expect(withBaseline.weights).toBe('released');
  });
});

describe('detectReset', () => {
  it('flags a different server instance', () => {
    expect(detectReset(idle, released)).toBe('instance');
  });

  it('flags an engine restart', () => {
    const restarted = structuredClone(after);
    if (restarted.transport) restarted.transport.restarts = 1;
    expect(detectReset(after, restarted)).toBe('engine-restart');
  });

  it('flags counters that went backwards', () => {
    expect(detectReset(saturated, idle)).toBe('counter-decrease');
    expect(detectReset(busy, busy2)).toBeNull();
  });

  it('drops the rates of a reset sample and counts resets in the tracker', () => {
    let tracker = initialStatusTracker();
    tracker = trackStatus(tracker, { at: 0, status: saturated });
    tracker = trackStatus(tracker, { at: 1000, status: idle });
    expect(tracker.live?.reset).toBe(true);
    expect(tracker.live?.resetReason).toBe('counter-decrease');
    expect(tracker.live?.rates.decodeTokPerSec).toBeNull();
    expect(tracker.resets).toBe(1);
    // The next poll compares against the post-restart baseline again.
    tracker = trackStatus(tracker, { at: 2000, status: busy });
    expect(tracker.live?.reset).toBe(false);
    expect(tracker.live?.rates.decodeTokPerSec).toBeCloseTo(255 / 1, 3);
  });
});

describe('trackStatus', () => {
  it('does not advance the baseline on a stale poll', () => {
    let tracker = trackStatus(initialStatusTracker(), { at: 0, status: busy });
    const stale = structuredClone(busy);
    if (stale.transport) stale.transport.status_stale = true;
    tracker = trackStatus(tracker, { at: 500, status: stale });
    expect(tracker.live?.stale).toBe(true);
    expect(tracker.last?.at).toBe(0);
    tracker = trackStatus(tracker, { at: 1006, status: busy2 });
    expect(tracker.live?.rates.decodeTokPerSec).toBeCloseTo(42 / 1.006, 3);
  });

  it('records generation activity for the idle-release countdown', () => {
    let tracker = trackStatus(initialStatusTracker(), { at: 0, status: idle });
    expect(tracker.lastActivityAt).toBeNull();
    expect(msUntilIdleRelease(tracker, 0)).toBeNull();
    tracker = trackStatus(tracker, { at: 10_000, status: busy });
    expect(tracker.lastActivityAt).toBe(10_000);
    tracker = trackStatus(tracker, { at: 20_000, status: afterCancel });
    tracker = trackStatus(tracker, { at: 30_000, status: afterCancel });
    expect(tracker.lastActivityAt).toBe(20_000);
    expect(msUntilIdleRelease(tracker, 30_000)).toBe(590_000);
    expect(msUntilIdleRelease(tracker, 700_000)).toBe(0);
  });

  it('learns the idle resident memory as a fallback weight size', () => {
    const tracker = trackStatus(initialStatusTracker(), { at: 0, status: idle });
    expect(tracker.residentBaseline).toBe(18878824448);
  });
});

describe('idle weight release and restore (idle_release_trace.jsonl)', () => {
  interface TraceRow {
    event: string;
    t: number;
    dt?: number;
    current_bytes?: number;
    allocated_bytes?: number;
    charged?: number;
    status_ready?: boolean;
    transport?: StatusResponse['transport'];
    scheduler?: StatusResponse['scheduler'];
    admission?: StatusResponse['admission'];
  }

  /** Each poll row only has a few fields: merge it into the idle snapshot of the same model. */
  function snapshot(row: TraceRow): StatusResponse {
    const status = structuredClone(idle);
    if (status.memory_actual && row.current_bytes !== undefined) {
      status.memory_actual.current_bytes = row.current_bytes;
      status.memory_actual.allocated_bytes = row.allocated_bytes ?? row.current_bytes;
    }
    if (status.memory_governor && row.charged !== undefined) {
      status.memory_governor.charged_bytes = row.charged;
    }
    if (row.status_ready !== undefined) status.ready = row.status_ready;
    if (row.transport) status.transport = row.transport;
    if (row.scheduler) status.scheduler = row.scheduler;
    if (row.admission) status.admission = row.admission;
    return status;
  }

  const rows = idleReleaseTrace
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as TraceRow)
    .filter((row) => row.event === 'poll' || row.event === 'restore_poll');

  function replayTrace() {
    let tracker: StatusTrackerState = initialStatusTracker();
    const seen: { t: number; event: string; weights: WeightsResidency; phase: string }[] = [];
    for (const row of rows) {
      const at = row.event === 'restore_poll' ? 631_576 + (row.dt ?? 0) * 1000 : row.t * 1000;
      tracker = trackStatus(tracker, { at, status: snapshot(row) });
      const live = tracker.live;
      if (live) seen.push({ t: row.t, event: row.event, weights: live.weights, phase: live.phase });
    }
    return seen;
  }

  it('stays resident for 600 s of /status polls, then detects the release', () => {
    const seen = replayTrace();
    const polls = seen.filter((s) => s.event === 'poll');
    const firstReleased = polls.findIndex((s) => s.weights === 'released');
    expect(firstReleased).toBeGreaterThan(100);
    expect(polls.slice(0, firstReleased).every((s) => s.weights === 'resident')).toBe(true);
    expect(polls[firstReleased]?.t).toBeCloseTo(621.552, 3);
    expect(polls[firstReleased]?.phase).toBe('idle-released');
    expect(polls.slice(firstReleased).every((s) => s.phase === 'idle-released')).toBe(true);
  });

  it('shows waking while the queued request waits for the weights, then prefilling', () => {
    const restore = replayTrace().filter((s) => s.event === 'restore_poll');
    expect(restore[0]?.phase).toBe('idle-released'); // 4 ms after sending, not yet queued
    const waking = restore.slice(1, -1);
    expect(waking.length).toBeGreaterThan(5);
    expect(waking.every((s) => s.weights === 'restoring' && s.phase === 'waking')).toBe(true);
    expect(restore[restore.length - 1]).toMatchObject({ weights: 'resident', phase: 'prefilling' });
  });

  it('keeps restoring once memory is past the threshold but prefill has not started', () => {
    const climbing = snapshot({
      event: 'restore_poll',
      t: 0,
      current_bytes: 16869982208,
      transport: { ...(idle.transport as NonNullable<StatusResponse['transport']>), pending: 1 },
      scheduler: { ...(idle.scheduler as NonNullable<StatusResponse['scheduler']>), queued: 1 },
    });
    expect(weightsResidency(climbing, 'restoring')).toBe('restoring');
    expect(weightsResidency(climbing, 'resident')).toBe('resident');
    expect(enginePhase(climbing, 'resident')).toBe('queued');
  });
});
