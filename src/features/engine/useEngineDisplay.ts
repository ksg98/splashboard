/**
 * Engine state + /status telemetry → the display-ready props of the engine
 * views (Activity, the sidebar engine row, the engine popover).
 */
import { useEffect, useMemo } from 'react';
import {
  displayModelName,
  engineWord,
  launchPhaseWord,
  useLaunchStore,
  type EngineWord,
} from '@/lib/launch';
import type { EngineState, LogLine as EngineLogLine } from '@/lib/splash/engine';
import { useEngineStore } from '@/lib/splash/engine-store';
import {
  formatUptime,
  recentMean,
  recentSpeed,
  useTelemetryStore,
  type TelemetrySample,
} from '@/lib/telemetry';
import type { LiveStatus } from '@/lib/splash/status';
import { useNow } from '@/lib/useNow';
import type {
  ActivityDetails,
  ActivityStats,
  ActivityStatus,
  LogLine,
  LogSource,
  SpeedHistory,
  StartPhase,
} from './views/types';

const GB = 1024 ** 3;

const PHASE_PROGRESS: Partial<Record<EngineState['phase'], number>> = {
  starting: 0.1,
  downloading: 0.2,
  loading_weights: 0.5,
  warming: 0.85,
  restoring: 0.6,
  recovering: 0.3,
};

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function dayAndTime(ms: number | null | undefined): string {
  if (!ms) return 'never';
  const date = new Date(ms);
  const today = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toDateString() === today.toDateString()
    ? `today at ${time}`
    : `${date.toLocaleDateString()} at ${time}`;
}

function lineKind(line: EngineLogLine): LogLine['kind'] {
  if (/\b(error|failed|traceback|exception)\b/i.test(line.line)) return 'error';
  if (/^(Done|Cancelled|Failed)\b/.test(line.line.trim())) return 'request';
  return 'info';
}

export function toViewLogLines(lines: readonly EngineLogLine[]): LogLine[] {
  return lines.map((line) => ({
    id: String(line.seq),
    time: clock(line.tsMs),
    text: line.line,
    kind: lineKind(line),
  }));
}

function startPhase(state: EngineState, now: number): StartPhase {
  const fraction =
    state.phase === 'downloading' && state.progress?.fraction != null
      ? 0.05 + state.progress.fraction * 0.4
      : (PHASE_PROGRESS[state.phase] ?? 0.1);
  return {
    label: launchPhaseWord(state.phase) ?? 'Starting',
    elapsedSeconds: Math.max(0, Math.round((now - (state.startedAtMs ?? state.sinceMs)) / 1000)),
    progress: fraction,
  };
}

function activityStatus(
  state: EngineState,
  word: EngineWord,
  live: LiveStatus | null,
  uptime: string,
  now: number,
): ActivityStatus {
  if (state.phase === 'failed') {
    return {
      kind: 'failed',
      reason: state.reason,
      at: dayAndTime(state.sinceMs),
      lastLines: state.lastLogLines.map((text, index) => ({
        id: `f${index}`,
        time: '',
        text,
        kind: /error|failed/i.test(text) ? 'error' : 'info',
      })),
    };
  }
  if (word.serving) {
    if (live?.weights === 'released' && !live.busy) return { kind: 'idle', uptime };
    const requests = live ? live.requests.running + live.requests.queued : 0;
    if (live?.busy || state.phase === 'busy')
      return { kind: 'busy', requests: Math.max(1, requests), uptime };
    return { kind: 'ready', requests, uptime };
  }
  if (word.launching) return { kind: 'starting', phase: startPhase(state, now) };
  return { kind: 'stopped', lastRan: dayAndTime(state.lastExit?.atMs ?? state.readyAtMs) };
}

function activityStats(live: LiveStatus | null, samples: TelemetrySample[]): ActivityStats | null {
  if (!live) return null;
  const drafted = recentMean(samples, (s) => s.draftedPerCycle, 30);
  return {
    tokensPerSecond: recentSpeed(samples),
    draftAcceptance:
      recentMean(samples, (s) => s.acceptance, 30) ?? live.lifetime.draftAcceptanceRate ?? 0,
    draftTokensPerStep: drafted ? Math.round(drafted) : 7,
    memoryUsedGB: (live.memory.usedBytes ?? 0) / GB,
    memoryTotalGB: (live.memory.limitBytes ?? 0) / GB,
    promptCacheReuse: live.lifetime.prefixCacheHitRate ?? live.rates.prefixCacheHitRate ?? 0,
  };
}

function activityDetails(
  live: LiveStatus | null,
  state: EngineState,
  model: string,
  uptime: string,
  samples: TelemetrySample[],
): ActivityDetails | null {
  if (!live) return null;
  const pageBytes =
    live.kv.allocatedBytes && live.kv.allocatedPages
      ? live.kv.allocatedBytes / live.kv.allocatedPages
      : null;
  const pagesToGB = (pages: number | null) =>
    pageBytes && pages != null ? (pages * pageBytes) / GB : 0;
  const kvFlag = state.command?.argv.find((arg) => arg.startsWith('--kv-format='));
  return {
    requests: {
      active: live.requests.running,
      capacity: 4,
      waiting: live.requests.queued,
      finished: live.requests.completed ?? 0,
    },
    speed: {
      readingPromptsTokensPerSecond:
        recentMean(
          samples,
          (s) => (s.prefillTokPerSec && s.prefillTokPerSec > 0 ? s.prefillTokPerSec : null),
          60,
        ) ?? live.lifetime.prefillTokPerSec,
      firstTokenTypicalSeconds:
        live.lifetime.ttftP50Ms != null ? live.lifetime.ttftP50Ms / 1000 : null,
      firstTokenSlowestSeconds:
        live.lifetime.ttftP95Ms != null ? live.lifetime.ttftP95Ms / 1000 : null,
    },
    workingMemory: {
      inUseGB: pagesToGB(live.kv.activePages),
      capacityGB: pagesToGB(live.kv.capacityPages ?? live.kv.allocatedPages),
      promptCacheGB: pagesToGB(live.kv.cachePages),
      precision: kvFlag?.endsWith('bf16') ? 'bf16' : 'int8',
    },
    promptCache: {
      reuseLastHour: live.lifetime.prefixCacheHitRate,
      tokensReused: 0,
      ssdUsedGB: null,
      ssdCapacityGB: null,
    },
    engine: {
      model: displayModelName(model),
      repo: model,
      contextTokens: live.contextTokens ?? state.readyInfo?.contextTokens ?? 0,
      uptime,
      weights: live.weights === 'released' ? 'released' : 'loaded',
      memoryPressure:
        live.memory.pressure === 'critical'
          ? 'critical'
          : live.memory.pressure === 'warning'
            ? 'warning'
            : 'normal',
      restarts: live.engine.restarts ?? state.restarts,
    },
    images: null,
  };
}

/** Starts the /status poller while the calling component is mounted. */
export function useTelemetry(): void {
  const start = useTelemetryStore((s) => s.start);
  useEffect(() => start(), [start]);
}

export interface EngineDisplay {
  state: EngineState;
  word: EngineWord;
  /** "Qwen3.8-27B" */
  model: string;
  /** "incoai/Qwen3.8-27B-Splash" */
  repo: string;
  version: string;
  address: string;
  uptime: string;
  status: ActivityStatus;
  stats: ActivityStats | null;
  speed: SpeedHistory | null;
  details: ActivityDetails | null;
  log: LogSource;
  startPhase: StartPhase | undefined;
}

export function useEngineDisplay(): EngineDisplay {
  const state = useEngineStore((s) => s.state);
  const install = useEngineStore((s) => s.install);
  const logs = useEngineStore((s) => s.logs);
  const launchModel = useLaunchStore((s) => s.model);
  const port = useLaunchStore((s) => s.port);
  const tracker = useTelemetryStore((s) => s.tracker);
  const samples = useTelemetryStore((s) => s.samples);
  const now = useNow();

  return useMemo(() => {
    const word = engineWord(state);
    const live = word.serving ? tracker.live : null;
    const repo = state.model ?? launchModel;
    const startedAt = state.readyAtMs ?? state.startedAtMs;
    const uptime = word.serving && startedAt ? formatUptime(now - startedAt) : '';
    const version = `Splash ${install?.version ?? ''}`.trim();
    const address = `127.0.0.1:${state.port ?? port}`;
    const speed: SpeedHistory | null =
      live && samples.length
        ? {
            t: samples.map((s) => s.t),
            tokensPerSecond: samples.map((s) => s.decodeTokPerSec),
          }
        : null;
    const started = startedAt ? ` · started ${clock(startedAt).slice(0, 5)}` : '';
    return {
      state,
      word,
      model: displayModelName(repo),
      repo,
      version,
      address,
      uptime,
      status: activityStatus(state, word, live, uptime, now),
      stats: activityStats(live, samples),
      speed,
      details: activityDetails(live, state, repo, uptime, samples),
      log: { lines: toViewLogLines(logs), meta: `${version} · ${address}${started}` },
      startPhase: word.launching ? startPhase(state, now) : undefined,
    };
  }, [state, install, logs, launchModel, port, tracker, samples, now]);
}
