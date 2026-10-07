/**
 * Live engine telemetry: one app-wide /status poller feeding the Activity
 * screen and the engine popover.
 *
 * Polls every second while the server answers requests (Splash serves no
 * HTTP before Ready, so nothing is polled while it starts), pauses while the
 * window is hidden, and keeps the last two minutes of samples.
 */
import { create } from 'zustand';
import { engineWord } from '@/lib/launch';
import { getSplashClient } from '@/lib/splash/client';
import { engine } from '@/lib/splash/engine';
import { useEngineStore } from '@/lib/splash/engine-store';
import {
  initialStatusTracker,
  trackStatus,
  type LiveStatus,
  type StatusTrackerState,
} from '@/lib/splash/status';

export const POLL_MS = 1000;
const HISTORY_SECONDS = 120;

export interface TelemetrySample {
  /** Unix seconds. */
  t: number;
  decodeTokPerSec: number | null;
  prefillTokPerSec: number | null;
  acceptance: number | null;
  acceptedPerCycle: number | null;
  draftedPerCycle: number | null;
  cacheHitRate: number | null;
}

interface TelemetryState {
  tracker: StatusTrackerState;
  samples: TelemetrySample[];
  /** The last poll failed (server gone or not answering). */
  error: string | null;
  polling: boolean;
  start: () => () => void;
  reset: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let subscribers = 0;
let inFlight = false;

function shouldPoll(): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  // In a plain browser there is no supervisor: poll whatever the proxy reaches.
  if (!engine.available) return true;
  return engineWord(useEngineStore.getState().state).serving;
}

export const useTelemetryStore = create<TelemetryState>()((set, get) => {
  async function poll() {
    timer = null;
    if (subscribers === 0) return;
    if (shouldPoll() && !inFlight) {
      inFlight = true;
      try {
        const status = await getSplashClient().status({ timeoutMs: 2000 });
        const at = Date.now();
        const tracker = trackStatus(get().tracker, { at, status });
        const live = tracker.live;
        const samples = get().samples;
        const reset = tracker.resets !== get().tracker.resets;
        const next: TelemetrySample[] = live
          ? [
              ...(reset ? [] : samples),
              {
                t: Math.round(at / 1000),
                decodeTokPerSec: live.rates.decodeTokPerSec,
                prefillTokPerSec: live.rates.prefillTokPerSec,
                acceptance: live.rates.draftAcceptanceRate,
                acceptedPerCycle: live.rates.acceptedPerCycle,
                draftedPerCycle: live.rates.draftedPerCycle,
                cacheHitRate: live.rates.prefixCacheHitRate,
              },
            ].slice(-HISTORY_SECONDS)
          : samples;
        set({ tracker, samples: next, error: null });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      } finally {
        inFlight = false;
      }
    }
    if (subscribers > 0) timer = setTimeout(() => void poll(), POLL_MS);
  }

  return {
    tracker: initialStatusTracker(),
    samples: [],
    error: null,
    polling: false,
    start: () => {
      subscribers += 1;
      if (subscribers === 1) {
        set({ polling: true });
        void poll();
      }
      return () => {
        subscribers = Math.max(0, subscribers - 1);
        if (subscribers === 0) {
          if (timer) clearTimeout(timer);
          timer = null;
          set({ polling: false });
        }
      };
    },
    reset: () => set({ tracker: initialStatusTracker(), samples: [], error: null }),
  };
});

/** Mean of the non-null values of the last `seconds` samples. */
export function recentMean(
  samples: TelemetrySample[],
  pick: (sample: TelemetrySample) => number | null,
  seconds = 10,
): number | null {
  const last = samples.at(-1);
  if (!last) return null;
  const values = samples
    .filter((sample) => sample.t > last.t - seconds)
    .map(pick)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Decode speed while generating: the mean of non-zero samples, else 0. */
export function recentSpeed(samples: TelemetrySample[], seconds = 10): number {
  const last = samples.at(-1);
  if (!last) return 0;
  const values = samples
    .filter((sample) => sample.t > last.t - seconds)
    .map((sample) => sample.decodeTokPerSec)
    .filter((value): value is number => value !== null && value > 0);
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function liveStatus(): LiveStatus | null {
  return useTelemetryStore.getState().tracker.live;
}

/** "2 h 14 min", "5 min", "40 s". */
export function formatUptime(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
