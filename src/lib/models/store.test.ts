import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserSimulation, modelsApi, plainKey } from './api';
import { SAMPLE_CATALOG, SAMPLE_INSTALLED } from './fixtures';
import {
  connectModelsEvents,
  deriveModelLists,
  downloadFraction,
  MAX_DOWNLOAD_LOG,
  useModelsStore,
  type DownloadState,
} from './store';
import type { DownloadResult, ModelLog, ModelProgress } from './types';

// --- Tauri IPC mock ---------------------------------------------------------
type Handler = (event: { payload: unknown }) => void;
const ipc = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: ipc.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: Handler) => {
    const set = ipc.listeners.get(name) ?? new Set<Handler>();
    set.add(handler);
    ipc.listeners.set(name, set);
    return () => set.delete(handler);
  }),
}));

function emit(name: string, payload: unknown) {
  for (const handler of ipc.listeners.get(name) ?? []) handler({ payload });
}

function enableTauri() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

const initial = useModelsStore.getState();

function progress(partial: Partial<ModelProgress>): ModelProgress {
  return {
    model: 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M',
    key: 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M',
    repo: 'unsloth/Qwen3.8-27B-GGUF',
    bytesDone: 0,
    bytesTotal: 1000,
    speed: 0,
    eta: null,
    phase: 'downloading',
    segment: 1,
    files: 1,
    overallDone: 0,
    message: null,
    tsMs: 1,
    ...partial,
  };
}

function result(partial: Partial<DownloadResult>): DownloadResult {
  return {
    key: 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M',
    model: 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M',
    ok: true,
    cancelled: false,
    exitCode: 0,
    phase: 'done',
    error: null,
    link: '/m/x',
    bytesDownloaded: 1000,
    ...partial,
  };
}

beforeEach(() => {
  useModelsStore.setState(initial, true);
  browserSimulation.stepMs = 0;
  browserSimulation.steps = 4;
});

afterEach(async () => {
  ipc.invoke.mockReset();
  ipc.listeners.clear();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  const unsubscribe = await connectModelsEvents();
  unsubscribe();
});

describe('deriveModelLists', () => {
  it('splits the catalog into installed, downloading and available', () => {
    const active: DownloadState = {
      key: 'mlx-community/Qwen3.8-27B-4bit',
      model: 'mlx-community/Qwen3.8-27B-4bit',
      request: null,
      progress: progress({
        key: 'mlx-community/Qwen3.8-27B-4bit',
        model: 'mlx-community/Qwen3.8-27B-4bit',
      }),
      log: [],
      result: null,
      error: null,
      startedAtMs: 1,
    };
    const finished: DownloadState = {
      ...active,
      key: 'a/b',
      model: 'a/b',
      result: result({ key: 'a/b', model: 'a/b' }),
    };
    const lists = deriveModelLists(SAMPLE_CATALOG, SAMPLE_INSTALLED, {
      [active.key]: active,
      [finished.key]: finished,
    });

    expect(lists.installed.map((i) => i.model)).toEqual([
      'incoai/Qwen3.8-27B-Splash',
      'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M',
    ]);
    expect(lists.installed[1]?.entry?.label).toBe('Qwen3.8 27B · GGUF UD-Q4_K_M');
    expect(lists.installed[1]?.installation?.hashed).toBe(true);

    expect(lists.downloading.map((d) => d.model)).toEqual(['mlx-community/Qwen3.8-27B-4bit']);
    expect(lists.downloading[0]?.entry?.format).toBe('mlx');

    const available = lists.available.map((a) => a.id);
    expect(available).toContain('incoai/Qwen3.6-35B-A3B-Splash');
    expect(available).toContain('prism-ml/Ternary-Bonsai-2-27B-gguf:PQ2_0');
    expect(available).not.toContain('incoai/Qwen3.8-27B-Splash'); // installed
    expect(available).not.toContain('unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M'); // installed (text-only)
    expect(available).not.toContain('mlx-community/Qwen3.8-27B-4bit'); // downloading
    expect(available).not.toContain('incoai/Qwen3.8-27B-DFlash2'); // a draft
  });

  it('works before anything loaded', () => {
    expect(deriveModelLists(null, null, {})).toEqual({
      installed: [],
      downloading: [],
      available: [],
    });
  });

  it('computes the download fraction', () => {
    const base: DownloadState = {
      key: 'k',
      model: 'a/b',
      request: null,
      progress: null,
      log: [],
      result: null,
      error: null,
      startedAtMs: 0,
    };
    expect(downloadFraction(base)).toBeNull();
    expect(
      downloadFraction({ ...base, progress: progress({ bytesDone: 250, bytesTotal: 1000 }) }),
    ).toBe(0.25);
    expect(
      downloadFraction({ ...base, progress: progress({ bytesDone: 2000, bytesTotal: 1000 }) }),
    ).toBe(1);
  });
});

describe('models in a browser', () => {
  it('serves fixtures and simulates a download through events', async () => {
    await connectModelsEvents();
    await useModelsStore.getState().refreshAll();
    expect(useModelsStore.getState().catalog?.entries.length).toBe(SAMPLE_CATALOG.entries.length);
    expect(useModelsStore.getState().installed?.installations).toHaveLength(2);

    const seen: ModelProgress[] = [];
    const unlisten = await modelsApi.onProgress((p) => seen.push(p));
    const outcome = await useModelsStore
      .getState()
      .download({ model: 'mlx-community/Qwen3.8-27B-4bit' });
    unlisten();
    expect(outcome?.ok).toBe(true);
    expect(seen.map((p) => p.phase)).toContain('downloading');
    expect(seen.at(-1)?.phase).toBe('done');
    const download = useModelsStore.getState().downloads['mlx-community/Qwen3.8-27B-4bit'];
    expect(download?.result?.ok).toBe(true);
    expect(download?.progress?.bytesDone).toBe(download?.progress?.bytesTotal);
    expect(download?.log.length).toBeGreaterThan(0);
  });

  it('reports desktop-only actions as unavailable', async () => {
    expect(await useModelsStore.getState().saveToken('hf_xxxxxxxxxxxxxxxx')).toBeNull();
    expect(useModelsStore.getState().tokenError?.kind).toBe('unavailable');
    expect(await useModelsStore.getState().remove('a/b', false)).toBeNull();
    expect(useModelsStore.getState().error?.kind).toBe('unavailable');
  });
});

describe('models in Tauri', () => {
  beforeEach(enableTauri);

  it('passes requests and options to the commands', async () => {
    useModelsStore.getState().setHfCacheDir(' /Volumes/Models/hf ');
    ipc.invoke.mockResolvedValue(SAMPLE_CATALOG);
    await useModelsStore.getState().loadCatalog({ refresh: true });
    expect(ipc.invoke).toHaveBeenLastCalledWith('models_catalog', {
      refresh: true,
      hfCacheDir: '/Volumes/Models/hf',
    });

    ipc.invoke.mockResolvedValue({ id: 'a/b', removed: [], bytesFreed: 0, errors: [] });
    await useModelsStore.getState().remove('a/b', true);
    expect(ipc.invoke).toHaveBeenCalledWith('models_remove', {
      id: 'a/b',
      alsoFreeDownloads: true,
      hfCacheDir: '/Volumes/Models/hf',
    });
    expect(ipc.invoke).toHaveBeenLastCalledWith('models_installed', {
      hfCacheDir: '/Volumes/Models/hf',
    });

    ipc.invoke.mockResolvedValue({ hasToken: true });
    await useModelsStore.getState().saveToken('hf_secret_value_123');
    expect(ipc.invoke).toHaveBeenLastCalledWith('hf_token_save', {
      token: 'hf_secret_value_123',
      verify: true,
    });
    expect(JSON.stringify(useModelsStore.getState())).not.toContain('hf_secret_value_123');

    ipc.invoke.mockResolvedValue(true);
    await useModelsStore.getState().cancelDownload('pending:a/b');
    expect(ipc.invoke).toHaveBeenLastCalledWith('models_download_cancel', { key: 'a/b' });
  });

  it('follows a hashed download from its first event to its result', async () => {
    await connectModelsEvents();
    const hashedKey = `.selections/${'a'.repeat(64)}`;
    const model = 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M';
    let finish: (value: unknown) => void = () => undefined;
    ipc.invoke.mockImplementation((cmd) => {
      if (cmd === 'models_download') return new Promise((resolve) => (finish = resolve));
      if (cmd === 'models_installed') return Promise.resolve(SAMPLE_INSTALLED);
      return Promise.resolve([]);
    });
    const request = { model, languageOnly: true };
    expect(plainKey(request)).toBeNull();
    const running = useModelsStore.getState().download(request);
    expect(Object.keys(useModelsStore.getState().downloads)).toEqual([`pending:${model}`]);

    emit('models://progress', progress({ key: hashedKey, model, phase: 'checking', tsMs: 1 }));
    expect(Object.keys(useModelsStore.getState().downloads)).toEqual([hashedKey]);
    expect(useModelsStore.getState().downloads[hashedKey]?.request?.languageOnly).toBe(true);

    emit('models://progress', progress({ key: hashedKey, model, bytesDone: 500, tsMs: 3 }));
    emit('models://progress', progress({ key: hashedKey, model, bytesDone: 100, tsMs: 2 })); // stale
    expect(useModelsStore.getState().downloads[hashedKey]?.progress?.bytesDone).toBe(500);
    const log: ModelLog = {
      key: hashedKey,
      model,
      kind: 'download',
      line: 'Fetching ...',
      stream: 'stdout',
      tsMs: 4,
    };
    emit('models://log', log);
    expect(useModelsStore.getState().downloads[hashedKey]?.log).toHaveLength(1);

    finish(result({ key: hashedKey, model }));
    expect((await running)?.ok).toBe(true);
    const download = useModelsStore.getState().downloads[hashedKey];
    expect(download?.result?.phase).toBe('done');
    await vi.waitFor(() => expect(useModelsStore.getState().installed).not.toBeNull());
  });

  it('records a refused download on its row', async () => {
    ipc.invoke.mockRejectedValueOnce({
      kind: 'splashNotInstalled',
      message: 'Splash is not installed.',
    });
    expect(await useModelsStore.getState().download({ model: 'a/b' })).toBeNull();
    expect(useModelsStore.getState().downloads['a/b']?.error?.kind).toBe('splashNotInstalled');
    expect(useModelsStore.getState().error?.kind).toBe('splashNotInstalled');
  });

  it('adopts downloads already running in Rust', async () => {
    ipc.invoke.mockImplementation((cmd) =>
      Promise.resolve(
        cmd === 'models_jobs'
          ? [
              {
                key: 'a/b',
                model: 'a/b',
                kind: 'download',
                startedAtMs: 5,
                last: progress({ key: 'a/b', model: 'a/b', bytesDone: 42 }),
              },
            ]
          : null,
      ),
    );
    await connectModelsEvents();
    expect(useModelsStore.getState().downloads['a/b']?.progress?.bytesDone).toBe(42);
    expect(useModelsStore.getState().downloads['a/b']?.startedAtMs).toBe(5);
  });

  it('caps the per-download log and ignores verify lines', () => {
    const { applyLog } = useModelsStore.getState();
    for (let i = 0; i < MAX_DOWNLOAD_LOG + 5; i++) {
      applyLog({
        key: 'a/b',
        model: 'a/b',
        kind: 'download',
        line: `l${i}`,
        stream: 'stdout',
        tsMs: i,
      });
    }
    applyLog({ key: 'c/d', model: 'c/d', kind: 'verify', line: 'x', stream: 'stdout', tsMs: 1 });
    expect(useModelsStore.getState().downloads['a/b']?.log).toHaveLength(MAX_DOWNLOAD_LOG);
    expect(useModelsStore.getState().downloads['c/d']).toBeUndefined();
  });
});
