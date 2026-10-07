import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialEngineState, type EngineState, type LogLine } from './engine';
import { MAX_LOG_LINES, connectEngineEvents, useEngineStore } from './engine-store';

const ipc = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  listen:
    vi.fn<(event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: ipc.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: ipc.listen }));

function setTauri(on: boolean): void {
  const w = window as unknown as Record<string, unknown>;
  if (on) w.__TAURI_INTERNALS__ = {};
  else delete w.__TAURI_INTERNALS__;
}

function line(seq: number, text = `line ${seq}`): LogLine {
  return { seq, stream: 'stdout', line: text, tsMs: seq };
}

function state(
  phase: 'starting' | 'ready' | 'stopped',
  extra: Partial<EngineState> = {},
): EngineState {
  return {
    ...initialEngineState(),
    phase,
    status: phase,
    owner: phase === 'stopped' ? 'none' : 'app',
    pid: phase === 'stopped' ? null : 42,
    port: 8012,
    model: 'incoai/Qwen3.8-27B-Splash',
    ...extra,
  } as EngineState;
}

const initial = useEngineStore.getInitialState();

beforeEach(() => {
  ipc.invoke.mockReset();
  ipc.listen.mockReset();
  useEngineStore.setState(initial, true);
});

afterEach(() => setTauri(false));

describe('log ring buffer', () => {
  it('appends in order, drops duplicates and caps the length', () => {
    const store = useEngineStore.getState();
    store.appendLog(line(1));
    store.appendLog(line(2));
    store.appendLog(line(2));
    store.appendLog(line(1));
    expect(useEngineStore.getState().logs.map((l) => l.seq)).toEqual([1, 2]);

    for (let seq = 3; seq <= MAX_LOG_LINES + 10; seq++)
      useEngineStore.getState().appendLog(line(seq));
    const logs = useEngineStore.getState().logs;
    expect(logs).toHaveLength(MAX_LOG_LINES);
    expect(logs[0]?.seq).toBe(11);
    expect(logs[logs.length - 1]?.seq).toBe(MAX_LOG_LINES + 10);
  });

  it('merges a backlog with live lines by seq', () => {
    const store = useEngineStore.getState();
    store.appendLog(line(5));
    store.appendLog(line(6));
    store.mergeLogs([line(3), line(4), line(5, 'backlog copy')]);
    expect(useEngineStore.getState().logs.map((l) => l.seq)).toEqual([3, 4, 5, 6]);
    store.clearLogs();
    expect(useEngineStore.getState().logs).toEqual([]);
  });
});

describe('actions', () => {
  beforeEach(() => setTauri(true));

  it('start stores the returned state and clears pending', async () => {
    const starting = state('starting');
    let resolve: (value: unknown) => void = () => undefined;
    ipc.invoke.mockReturnValue(new Promise((r) => (resolve = r)));
    const request = { model: 'incoai/Qwen3.8-27B-Splash', port: 8012, flags: [] };
    const result = useEngineStore.getState().start(request);
    expect(useEngineStore.getState().pending).toBe('start');
    resolve(starting);
    expect(await result).toEqual(starting);
    expect(useEngineStore.getState()).toMatchObject({
      state: starting,
      pending: null,
      error: null,
    });
    expect(ipc.invoke).toHaveBeenCalledWith('engine_start', { options: request });
  });

  it('failures land in `error` instead of throwing', async () => {
    ipc.invoke.mockRejectedValue({ kind: 'portInUse', message: 'port 8012 is already in use' });
    const result = await useEngineStore.getState().start({ model: 'a/b', port: 8012, flags: [] });
    expect(result).toBeNull();
    expect(useEngineStore.getState()).toMatchObject({
      pending: null,
      error: { kind: 'portInUse' },
      state: { phase: 'stopped' },
    });
    useEngineStore.getState().clearError();
    expect(useEngineStore.getState().error).toBeNull();
  });

  it('stop, restart, adopt and stopExternal call their commands', async () => {
    ipc.invoke.mockResolvedValue(state('stopped'));
    const store = useEngineStore.getState();
    await store.stop();
    await store.restart();
    await store.adopt(8011);
    await store.stopExternal(8011);
    expect(ipc.invoke.mock.calls.map((c) => c[0])).toEqual([
      'engine_stop',
      'engine_restart',
      'engine_adopt',
      'engine_stop_external',
    ]);
  });

  it('discover, configure, detect and saveLog keep their results', async () => {
    const external = {
      port: 8011,
      pid: 85053,
      model: 'incoai/Qwen3.8-27B-Splash',
      lockHeld: true,
      isSplash: true,
      previousSession: false,
      ready: true,
    };
    ipc.invoke.mockImplementation((cmd) => {
      switch (cmd) {
        case 'engine_discover':
          return Promise.resolve([external]);
        case 'engine_configure':
          return Promise.resolve({
            autoRestart: true,
            maxRestarts: 3,
            restartWindowSecs: 300,
            restartBackoffMs: 1000,
            stopGraceSecs: 20,
            keepRunningOnQuit: false,
          });
        case 'engine_save_log':
          return Promise.resolve('/Users/me/Downloads/splash-serve-1.log');
        case 'engine_detect':
          return Promise.reject({ kind: 'invalidRequest', message: 'must be named splash' });
        default:
          return Promise.reject(new Error(`unexpected ${cmd}`));
      }
    });
    const store = useEngineStore.getState();
    expect(await store.discover()).toEqual([external]);
    expect(useEngineStore.getState().externals).toEqual([external]);
    expect((await store.configure({ autoRestart: true }))?.autoRestart).toBe(true);
    expect(useEngineStore.getState().settings?.autoRestart).toBe(true);
    expect(await store.saveLog()).toBe('/Users/me/Downloads/splash-serve-1.log');
    expect(await store.detect()).toBeNull();
    expect(useEngineStore.getState().error?.kind).toBe('invalidRequest');
  });

  it('in a browser every action reports "unavailable"', async () => {
    setTauri(false);
    expect(await useEngineStore.getState().stop()).toBeNull();
    expect(useEngineStore.getState().error?.kind).toBe('unavailable');
  });
});

describe('connectEngineEvents', () => {
  beforeEach(() => setTauri(true));

  it('loads the snapshot and backlog, then follows events', async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    ipc.listen.mockImplementation((name, handler) => {
      handlers.set(name, handler);
      return Promise.resolve(() => handlers.delete(name));
    });
    const snapshot = state('starting');
    ipc.invoke.mockImplementation((cmd) => {
      if (cmd === 'engine_state') return Promise.resolve(snapshot);
      if (cmd === 'engine_logs') return Promise.resolve([line(1), line(2)]);
      if (cmd === 'engine_configure') return Promise.reject(new Error('old backend'));
      return Promise.reject(new Error(cmd));
    });

    const unsubscribe = await connectEngineEvents();
    expect(await connectEngineEvents()).toBe(unsubscribe);
    expect(useEngineStore.getState().state).toEqual(snapshot);
    expect(useEngineStore.getState().logs.map((l) => l.seq)).toEqual([1, 2]);
    expect(useEngineStore.getState().available).toBe(true);

    const ready = state('ready', { readyAtMs: 9 });
    handlers.get('engine://state')?.({ payload: ready });
    handlers.get('engine://log')?.({ payload: line(3) });
    expect(useEngineStore.getState().state).toEqual(ready);
    expect(useEngineStore.getState().logs.map((l) => l.seq)).toEqual([1, 2, 3]);

    unsubscribe();
    expect(handlers.size).toBe(0);
  });

  it('keeps an event that arrives before the snapshot', async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    ipc.listen.mockImplementation((name, handler) => {
      handlers.set(name, handler);
      return Promise.resolve(() => handlers.delete(name));
    });
    const newer = state('ready');
    ipc.invoke.mockImplementation((cmd) => {
      if (cmd === 'engine_state') {
        // The event fires while the snapshot request is in flight.
        handlers.get('engine://state')?.({ payload: newer });
        return Promise.resolve(state('starting'));
      }
      if (cmd === 'engine_logs') return Promise.resolve([]);
      return Promise.resolve(null);
    });
    const unsubscribe = await connectEngineEvents();
    expect(useEngineStore.getState().state).toEqual(newer);
    unsubscribe();
  });
});
