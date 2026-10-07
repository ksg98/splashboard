/**
 * Typed bindings for the model commands (src-tauri/src/models/).
 *
 * In a plain browser (`pnpm web`) reads return the sample data in
 * ./fixtures.ts and `download()` plays a short simulated download through the
 * same event API, so UI work can proceed without the desktop app.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from '../env';
import type { OpError } from '../install/types';
import {
  SAMPLE_CATALOG,
  SAMPLE_INSTALLED,
  SAMPLE_TOKEN,
  SAMPLE_VARIANTS,
  sampleRemovePlan,
} from './fixtures';
import type {
  Catalog,
  DiskSpace,
  DownloadResult,
  InstalledReport,
  JobSnapshot,
  ModelLog,
  ModelProgress,
  ModelRequest,
  OfficialRefresh,
  RemovePlan,
  RemoveResult,
  RepoVariants,
  TokenStatus,
  VerifyResult,
} from './types';

export const MODELS_PROGRESS_EVENT = 'models://progress';
export const MODELS_LOG_EVENT = 'models://log';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const unavailable = (): Promise<never> =>
  Promise.reject<never>({
    kind: 'unavailable',
    message: 'This needs the Splashboard desktop app.',
  } satisfies OpError);

/**
 * The job key Rust uses for a request: the selection link relative to the
 * models folder. Plain `--model` selections are the model ID; requests with
 * a revision, draft or text-only get a hashed `.selections/` link, whose
 * hash only Rust computes, so the store matches those by model.
 */
export function plainKey(request: ModelRequest): string | null {
  const hashed =
    Boolean(request.revision) || Boolean(request.draftModel) || Boolean(request.languageOnly);
  return hashed ? null : request.model;
}

// --- browser simulation ---------------------------------------------------------

const progressListeners = new Set<(p: ModelProgress) => void>();
const logListeners = new Set<(l: ModelLog) => void>();
const browserJobs = new Map<string, { cancelled: boolean; snapshot: JobSnapshot }>();
/** Delay between simulated steps; tests set it to 0. */
export const browserSimulation = { stepMs: 300, steps: 8 };

async function simulateDownload(request: ModelRequest): Promise<DownloadResult> {
  const key = plainKey(request) ?? `.selections/browser-${request.model}`;
  if (browserJobs.has(key)) {
    return Promise.reject<DownloadResult>({
      kind: 'busy',
      message: `${request.model} is already being downloaded`,
    } satisfies OpError);
  }
  const entry = SAMPLE_CATALOG.entries.find((e) => e.id === request.model);
  const total = entry?.sizeBytes ?? 10_000_000_000;
  const job: { cancelled: boolean; snapshot: JobSnapshot } = {
    cancelled: false,
    snapshot: { key, model: request.model, kind: 'download', startedAtMs: Date.now(), last: null },
  };
  browserJobs.set(key, job);
  const emit = (partial: Partial<ModelProgress>) => {
    const progress: ModelProgress = {
      model: request.model,
      key,
      repo: request.model.split(':')[0] ?? request.model,
      bytesDone: 0,
      bytesTotal: total,
      speed: 0,
      eta: null,
      phase: 'checking',
      segment: 1,
      files: 1,
      overallDone: 0,
      message: null,
      tsMs: Date.now(),
      ...partial,
    };
    job.snapshot = { ...job.snapshot, last: progress };
    for (const listener of progressListeners) listener(progress);
  };
  const log = (line: string) => {
    for (const listener of logListeners) {
      listener({
        key,
        model: request.model,
        kind: 'download',
        line,
        stream: 'stdout',
        tsMs: Date.now(),
      });
    }
  };
  try {
    emit({ phase: 'checking', bytesTotal: 0 });
    log(
      `Fetching 1 file(s), ${(total / 1e9).toFixed(2)} GB, from ${request.model}@4ca720788d1e; cached files are reused.`,
    );
    const { steps, stepMs } = browserSimulation;
    const speed = stepMs > 0 ? total / steps / (stepMs / 1000) : 0;
    for (let step = 1; step <= steps; step++) {
      if (job.cancelled) {
        emit({
          phase: 'cancelled',
          bytesDone: Math.round((total * (step - 1)) / steps),
          message: 'cancelled',
        });
        return {
          key,
          model: request.model,
          ok: false,
          cancelled: true,
          exitCode: 130,
          phase: 'cancelled',
          error: 'cancelled; the download resumes next time',
          link: key,
          bytesDownloaded: Math.round((total * (step - 1)) / steps),
        };
      }
      const done = Math.round((total * step) / steps);
      emit({
        phase: 'downloading',
        bytesDone: done,
        overallDone: done,
        speed,
        eta: speed > 0 ? (total - done) / speed : null,
      });
      await sleep(stepMs);
    }
    emit({ phase: 'preparing', bytesDone: total, overallDone: total });
    log(`Installed verified Splash model ${request.model}`);
    emit({ phase: 'done', bytesDone: total, overallDone: total });
    return {
      key,
      model: request.model,
      ok: true,
      cancelled: false,
      exitCode: 0,
      phase: 'done',
      error: null,
      link: key,
      bytesDownloaded: total,
    };
  } finally {
    browserJobs.delete(key);
  }
}

// --- bindings ---------------------------------------------------------------------

export const modelsApi = {
  /** False in a plain browser (sample data, simulated downloads). */
  get available(): boolean {
    return isTauri();
  },

  /** The catalog. `refresh` fetches sizes older than a day from the Hub. */
  catalog(options: { refresh?: boolean; hfCacheDir?: string | null } = {}): Promise<Catalog> {
    if (!isTauri()) return Promise.resolve(clone(SAMPLE_CATALOG));
    return invoke<Catalog>('models_catalog', {
      refresh: options.refresh ?? null,
      hfCacheDir: options.hfCacheDir ?? null,
    });
  },

  /** `install/catalog.py --refresh --force` (Splash's official list). */
  refreshOfficialCatalog(): Promise<OfficialRefresh> {
    if (!isTauri())
      return Promise.resolve({ ok: true, message: 'Refreshed the official model list.' });
    return invoke<OfficialRefresh>('models_catalog_refresh_official');
  },

  /** GGUF variants with sizes and vision projectors of a repository. */
  repoVariants(
    repo: string,
    options: { refresh?: boolean; hfCacheDir?: string | null } = {},
  ): Promise<RepoVariants> {
    if (!isTauri()) return Promise.resolve({ ...clone(SAMPLE_VARIANTS), repo });
    return invoke<RepoVariants>('models_repo_variants', {
      repo,
      refresh: options.refresh ?? null,
      hfCacheDir: options.hfCacheDir ?? null,
    });
  },

  /** Installations and supported hub cache downloads, with sizes on disk. */
  installed(options: { hfCacheDir?: string | null } = {}): Promise<InstalledReport> {
    if (!isTauri()) return Promise.resolve(clone(SAMPLE_INSTALLED));
    return invoke<InstalledReport>('models_installed', { hfCacheDir: options.hfCacheDir ?? null });
  },

  /** Download and install; resolves when the installer exits. */
  download(request: ModelRequest): Promise<DownloadResult> {
    if (!isTauri()) return simulateDownload(request);
    return invoke<DownloadResult>('models_download', { request });
  },

  /** Cancel by job key or model ID (partial files resume next time). */
  cancel(keyOrModel: string): Promise<boolean> {
    if (!isTauri()) {
      let found = false;
      for (const [key, job] of browserJobs) {
        if (key === keyOrModel || job.snapshot.model === keyOrModel) {
          job.cancelled = true;
          found = true;
        }
      }
      return Promise.resolve(found);
    }
    return invoke<boolean>('models_download_cancel', { key: keyOrModel });
  },

  /** Running downloads and checks with their last progress. */
  jobs(): Promise<JobSnapshot[]> {
    if (!isTauri()) return Promise.resolve([...browserJobs.values()].map((j) => j.snapshot));
    return invoke<JobSnapshot[]>('models_jobs');
  },

  /** Quick check, or `full` (re-reads every file, tens of GB). */
  verify(request: ModelRequest, full = false): Promise<VerifyResult> {
    if (!isTauri()) {
      return Promise.resolve({
        key: plainKey(request) ?? request.model,
        model: request.model,
        full,
        ok: true,
        cancelled: false,
        exitCode: 0,
        message: `Splash model ${request.model} preflight passed (${full ? 'full' : 'quick'}).`,
        output: [],
      });
    }
    return invoke<VerifyResult>('models_verify', { request, full });
  },

  /** Dry run: what removing deletes and frees. */
  removePlan(
    id: string,
    options: { alsoFreeDownloads?: boolean; hfCacheDir?: string | null } = {},
  ): Promise<RemovePlan> {
    if (!isTauri())
      return Promise.resolve(sampleRemovePlan(id, options.alsoFreeDownloads ?? false));
    return invoke<RemovePlan>('models_remove_plan', {
      id,
      alsoFreeDownloads: options.alsoFreeDownloads ?? null,
      hfCacheDir: options.hfCacheDir ?? null,
    });
  },

  /** Removes an installation (after the UI confirmed the plan). */
  remove(
    id: string,
    options: { alsoFreeDownloads?: boolean; hfCacheDir?: string | null } = {},
  ): Promise<RemoveResult> {
    if (!isTauri()) return unavailable();
    return invoke<RemoveResult>('models_remove', {
      id,
      alsoFreeDownloads: options.alsoFreeDownloads ?? null,
      hfCacheDir: options.hfCacheDir ?? null,
    });
  },

  diskSpace(options: { hfCacheDir?: string | null } = {}): Promise<DiskSpace> {
    if (!isTauri()) {
      return Promise.resolve({
        path: '/Users/you/.cache/huggingface/hub',
        freeBytes: 412e9,
        totalBytes: 994e9,
      });
    }
    return invoke<DiskSpace>('models_disk_space', { hfCacheDir: options.hfCacheDir ?? null });
  },

  /** Whether a token is saved; `verify` asks Hugging Face whose it is. */
  tokenStatus(verify = false): Promise<TokenStatus> {
    if (!isTauri()) return Promise.resolve(clone(SAMPLE_TOKEN));
    return invoke<TokenStatus>('hf_token_status', { verify });
  },

  /** Saves the token where huggingface_hub reads it. The token is never sent back. */
  saveToken(token: string, verify = true): Promise<TokenStatus> {
    if (!isTauri()) return unavailable();
    return invoke<TokenStatus>('hf_token_save', { token, verify });
  },

  removeToken(): Promise<TokenStatus> {
    if (!isTauri()) return Promise.resolve(clone(SAMPLE_TOKEN));
    return invoke<TokenStatus>('hf_token_remove');
  },

  onProgress(handler: (progress: ModelProgress) => void): Promise<UnlistenFn> {
    if (!isTauri()) {
      progressListeners.add(handler);
      return Promise.resolve(() => {
        progressListeners.delete(handler);
      });
    }
    return listen<ModelProgress>(MODELS_PROGRESS_EVENT, (event) => handler(event.payload));
  },

  onLog(handler: (line: ModelLog) => void): Promise<UnlistenFn> {
    if (!isTauri()) {
      logListeners.add(handler);
      return Promise.resolve(() => {
        logListeners.delete(handler);
      });
    }
    return listen<ModelLog>(MODELS_LOG_EVENT, (event) => handler(event.payload));
  },
};
