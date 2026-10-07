/**
 * Shared models state: the catalog, what is installed, downloads in flight
 * (fed by `models://progress` and `models://log`), and the Hugging Face token
 * status. `connectModelsEvents()` subscribes once (idempotent) and adopts
 * downloads already running. Actions never throw: failures land in `error`
 * (or `tokenError`) as an OpError.
 *
 * `deriveModelLists()` / `useModelLists()` give the three lists the Models
 * screen shows: installed, downloading and available.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { toOpError, type OpError } from '../install/types';
import { modelsApi, plainKey } from './api';
import {
  FINAL_DOWNLOAD_PHASES,
  type Catalog,
  type CatalogEntry,
  type DownloadPhase,
  type DownloadResult,
  type InstalledReport,
  type Installation,
  type JobSnapshot,
  type ModelLog,
  type ModelProgress,
  type ModelRequest,
  type RemovePlan,
  type RemoveResult,
  type TokenStatus,
  type VerifyResult,
} from './types';

/** Installer lines kept per download. */
export const MAX_DOWNLOAD_LOG = 500;
const PENDING = 'pending:';

export interface DownloadState {
  /** Rust job key (selection link), or `pending:<model>` until the first event. */
  key: string;
  model: string;
  request: ModelRequest | null;
  progress: ModelProgress | null;
  log: ModelLog[];
  result: DownloadResult | null;
  error: OpError | null;
  startedAtMs: number;
}

export function downloadPhase(download: DownloadState): DownloadPhase {
  if (download.result) return download.result.phase;
  if (download.error) return 'failed';
  return download.progress?.phase ?? 'checking';
}

export function isDownloadActive(download: DownloadState): boolean {
  return !FINAL_DOWNLOAD_PHASES.includes(downloadPhase(download));
}

/** 0..1, or null while the size is unknown. */
export function downloadFraction(download: DownloadState): number | null {
  const p = download.progress;
  if (!p || p.bytesTotal <= 0) return downloadPhase(download) === 'done' ? 1 : null;
  return Math.min(1, p.bytesDone / p.bytesTotal);
}

export interface ModelsStoreState {
  available: boolean;
  catalog: Catalog | null;
  installed: InstalledReport | null;
  downloads: Record<string, DownloadState>;
  token: TokenStatus | null;
  /** Settings > Storage override for HF_HUB_CACHE; null = default. */
  hfCacheDir: string | null;
  loadingCatalog: boolean;
  loadingInstalled: boolean;
  error: OpError | null;
  tokenError: OpError | null;

  setHfCacheDir: (dir: string | null) => void;
  loadCatalog: (options?: { refresh?: boolean }) => Promise<Catalog | null>;
  loadInstalled: () => Promise<InstalledReport | null>;
  refreshAll: (options?: { refresh?: boolean }) => Promise<void>;
  download: (request: ModelRequest) => Promise<DownloadResult | null>;
  cancelDownload: (keyOrModel: string) => Promise<boolean>;
  /** Forget a finished download (its row leaves the downloading list). */
  dismissDownload: (key: string) => void;
  verify: (request: ModelRequest, full?: boolean) => Promise<VerifyResult | null>;
  planRemoval: (id: string, alsoFreeDownloads: boolean) => Promise<RemovePlan | null>;
  remove: (id: string, alsoFreeDownloads: boolean) => Promise<RemoveResult | null>;
  loadToken: (verify?: boolean) => Promise<TokenStatus | null>;
  saveToken: (token: string, verify?: boolean) => Promise<TokenStatus | null>;
  removeToken: () => Promise<TokenStatus | null>;
  applyProgress: (progress: ModelProgress) => void;
  applyLog: (line: ModelLog) => void;
  /** Adopts jobs running in Rust (after a reload or a late mount). */
  syncJobs: () => Promise<void>;
}

function newDownload(
  key: string,
  model: string,
  request: ModelRequest | null,
  startedAtMs = Date.now(),
): DownloadState {
  return { key, model, request, progress: null, log: [], result: null, error: null, startedAtMs };
}

/**
 * A copy of `downloads` with an entry for `key`, adopting a pending one for
 * the same model. Always a new object, so callers may assign into it.
 */
function claim(
  downloads: Record<string, DownloadState>,
  key: string,
  model: string,
): Record<string, DownloadState> {
  const next = { ...downloads };
  if (next[key]) return next;
  const pendingKey = `${PENDING}${model}`;
  const pending = next[pendingKey];
  if (pending) {
    delete next[pendingKey];
    next[key] = { ...pending, key };
  } else {
    next[key] = newDownload(key, model, null);
  }
  return next;
}

export const useModelsStore = create<ModelsStoreState>()((set, get) => ({
  available: modelsApi.available,
  catalog: null,
  installed: null,
  downloads: {},
  token: null,
  hfCacheDir: null,
  loadingCatalog: false,
  loadingInstalled: false,
  error: null,
  tokenError: null,

  setHfCacheDir: (dir) => set({ hfCacheDir: dir && dir.trim() ? dir.trim() : null }),

  loadCatalog: async (options = {}) => {
    set({ loadingCatalog: true });
    try {
      const catalog = await modelsApi.catalog({
        refresh: options.refresh,
        hfCacheDir: get().hfCacheDir,
      });
      set({ catalog, loadingCatalog: false });
      return catalog;
    } catch (e) {
      set({ loadingCatalog: false, error: toOpError(e) });
      return null;
    }
  },

  loadInstalled: async () => {
    set({ loadingInstalled: true });
    try {
      const installed = await modelsApi.installed({ hfCacheDir: get().hfCacheDir });
      set({ installed, loadingInstalled: false });
      return installed;
    } catch (e) {
      set({ loadingInstalled: false, error: toOpError(e) });
      return null;
    }
  },

  refreshAll: async (options = {}) => {
    await Promise.all([get().loadCatalog(options), get().loadInstalled()]);
  },

  download: async (request) => {
    const full: ModelRequest = { ...request, hfCacheDir: request.hfCacheDir ?? get().hfCacheDir };
    const key = plainKey(full) ?? `${PENDING}${full.model}`;
    const existing = get().downloads[key];
    if (existing && isDownloadActive(existing)) {
      set({ error: { kind: 'busy', message: `${full.model} is already being downloaded` } });
      return null;
    }
    set((s) => ({ downloads: { ...s.downloads, [key]: newDownload(key, full.model, full) } }));
    try {
      const result = await modelsApi.download(full);
      set((s) => {
        const downloads = claim(s.downloads, result.key, result.model);
        const current = downloads[result.key];
        if (current)
          downloads[result.key] = { ...current, request: current.request ?? full, result };
        return { downloads };
      });
      if (result.ok) void get().loadInstalled();
      return result;
    } catch (e) {
      const error = toOpError(e);
      set((s) => {
        const pendingKey = `${PENDING}${full.model}`;
        const at = s.downloads[key] ? key : s.downloads[pendingKey] ? pendingKey : key;
        const current = s.downloads[at] ?? newDownload(at, full.model, full);
        return { downloads: { ...s.downloads, [at]: { ...current, error } }, error };
      });
      return null;
    }
  },

  cancelDownload: async (keyOrModel) => {
    const key = keyOrModel.startsWith(PENDING) ? keyOrModel.slice(PENDING.length) : keyOrModel;
    try {
      return await modelsApi.cancel(key);
    } catch (e) {
      set({ error: toOpError(e) });
      return false;
    }
  },

  dismissDownload: (key) =>
    set((s) => {
      const downloads = { ...s.downloads };
      delete downloads[key];
      return { downloads };
    }),

  verify: async (request, full = false) => {
    try {
      return await modelsApi.verify(request, full);
    } catch (e) {
      set({ error: toOpError(e) });
      return null;
    }
  },

  planRemoval: async (id, alsoFreeDownloads) => {
    try {
      return await modelsApi.removePlan(id, { alsoFreeDownloads, hfCacheDir: get().hfCacheDir });
    } catch (e) {
      set({ error: toOpError(e) });
      return null;
    }
  },

  remove: async (id, alsoFreeDownloads) => {
    try {
      const result = await modelsApi.remove(id, {
        alsoFreeDownloads,
        hfCacheDir: get().hfCacheDir,
      });
      void get().loadInstalled();
      return result;
    } catch (e) {
      set({ error: toOpError(e) });
      return null;
    }
  },

  loadToken: async (verify = false) => {
    try {
      const token = await modelsApi.tokenStatus(verify);
      set({ token, tokenError: null });
      return token;
    } catch (e) {
      set({ tokenError: toOpError(e) });
      return null;
    }
  },

  saveToken: async (token, verify = true) => {
    try {
      const status = await modelsApi.saveToken(token, verify);
      set({ token: status, tokenError: null });
      return status;
    } catch (e) {
      set({ tokenError: toOpError(e) });
      return null;
    }
  },

  removeToken: async () => {
    try {
      const status = await modelsApi.removeToken();
      set({ token: status, tokenError: null });
      return status;
    } catch (e) {
      set({ tokenError: toOpError(e) });
      return null;
    }
  },

  applyProgress: (progress) =>
    set((s) => {
      const downloads = claim(s.downloads, progress.key, progress.model);
      const current = downloads[progress.key];
      if (!current) return s;
      // Events can arrive out of order across the IPC boundary.
      if (current.progress && current.progress.tsMs > progress.tsMs) return s;
      downloads[progress.key] = { ...current, progress };
      return { downloads };
    }),

  applyLog: (line) =>
    set((s) => {
      if (line.kind !== 'download') return s;
      const downloads = claim(s.downloads, line.key, line.model);
      const current = downloads[line.key];
      if (!current) return s;
      const log = [...current.log, line];
      downloads[line.key] = {
        ...current,
        log: log.length > MAX_DOWNLOAD_LOG ? log.slice(-MAX_DOWNLOAD_LOG) : log,
      };
      return { downloads };
    }),

  syncJobs: async () => {
    let jobs: JobSnapshot[];
    try {
      jobs = await modelsApi.jobs();
    } catch {
      return;
    }
    if (!Array.isArray(jobs) || jobs.length === 0) return;
    set((s) => {
      let downloads = s.downloads;
      for (const job of jobs) {
        if (job.kind !== 'download') continue;
        downloads = claim(downloads, job.key, job.model);
        const current = downloads[job.key];
        if (current && job.last && (!current.progress || current.progress.tsMs < job.last.tsMs)) {
          downloads[job.key] = { ...current, progress: job.last, startedAtMs: job.startedAtMs };
        }
      }
      return { downloads };
    });
  },
}));

// --- derived lists ------------------------------------------------------------------

export type ModelState = 'installed' | 'downloading' | 'available';

export interface ModelListItem {
  /** Installation id, download key, or catalog id. */
  id: string;
  /** OWNER/REPO[:VARIANT], when known. */
  model: string | null;
  state: ModelState;
  entry: CatalogEntry | null;
  installation: Installation | null;
  download: DownloadState | null;
}

export interface ModelLists {
  installed: ModelListItem[];
  downloading: ModelListItem[];
  available: ModelListItem[];
}

export function deriveModelLists(
  catalog: Catalog | null,
  installed: InstalledReport | null,
  downloads: Record<string, DownloadState>,
): ModelLists {
  const entries = catalog?.entries ?? [];
  const entryFor = (model: string | null) =>
    model ? (entries.find((e) => e.id === model) ?? null) : null;
  const installations = installed?.installations ?? [];
  const active = Object.values(downloads).filter(isDownloadActive);

  const installedItems: ModelListItem[] = installations.map((installation) => ({
    id: installation.id,
    model: installation.model,
    state: 'installed',
    entry: entryFor(installation.model),
    installation,
    download: active.find((d) => d.key === installation.id) ?? null,
  }));

  const downloading: ModelListItem[] = active
    .sort((a, b) => a.startedAtMs - b.startedAtMs)
    .map((download) => ({
      id: download.key,
      model: download.model,
      state: 'downloading',
      entry: entryFor(download.model),
      installation: installations.find((i) => i.id === download.key) ?? null,
      download,
    }));

  const installedModels = new Set(
    installations.map((i) => i.model).filter((m): m is string => m !== null),
  );
  const downloadingModels = new Set(active.map((d) => d.model));
  const available: ModelListItem[] = entries
    .filter((e) => e.servable && !installedModels.has(e.id) && !downloadingModels.has(e.id))
    .map((entry) => ({
      id: entry.id,
      model: entry.id,
      state: 'available',
      entry,
      installation: null,
      download: null,
    }));

  return { installed: installedItems, downloading, available };
}

/** The installed / downloading / available lists, memoized. */
export function useModelLists(): ModelLists {
  const catalog = useModelsStore((s) => s.catalog);
  const installed = useModelsStore((s) => s.installed);
  const downloads = useModelsStore((s) => s.downloads);
  return useMemo(
    () => deriveModelLists(catalog, installed, downloads),
    [catalog, installed, downloads],
  );
}

let connected: Promise<() => void> | undefined;

/** Subscribes the store to `models://progress` and `models://log`. Idempotent. */
export function connectModelsEvents(): Promise<() => void> {
  connected ??= (async () => {
    const store = useModelsStore.getState();
    const unlistenProgress = await modelsApi.onProgress(store.applyProgress);
    const unlistenLog = await modelsApi.onLog(store.applyLog);
    await useModelsStore.getState().syncJobs();
    return () => {
      unlistenProgress();
      unlistenLog();
      connected = undefined;
    };
  })().catch((error: unknown) => {
    connected = undefined;
    throw error;
  });
  return connected;
}
