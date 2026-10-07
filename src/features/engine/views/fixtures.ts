/**
 * Demo props for the engine views: a MacBook Pro (M3 Max, 64 GB) running
 * Qwen3.8-27B as a Splash package with Splash 1.2.0 on 127.0.0.1:8000.
 * Used by engine.gallery.tsx and the view tests; never by the app itself.
 */
import type {
  ActivityDetails,
  ActivityStats,
  ActivityStatus,
  EngineStateLabel,
  LogLine,
  LogSource,
  SpeedHistory,
} from './types';

export const DEMO_MODEL = 'Qwen3.8-27B';
export const DEMO_REPO = 'incoai/Qwen3.8-27B-Splash';
export const DEMO_VERSION = 'Splash 1.2.0';
export const DEMO_ADDRESS = '127.0.0.1:8000';
export const DEMO_UPTIME = '2 h 14 min';

/** One value per second for the last minute: steady near 92, one long prompt dips it. */
const SPEED = [
  93, 93, 92, 93, 90, 90, 91, 90, 92, 92, 91, 92, 90, 89, 92, 92, 93, 93, 90, 90, 90, 90, 93, 92,
  91, 91, 90, 91, 92, 91, 92, 89, 86, 80, 68, 61, 66, 74, 82, 89, 90, 88, 91, 92, 93, 94, 90, 90,
  91, 90, 92, 92, 91, 92, 90, 90, 91, 90, 92, 93, 92,
];

/** 11:27:20 on 4 Oct 2026, local time irrelevant: the chart only labels "1 min ago" and "Now". */
const NOW = 1_791_138_440;

export const speedHistory: SpeedHistory = {
  t: SPEED.map((_, i) => NOW - (SPEED.length - 1) + i),
  tokensPerSecond: SPEED,
};

/** Weights released: nothing has run for ten minutes. */
export const idleSpeedHistory: SpeedHistory = {
  t: speedHistory.t,
  tokensPerSecond: SPEED.map(() => 0),
};

export const stats: ActivityStats = {
  tokensPerSecond: 92,
  draftAcceptance: 0.8,
  draftTokensPerStep: 7,
  memoryUsedGB: 31.4,
  memoryTotalGB: 48,
  promptCacheReuse: 0.87,
};

export const idleStats: ActivityStats = {
  ...stats,
  tokensPerSecond: 0,
  memoryUsedGB: 1.5,
};

export const details: ActivityDetails = {
  requests: { active: 1, capacity: 4, waiting: 0, finished: 214 },
  speed: {
    readingPromptsTokensPerSecond: 1840,
    firstTokenTypicalSeconds: 0.42,
    firstTokenSlowestSeconds: 1.9,
  },
  workingMemory: { inUseGB: 5.5, capacityGB: 16, promptCacheGB: 4.6, precision: 'int8' },
  promptCache: { reuseLastHour: 0.87, tokensReused: 412_306, ssdUsedGB: 6.2, ssdCapacityGB: 32 },
  engine: {
    model: DEMO_MODEL,
    repo: DEMO_REPO,
    contextTokens: 131_072,
    uptime: DEMO_UPTIME,
    weights: 'loaded',
    memoryPressure: 'normal',
    restarts: 0,
  },
  images: { read: 12, reused: 7, largestMegapixels: 4.2 },
};

export const idleDetails: ActivityDetails = {
  ...details,
  requests: { ...details.requests, active: 0 },
  workingMemory: { ...details.workingMemory, inUseGB: 4.6 },
  engine: { ...details.engine, weights: 'released' },
};

let nextId = 0;
function line(time: string, text: string, kind: LogLine['kind'] = 'info'): LogLine {
  nextId += 1;
  return { id: `l${nextId}`, time, text, kind };
}

/** What Splash printed this session (stdout and stderr, verbatim). */
export const logLines: LogLine[] = [
  line('09:12:01', `Splash model ${DEMO_REPO} is already installed`),
  line(
    '09:12:03',
    `Could not reach the Hub (timed out); using the installed ${DEMO_REPO}@3f9c2a71e0b4.`,
  ),
  line('09:12:04', `Loading · ${DEMO_REPO}`),
  line(
    '09:12:05',
    'Chat template · renders later system messages in place, generation prompt 5-7 tokens',
  ),
  line('09:12:08', 'Weights loaded in 3.12 s.'),
  line('09:12:08', 'Kernel policy for GPU family 9 with 40 cores.'),
  line('09:12:27', `Ready · ${DEMO_REPO} · context 128K · http://${DEMO_ADDRESS}`),
  line(
    '09:31:40',
    'Done · input 1184 · cached 0 · output 402 · TTFT 0.61s · 90.4 tok/s',
    'request',
  ),
  line(
    '09:44:02',
    'Done · input 2912 · cached 2786 · output 612 · TTFT 0.42s · 94.1 tok/s',
    'request',
  ),
  line(
    '09:54:09',
    'Weights released after 600 s without a request; the next request restores them',
  ),
  line('10:21:55', 'Weights restored in 3.07 s'),
  line(
    '10:21:59',
    'Done · input 3530 · cached 3412 · output 721 · TTFT 3.40s · 91.8 tok/s',
    'request',
  ),
  line('10:40:12', 'Error · frontend_overloaded · POST /v1/chat/completions', 'error'),
  line(
    '10:40:13',
    'Done · input 6210 · cached 6144 · output 958 · TTFT 0.39s · 92.6 tok/s',
    'request',
  ),
  line(
    '11:02:31',
    'Done · input 48211 · cached 46977 · output 1688 · TTFT 0.88s · 89.7 tok/s',
    'request',
  ),
  line('11:18:09', 'Cancelled · input 5120 · cached 5056 · output 88 · TTFT 0.35s', 'request'),
  line(
    '11:23:48',
    'Done · input 3998 · cached 3412 · output 1004 · TTFT 0.38s · 92.2 tok/s',
    'request',
  ),
  line(
    '11:25:52',
    'Done · input 51870 · cached 51200 · output 1210 · TTFT 0.71s · 91.4 tok/s',
    'request',
  ),
  line(
    '11:26:10',
    'Done · input 53104 · cached 52992 · output 377 · TTFT 0.44s · 93.0 tok/s',
    'request',
  ),
  line(
    '11:26:31',
    'Done · input 53511 · cached 53376 · output 842 · TTFT 0.47s · 92.4 tok/s',
    'request',
  ),
  line(
    '11:26:58',
    'Done · input 54380 · cached 54272 · output 615 · TTFT 0.45s · 92.8 tok/s',
    'request',
  ),
  line(
    '11:27:20',
    'Done · input 55021 · cached 54912 · output 1290 · TTFT 0.52s · 91.9 tok/s',
    'request',
  ),
];

export const log: LogSource = {
  lines: logLines,
  meta: `${DEMO_VERSION} · ${DEMO_ADDRESS} · started 09:12`,
};

/** A start that failed: another Splash already holds port 8000. */
export const failedLines: LogLine[] = [
  line('11:31:02', `Splash model ${DEMO_REPO} is already installed`),
  line(
    '11:31:02',
    `error: Splash is already serving (PID 75278, model ${DEMO_REPO}, port 8000); stop it with Ctrl+C first`,
    'error',
  ),
];

export const failedLog: LogSource = {
  lines: [...logLines, line('11:27:31', 'Stopping · releasing engine resources'), ...failedLines],
  meta: `${DEMO_VERSION} · ${DEMO_ADDRESS} · exited 11:31`,
};

export const status = {
  ready: { kind: 'ready', requests: 0, uptime: DEMO_UPTIME },
  busy: { kind: 'busy', requests: 1, uptime: DEMO_UPTIME },
  idle: { kind: 'idle', uptime: DEMO_UPTIME },
  starting: {
    kind: 'starting',
    phase: { label: 'Loading weights', elapsedSeconds: 3, progress: 0.3 },
  },
  stopped: { kind: 'stopped', lastRan: 'today at 11:27' },
  failed: {
    kind: 'failed',
    reason: 'another copy of Splash is using port 8000',
    at: 'today at 11:31',
    lastLines: failedLines,
  },
} satisfies Record<string, ActivityStatus>;

/** Engine popover and sidebar row, by state (callbacks are added by the caller). */
export const engineState = {
  ready: { label: 'Ready', tone: 'ok' },
  busy: { label: 'Thinking', tone: 'busy' },
  starting: { label: 'Starting…', tone: 'warn' },
  stopped: { label: 'Stopped', tone: 'off' },
  failed: { label: 'Failed', tone: 'error' },
} satisfies Record<string, EngineStateLabel>;

const popoverBase = {
  model: DEMO_MODEL,
  version: DEMO_VERSION,
  address: DEMO_ADDRESS,
  uptime: DEMO_UPTIME,
};

export const popover = {
  busy: { ...popoverBase, state: engineState.busy, speed: 92, acceptance: 0.8, memory: 31.4 },
  ready: { ...popoverBase, state: engineState.ready, speed: 0, acceptance: 0.8, memory: 31.4 },
  starting: {
    ...popoverBase,
    state: engineState.starting,
    phase: { label: 'Loading weights', elapsedSeconds: 3, progress: 0.3 },
  },
  stopped: { ...popoverBase, state: engineState.stopped, lastRan: 'today at 11:27' },
  failed: {
    ...popoverBase,
    state: engineState.failed,
    lastRan: 'today at 11:31',
    failure: 'another copy of Splash is using port 8000',
  },
};
