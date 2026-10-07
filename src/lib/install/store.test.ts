import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserSimulation, installApi } from './api';
import { SAMPLE_INSTALL_STATUS, SAMPLE_LATEST } from './fixtures';
import {
  connectInstallEvents,
  MAX_JOB_LINES,
  selectJobRunning,
  selectNeedsHomebrew,
  selectUpgradeAvailable,
  useInstallStore,
} from './store';
import { isOpError, toOpError, type InstallProgress, type OpError } from './types';

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

const initial = useInstallStore.getState();

function progress(partial: Partial<InstallProgress>): InstallProgress {
  return {
    jobId: 'brew-1',
    action: 'upgrade',
    phase: 'installing',
    line: 'line',
    stream: 'stdout',
    tsMs: 1,
    exitCode: null,
    ...partial,
  };
}

beforeEach(() => {
  useInstallStore.setState(initial, true);
  browserSimulation.stepMs = 0;
});

afterEach(async () => {
  ipc.invoke.mockReset();
  ipc.listeners.clear();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  const unsubscribe = await connectInstallEvents();
  unsubscribe();
});

describe('installApi in a browser', () => {
  it('returns sample data without touching IPC', async () => {
    expect(installApi.available).toBe(false);
    const status = await installApi.status();
    expect(status.version).toBe('1.2.0');
    status.version = 'mutated';
    expect(SAMPLE_INSTALL_STATUS.version).toBe('1.2.0');
    expect((await installApi.checkLatest()).latest).toBe(SAMPLE_LATEST.latest);
    expect((await installApi.homebrewCommand()).url).toBe('https://brew.sh');
    expect(ipc.invoke).not.toHaveBeenCalled();
  });

  it('simulates a brew run through the progress events', async () => {
    await connectInstallEvents();
    const result = await useInstallStore.getState().run('upgrade');
    expect(result?.ok).toBe(true);
    const job = useInstallStore.getState().job;
    expect(job?.phase).toBe('done');
    expect(job?.lines.some((l) => l.line === '==> Summary')).toBe(true);
    expect(job?.jobId).toBe(result?.jobId);
  });
});

describe('installApi in Tauri', () => {
  beforeEach(enableTauri);

  it('invokes the install commands with their arguments', async () => {
    ipc.invoke.mockResolvedValueOnce(SAMPLE_INSTALL_STATUS);
    await installApi.status();
    expect(ipc.invoke).toHaveBeenLastCalledWith('install_status');

    ipc.invoke.mockResolvedValueOnce({ jobId: 'b', action: 'uninstall', ok: true, phase: 'done' });
    await installApi.run('uninstall', { force: true });
    expect(ipc.invoke).toHaveBeenLastCalledWith('install_run', {
      action: 'uninstall',
      force: true,
    });

    ipc.invoke.mockResolvedValueOnce(true);
    await expect(installApi.cancel()).resolves.toBe(true);
    expect(ipc.invoke).toHaveBeenLastCalledWith('install_cancel');
  });

  it('keeps needsTerminal errors with the Homebrew command', async () => {
    const error: OpError = {
      kind: 'needsTerminal',
      message: 'Homebrew is not installed.',
      command:
        '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
      url: 'https://brew.sh',
    };
    ipc.invoke.mockRejectedValueOnce(error);
    const result = await useInstallStore.getState().run('install');
    expect(result).toBeNull();
    const job = useInstallStore.getState().job;
    expect(job?.phase).toBe('failed');
    expect(job?.error?.kind).toBe('needsTerminal');
    expect(job?.error?.command).toContain('install.sh');
  });

  it('streams install://progress into the job and re-detects after', async () => {
    await connectInstallEvents();
    let finish: (value: unknown) => void = () => undefined;
    ipc.invoke.mockImplementation((cmd) => {
      if (cmd === 'install_run') return new Promise((resolve) => (finish = resolve));
      if (cmd === 'install_status') return Promise.resolve(SAMPLE_INSTALL_STATUS);
      return Promise.resolve(null);
    });
    const running = useInstallStore.getState().run('upgrade');
    expect(selectJobRunning(useInstallStore.getState())).toBe(true);
    emit(
      'install://progress',
      progress({ phase: 'updating', line: '$ brew update', stream: 'system' }),
    );
    emit(
      'install://progress',
      progress({ phase: 'downloading', line: '==> Fetching downloads for: splash' }),
    );
    expect(useInstallStore.getState().job?.phase).toBe('downloading');
    expect(useInstallStore.getState().job?.lines).toHaveLength(2);

    emit(
      'install://progress',
      progress({ phase: 'done', line: null, stream: 'system', exitCode: 0 }),
    );
    finish({
      jobId: 'brew-1',
      action: 'upgrade',
      ok: true,
      cancelled: false,
      exitCode: 0,
      phase: 'done',
      logTail: [],
      error: null,
    });
    const result = await running;
    expect(result?.ok).toBe(true);
    expect(selectJobRunning(useInstallStore.getState())).toBe(false);
    expect(useInstallStore.getState().job?.lines).toHaveLength(2);
    await vi.waitFor(() => expect(useInstallStore.getState().status?.version).toBe('1.2.0'));
  });

  it('adopts a job started before the view mounted', async () => {
    ipc.invoke.mockImplementation((cmd) =>
      Promise.resolve(cmd === 'install_active' ? { jobId: 'brew-9', action: 'install' } : null),
    );
    await connectInstallEvents();
    expect(useInstallStore.getState().job?.jobId).toBe('brew-9');
    emit(
      'install://progress',
      progress({ jobId: 'brew-9', action: 'install', line: '==> Pouring' }),
    );
    expect(useInstallStore.getState().job?.lines.map((l) => l.line)).toEqual(['==> Pouring']);
  });
});

describe('install store', () => {
  it('caps the job log', () => {
    const { applyProgress } = useInstallStore.getState();
    for (let i = 0; i < MAX_JOB_LINES + 10; i++)
      applyProgress(progress({ line: `l${i}`, tsMs: i }));
    const lines = useInstallStore.getState().job?.lines ?? [];
    expect(lines).toHaveLength(MAX_JOB_LINES);
    expect(lines.at(-1)?.line).toBe(`l${MAX_JOB_LINES + 9}`);
  });

  it('refuses a second job while one runs', async () => {
    useInstallStore.getState().applyProgress(progress({ phase: 'installing' }));
    expect(await useInstallStore.getState().run('install')).toBeNull();
    expect(useInstallStore.getState().job?.error?.kind).toBe('busy');
  });

  it('derives Homebrew and update flags', async () => {
    expect(selectNeedsHomebrew(useInstallStore.getState())).toBe(false);
    useInstallStore.setState({
      status: { ...SAMPLE_INSTALL_STATUS, homebrew: { found: false, path: null, prefix: null } },
      latest: { ...SAMPLE_LATEST, upgradeAvailable: true },
    });
    expect(selectNeedsHomebrew(useInstallStore.getState())).toBe(true);
    expect(selectUpgradeAvailable(useInstallStore.getState())).toBe(true);
  });

  it('records read failures as OpErrors', async () => {
    enableTauri();
    ipc.invoke.mockRejectedValueOnce(new Error('boom'));
    expect(await useInstallStore.getState().refreshStatus()).toBeNull();
    expect(useInstallStore.getState().error).toEqual({ kind: 'other', message: 'boom' });
  });
});

describe('OpError helpers', () => {
  it('normalizes rejections', () => {
    expect(isOpError({ kind: 'busy', message: 'x' })).toBe(true);
    expect(isOpError('x')).toBe(false);
    expect(toOpError('plain')).toEqual({ kind: 'other', message: 'plain' });
  });
});
