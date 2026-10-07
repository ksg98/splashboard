/**
 * Shared install state: Homebrew/Splash detection, the update check and the
 * running brew job with its log. Fed by `install://progress`;
 * `connectInstallEvents()` subscribes once (idempotent). Screens (onboarding,
 * settings > updates, danger zone) read with `useInstallStore` and act
 * through the store's actions, which never throw: failures land in `error`
 * (an OpError; `needsTerminal` carries the Homebrew installer command).
 */
import { create } from 'zustand';
import { installApi } from './api';
import {
  FINAL_INSTALL_PHASES,
  toOpError,
  type BrewAction,
  type BrewRunResult,
  type InstallPhase,
  type InstallProgress,
  type InstallStatus,
  type LatestCheck,
  type OpError,
  type OutputStream,
} from './types';

/** Lines kept for the job's log pane. */
export const MAX_JOB_LINES = 2000;

export interface InstallLogLine {
  line: string;
  stream: OutputStream;
  tsMs: number;
}

export interface InstallJob {
  jobId: string | null;
  action: BrewAction;
  phase: InstallPhase;
  lines: InstallLogLine[];
  result: BrewRunResult | null;
  error: OpError | null;
  startedAtMs: number;
}

export interface InstallStoreState {
  available: boolean;
  status: InstallStatus | null;
  latest: LatestCheck | null;
  job: InstallJob | null;
  loadingStatus: boolean;
  checkingLatest: boolean;
  /** The last failed read (status or update check). */
  error: OpError | null;
  refreshStatus: () => Promise<InstallStatus | null>;
  checkLatest: () => Promise<LatestCheck | null>;
  /** Runs brew; resolves with the result, or null when it could not start (see job.error). */
  run: (action: BrewAction, options?: { force?: boolean }) => Promise<BrewRunResult | null>;
  cancel: () => Promise<boolean>;
  applyProgress: (progress: InstallProgress) => void;
  clearJob: () => void;
}

export const useInstallStore = create<InstallStoreState>()((set, get) => ({
  available: installApi.available,
  status: null,
  latest: null,
  job: null,
  loadingStatus: false,
  checkingLatest: false,
  error: null,

  refreshStatus: async () => {
    set({ loadingStatus: true });
    try {
      const status = await installApi.status();
      set({ status, loadingStatus: false, error: null });
      return status;
    } catch (e) {
      set({ loadingStatus: false, error: toOpError(e) });
      return null;
    }
  },

  checkLatest: async () => {
    set({ checkingLatest: true });
    try {
      const latest = await installApi.checkLatest();
      set({ latest, checkingLatest: false });
      return latest;
    } catch (e) {
      set({ checkingLatest: false, error: toOpError(e) });
      return null;
    }
  },

  run: async (action, options) => {
    const running = get().job;
    if (running && !FINAL_INSTALL_PHASES.includes(running.phase)) {
      set({
        job: { ...running, error: { kind: 'busy', message: 'Homebrew is already running.' } },
      });
      return null;
    }
    set({
      job: {
        jobId: null,
        action,
        phase: 'starting',
        lines: [],
        result: null,
        error: null,
        startedAtMs: Date.now(),
      },
    });
    try {
      const result = await installApi.run(action, options);
      set((s) => ({
        job: s.job ? { ...s.job, jobId: result.jobId, phase: result.phase, result } : s.job,
      }));
      // Installed version, paths and servers changed: detect again.
      void get().refreshStatus();
      if (get().latest) void get().checkLatest();
      return result;
    } catch (e) {
      set((s) => ({ job: s.job ? { ...s.job, phase: 'failed', error: toOpError(e) } : s.job }));
      return null;
    }
  },

  cancel: async () => {
    try {
      return await installApi.cancel();
    } catch {
      return false;
    }
  },

  applyProgress: (progress) =>
    set((s) => {
      const job = s.job;
      // A job started elsewhere (another window, or before this view mounted).
      const base: InstallJob =
        job && (job.jobId === null || job.jobId === progress.jobId)
          ? job
          : {
              jobId: progress.jobId,
              action: progress.action,
              phase: progress.phase,
              lines: [],
              result: null,
              error: null,
              startedAtMs: progress.tsMs,
            };
      let lines = base.lines;
      if (progress.line !== null) {
        lines = [...lines, { line: progress.line, stream: progress.stream, tsMs: progress.tsMs }];
        if (lines.length > MAX_JOB_LINES) lines = lines.slice(-MAX_JOB_LINES);
      }
      return { job: { ...base, jobId: progress.jobId, phase: progress.phase, lines } };
    }),

  clearJob: () => set({ job: null }),
}));

/** Homebrew is missing: the onboarding shows the terminal step. */
export const selectNeedsHomebrew = (s: InstallStoreState): boolean =>
  s.status !== null && !s.status.homebrew.found;

/** `brew upgrade` would install something newer. */
export const selectUpgradeAvailable = (s: InstallStoreState): boolean =>
  s.latest?.upgradeAvailable ?? false;

/** A brew job is running now. */
export const selectJobRunning = (s: InstallStoreState): boolean =>
  s.job !== null && !FINAL_INSTALL_PHASES.includes(s.job.phase);

let connected: Promise<() => void> | undefined;

/** Subscribes the store to `install://progress`. Idempotent. */
export function connectInstallEvents(): Promise<() => void> {
  connected ??= (async () => {
    const unlisten = await installApi.onProgress(useInstallStore.getState().applyProgress);
    let active: Awaited<ReturnType<typeof installApi.active>> = null;
    try {
      active = await installApi.active();
    } catch {
      // Not fatal: the next progress event creates the job.
    }
    if (active && !useInstallStore.getState().job) {
      useInstallStore.setState({
        job: {
          jobId: active.jobId,
          action: active.action,
          phase: 'starting',
          lines: [],
          result: null,
          error: null,
          startedAtMs: Date.now(),
        },
      });
    }
    return () => {
      unlisten();
      connected = undefined;
    };
  })().catch((error: unknown) => {
    connected = undefined;
    throw error;
  });
  return connected;
}
