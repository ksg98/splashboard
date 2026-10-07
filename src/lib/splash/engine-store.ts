/**
 * Shared engine status for every feature (nav badge, chat readiness, models
 * launch, engine dashboard). Fed by the supervisor's `engine://state` and
 * `engine://log` events; `connectEngineEvents()` is called once by the app
 * shell. Features read with `useEngineStore` and act through its actions
 * (or `engine` in ./engine.ts). Feature-specific state (telemetry history,
 * log filters, ...) belongs in the feature's own store, not here.
 *
 * Actions never throw: on failure they resolve to `null` and leave the error
 * in `error` (an `AppError`; kind "unavailable" in a browser).
 */
import { create } from 'zustand';
import {
  engine,
  initialEngineState,
  toAppError,
  type AppError,
  type EngineState,
  type ExternalServer,
  type LogLine,
  type ServeRequest,
  type SplashInstall,
  type SupervisorSettings,
  type SupervisorSettingsPatch,
} from './engine';

/** Lines kept in memory for the UI (the Rust side keeps its own backlog). */
export const MAX_LOG_LINES = 2000;

export type EngineAction = 'start' | 'stop' | 'restart' | 'adopt' | 'stopExternal';

export interface EngineStoreState {
  /** Engine control exists (desktop app). */
  available: boolean;
  install: SplashInstall | null;
  state: EngineState;
  logs: LogLine[];
  settings: SupervisorSettings | null;
  /** Splash servers found through their port locks (`discover`). */
  externals: ExternalServer[];
  /** The action in flight, if any. */
  pending: EngineAction | null;
  /** The last action's failure; cleared when the next action starts. */
  error: AppError | null;

  /** Re-runs CLI detection. */
  detect: () => Promise<SplashInstall | null>;
  start: (options: ServeRequest) => Promise<EngineState | null>;
  stop: () => Promise<EngineState | null>;
  restart: (options?: ServeRequest) => Promise<EngineState | null>;
  adopt: (port?: number) => Promise<EngineState | null>;
  stopExternal: (port?: number) => Promise<EngineState | null>;
  discover: () => Promise<ExternalServer[]>;
  configure: (patch?: SupervisorSettingsPatch) => Promise<SupervisorSettings | null>;
  /** Saves the full log; resolves with the path written. */
  saveLog: (path?: string) => Promise<string | null>;
  clearError: () => void;

  setState: (state: EngineState) => void;
  appendLog: (line: LogLine) => void;
  /** Merges a backlog (from `engine.logs()`) with lines already received. */
  mergeLogs: (lines: LogLine[]) => void;
  clearLogs: () => void;
}

export const useEngineStore = create<EngineStoreState>()((set, get) => {
  /** Runs an engine action with `pending`/`error` bookkeeping. */
  async function act(
    name: EngineAction,
    run: () => Promise<EngineState>,
  ): Promise<EngineState | null> {
    set({ pending: name, error: null });
    try {
      const state = await run();
      set({ state, pending: null });
      return state;
    } catch (error) {
      set({ pending: null, error: toAppError(error) });
      return null;
    }
  }

  return {
    available: engine.available,
    install: null,
    state: initialEngineState(),
    logs: [],
    settings: null,
    externals: [],
    pending: null,
    error: null,

    detect: async () => {
      try {
        const install = await engine.detect();
        set({ install });
        return install;
      } catch (error) {
        set({ error: toAppError(error) });
        return null;
      }
    },
    start: (options) => act('start', () => engine.start(options)),
    stop: () => act('stop', () => engine.stop()),
    restart: (options) => act('restart', () => engine.restart(options)),
    adopt: (port) => act('adopt', () => engine.adopt(port)),
    stopExternal: (port) => act('stopExternal', () => engine.stopExternal(port)),
    discover: async () => {
      try {
        const externals = await engine.discover();
        set({ externals });
        return externals;
      } catch (error) {
        set({ error: toAppError(error) });
        return get().externals;
      }
    },
    configure: async (patch) => {
      try {
        const settings = await engine.configure(patch);
        set({ settings });
        return settings;
      } catch (error) {
        set({ error: toAppError(error) });
        return null;
      }
    },
    saveLog: async (path) => {
      try {
        return await engine.saveLog(path);
      } catch (error) {
        set({ error: toAppError(error) });
        return null;
      }
    },
    clearError: () => set({ error: null }),

    setState: (state) => set({ state }),
    appendLog: (line) =>
      set((current) => {
        const last = current.logs[current.logs.length - 1];
        if (last && line.seq <= last.seq) return current;
        const logs =
          current.logs.length >= MAX_LOG_LINES
            ? [...current.logs.slice(current.logs.length - MAX_LOG_LINES + 1), line]
            : [...current.logs, line];
        return { logs };
      }),
    mergeLogs: (lines) =>
      set((current) => {
        const bySeq = new Map<number, LogLine>();
        for (const line of [...lines, ...current.logs]) bySeq.set(line.seq, line);
        const logs = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
        return { logs: logs.slice(-MAX_LOG_LINES) };
      }),
    clearLogs: () => set({ logs: [] }),
  };
});

let connected: Promise<() => void> | undefined;

/**
 * Subscribes the store to engine events and loads the current state, log
 * backlog and settings. Idempotent; resolves with an unsubscribe function.
 */
export function connectEngineEvents(): Promise<() => void> {
  connected ??= (async () => {
    let sawEvent = false;
    const unlistenState = await engine.onState((state) => {
      sawEvent = true;
      useEngineStore.getState().setState(state);
    });
    const unlistenLog = await engine.onLog((line) => useEngineStore.getState().appendLog(line));
    const [state, backlog, settings] = await Promise.all([
      engine.state(),
      engine.logs(),
      engine.configure().catch(() => null),
    ]);
    // An event that arrived meanwhile is newer than the snapshot: keep it.
    useEngineStore.setState((current) => ({
      available: engine.available,
      state: sawEvent ? current.state : state,
      settings: settings ?? current.settings,
    }));
    useEngineStore.getState().mergeLogs(backlog);
    return () => {
      unlistenState();
      unlistenLog();
      connected = undefined;
    };
  })();
  return connected;
}
