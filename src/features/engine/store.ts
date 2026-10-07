import { create } from 'zustand';

/** One telemetry point derived from GET /status. Extend as the dashboard grows. */
export interface TelemetrySample {
  /** Epoch ms. */
  t: number;
  decodeTokensPerSecond?: number;
  prefillTokensPerSecond?: number;
  memoryBytes?: number;
  activeRequests?: number;
}

export const MAX_SAMPLES = 600;

export interface TelemetryState {
  samples: TelemetrySample[];
  pollIntervalMs: number;
  addSample: (sample: TelemetrySample) => void;
  setPollInterval: (ms: number) => void;
  reset: () => void;
}

export const useTelemetryStore = create<TelemetryState>()((set) => ({
  samples: [],
  pollIntervalMs: 1000,
  addSample: (sample) =>
    set((s) => {
      const samples = [...s.samples, sample];
      return { samples: samples.length > MAX_SAMPLES ? samples.slice(-MAX_SAMPLES) : samples };
    }),
  setPollInterval: (pollIntervalMs) => set({ pollIntervalMs }),
  reset: () => set({ samples: [] }),
}));
