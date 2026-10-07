/**
 * Typed bindings for the installer commands (src-tauri/src/install/).
 *
 * In a plain browser (`pnpm web`) reads return the sample data in
 * ./fixtures.ts and `run()` plays a short simulated brew log through the same
 * event API, so UI work can proceed without the desktop app.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri, newId } from '../env';
import {
  SAMPLE_INSTALL_STATUS,
  SAMPLE_LATEST,
  SAMPLE_UPGRADE_LINES,
  sampleRunResult,
} from './fixtures';
import type {
  ActiveBrewJob,
  BrewAction,
  BrewRunResult,
  HomebrewInstallCommand,
  InstallProgress,
  InstallStatus,
  LatestCheck,
} from './types';

export const INSTALL_PROGRESS_EVENT = 'install://progress';

export const HOMEBREW_INSTALL: HomebrewInstallCommand = {
  command:
    '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
  url: 'https://brew.sh',
};

/** Browser-mode stand-in for Tauri events. */
const browserListeners = new Set<(progress: InstallProgress) => void>();
let browserCancel: (() => void) | undefined;
/** Delay between simulated lines; tests set it to 0. */
export const browserSimulation = { stepMs: 250 };

/** Fixture copies, so callers may mutate what they get. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function simulateRun(action: BrewAction): Promise<BrewRunResult> {
  const jobId = `browser-${newId()}`;
  let cancelled = false;
  browserCancel = () => {
    cancelled = true;
  };
  const emit = (progress: Omit<InstallProgress, 'jobId' | 'action' | 'tsMs'>) => {
    const event: InstallProgress = { ...progress, jobId, action, tsMs: Date.now() };
    for (const listener of browserListeners) listener(event);
  };
  try {
    for (const line of SAMPLE_UPGRADE_LINES) {
      if (cancelled) break;
      emit({ ...line, exitCode: null });
      await sleep(browserSimulation.stepMs);
    }
    if (cancelled) {
      emit({ phase: 'cancelled', line: null, stream: 'system', exitCode: 130 });
      return {
        ...sampleRunResult(action, jobId),
        ok: false,
        cancelled: true,
        exitCode: 130,
        phase: 'cancelled',
      };
    }
    emit({ phase: 'done', line: null, stream: 'system', exitCode: 0 });
    return sampleRunResult(action, jobId);
  } finally {
    browserCancel = undefined;
  }
}

export const installApi = {
  /** False in a plain browser (sample data, simulated jobs). */
  get available(): boolean {
    return isTauri();
  },

  /** Homebrew, Splash (version from release.json) and running servers. Fast. */
  status(): Promise<InstallStatus> {
    if (!isTauri()) return Promise.resolve(clone(SAMPLE_INSTALL_STATUS));
    return invoke<InstallStatus>('install_status');
  },

  /** brew info + GitHub releases, both reported (the tap can lag). */
  checkLatest(): Promise<LatestCheck> {
    if (!isTauri()) return Promise.resolve({ ...clone(SAMPLE_LATEST), checkedAtMs: Date.now() });
    return invoke<LatestCheck>('install_check_latest');
  },

  /** The official Homebrew installer, for the embedded terminal. */
  homebrewCommand(): Promise<HomebrewInstallCommand> {
    if (!isTauri()) return Promise.resolve(HOMEBREW_INSTALL);
    return invoke<HomebrewInstallCommand>('install_homebrew_command');
  },

  /**
   * brew install|upgrade|uninstall incoai/tap/splash. Resolves when brew
   * exits; progress arrives through `onProgress`. Rejects with an OpError:
   * `needsTerminal` (no Homebrew), `inUse` (servers running; pass force
   * after stopping them or confirming), `busy`, `splashNotInstalled`.
   */
  run(action: BrewAction, options: { force?: boolean } = {}): Promise<BrewRunResult> {
    if (!isTauri()) return simulateRun(action);
    return invoke<BrewRunResult>('install_run', { action, force: options.force ?? null });
  },

  /** SIGINT to the running brew job. False when none runs. */
  cancel(): Promise<boolean> {
    if (!isTauri()) {
      const cancel = browserCancel;
      cancel?.();
      return Promise.resolve(cancel !== undefined);
    }
    return invoke<boolean>('install_cancel');
  },

  /** The brew job running now (for views mounted mid-install). */
  active(): Promise<ActiveBrewJob | null> {
    if (!isTauri()) return Promise.resolve(null);
    return invoke<ActiveBrewJob | null>('install_active');
  },

  onProgress(handler: (progress: InstallProgress) => void): Promise<UnlistenFn> {
    if (!isTauri()) {
      browserListeners.add(handler);
      return Promise.resolve(() => {
        browserListeners.delete(handler);
      });
    }
    return listen<InstallProgress>(INSTALL_PROGRESS_EVENT, (event) => handler(event.payload));
  },
};
