/**
 * Props-level types for the engine views (Activity, the sidebar engine row,
 * the engine popover, the log sheet). Everything here is already derived and
 * display-ready: the data layer turns /status polls and log lines into these
 * shapes, and the views only decide wording and layout.
 */

/** Status-dot tone, shared with StatusDot. */
export type EngineTone = 'ok' | 'busy' | 'warn' | 'error' | 'off';

/** The engine word and its dot: Ready, Thinking, Starting…, Stopped. */
export interface EngineStateLabel {
  label: string;
  tone: EngineTone;
}

/** Splash's startup phases: Preparing, Loading weights, Warming up. */
export interface StartPhase {
  /** "Loading weights" */
  label: string;
  /** Seconds since `splash serve` was spawned. */
  elapsedSeconds: number;
  /** 0..1, estimated from the phase. */
  progress: number;
}

export type ActivityStatus =
  /** Listening and idle. */
  | { kind: 'ready'; requests: number; uptime: string }
  /** prefilling + decoding > 0. */
  | { kind: 'busy'; requests: number; uptime: string }
  /** Ready, but Splash released the weights after 600 s without a request. */
  | { kind: 'idle'; uptime: string }
  | { kind: 'starting'; phase: StartPhase }
  /** `lastRan` reads after "last ran": "today at 11:27". */
  | { kind: 'stopped'; lastRan: string }
  /**
   * The process exited before Ready, or the engine failed for good.
   * `reason` is one plain-English clause ("port 8000 is already in use"),
   * `lastLines` the tail of the log that explains it.
   */
  | { kind: 'failed'; reason: string; at: string; lastLines: LogLine[] };

export type ActivityStatusKind = ActivityStatus['kind'];

/** The four summary cards. */
export interface ActivityStats {
  /** Decode tokens per second, averaged over the last 10 s. */
  tokensPerSecond: number;
  /** Accepted / drafted over the last 10 s, 0..1. */
  draftAcceptance: number;
  /** Tokens the draft model proposes per step (7 for Splash packages). */
  draftTokensPerStep: number;
  memoryUsedGB: number;
  memoryTotalGB: number;
  /** Prompt-cache reuse over the last hour, 0..1. */
  promptCacheReuse: number;
}

/** The tokens-per-second chart: unix seconds and one value per second (null = gap). */
export interface SpeedHistory {
  t: number[];
  tokensPerSecond: (number | null)[];
}

export type MemoryPressure = 'normal' | 'warning' | 'critical';

/** "Show details": six small groups, in the order they are shown. */
export interface ActivityDetails {
  requests: {
    /** Requests being worked on right now. */
    active: number;
    /** How many Splash works on at once (`--max-batch-width`, 4). */
    capacity: number;
    /** Admitted but waiting for a slot. */
    waiting: number;
    /** Completed since the engine started. */
    finished: number;
  };
  speed: {
    /** Prefill tokens per second; null before the first prompt. */
    readingPromptsTokensPerSecond: number | null;
    /** Time to first token, p50 and p95, in seconds. */
    firstTokenTypicalSeconds: number | null;
    firstTokenSlowestSeconds: number | null;
  };
  workingMemory: {
    /** KV pages in use × page size. */
    inUseGB: number;
    capacityGB: number;
    /** Share held by the prompt cache. */
    promptCacheGB: number;
    /** KV format: `int8` is Compact (8-bit), `bf16` Full (16-bit). */
    precision: 'int8' | 'bf16';
  };
  promptCache: {
    reuseLastHour: number | null;
    tokensReused: number;
    /** null when the SSD cache is off (`--max-cache-disk=0`). */
    ssdUsedGB: number | null;
    ssdCapacityGB: number | null;
  };
  engine: {
    /** "Qwen3.8-27B" */
    model: string;
    /** "incoai/Qwen3.8-27B-Splash" */
    repo: string;
    /** Context length in tokens (131072 → "128K"). */
    contextTokens: number;
    uptime: string;
    weights: 'loaded' | 'released';
    memoryPressure: MemoryPressure;
    restarts: number;
  };
  /** null for a language-only model. */
  images: {
    read: number;
    reused: number;
    /** Largest image so far, in megapixels. */
    largestMegapixels: number | null;
  } | null;
}

export type LogLineKind = 'info' | 'request' | 'error';

/** One line Splash printed, stamped with the time Splashboard received it. */
export interface LogLine {
  id: string;
  /** "09:12:01" */
  time: string;
  text: string;
  kind: LogLineKind;
}

export interface LogSource {
  lines: LogLine[];
  /** "Splash 1.2.0 · 127.0.0.1:8000 · started 09:12" */
  meta: string;
}
