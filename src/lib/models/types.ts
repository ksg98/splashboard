/**
 * Types for the model commands (src-tauri/src/models/). Every field mirrors
 * the Rust struct named in its comment (serde camelCase).
 */
import type { OutputStream } from '../install/types';

export type { OpError } from '../install/types';

export type ModelFormat = 'package' | 'mlx' | 'gguf' | 'draft';
export type CatalogSource = 'official' | 'suggested' | 'cachedCatalog' | 'upstream';
export type SizeSource = 'hub' | 'localTree' | 'docs';

/** Rust `CatalogEntry`. */
export interface CatalogEntry {
  /** What `--model` takes: OWNER/REPO[:VARIANT]. */
  id: string;
  repo: string;
  variant: string | null;
  family: string | null;
  format: ModelFormat;
  label: string;
  description: string | null;
  sources: CatalogSource[];
  /** False for DFlash2 drafts. */
  servable: boolean;
  recommended: boolean;
  minRamGb: number | null;
  sizeBytes: number | null;
  sizeSource: SizeSource | null;
  sizeFetchedAtMs: number | null;
  gated: boolean;
}

/** Rust `Catalog` (`models_catalog`). */
export interface Catalog {
  entries: CatalogEntry[];
  /** A refresh was asked for and the Hub could not be reached. */
  offline: boolean;
  errors: string[];
  refreshedAtMs: number | null;
}

/** Rust `RepoFile`. */
export interface RepoFile {
  name: string;
  size: number | null;
}

/** Rust `GgufVariant`. */
export interface GgufVariant {
  variant: string;
  file: string;
  sizeBytes: number | null;
  supported: boolean;
  note: string | null;
}

/** Rust `RepoVariants` (`models_repo_variants`). */
export interface RepoVariants {
  repo: string;
  sha: string | null;
  source: SizeSource;
  /** Smallest first. */
  variants: GgufVariant[];
  projectors: RepoFile[];
  visionLikely: boolean;
  /** Preselect "Text only" (--language-only). */
  textOnlyRecommended: boolean;
  hasSafetensors: boolean;
}

export type InstallationKind = 'assembly' | 'package' | 'broken';

/** Rust `SelectionOptions`. */
export interface SelectionOptions {
  revision: string | null;
  draftModel: string | null;
  languageOnly: boolean;
}

/** Rust `SourceRef`. */
export interface SourceRef {
  repo: string;
  revision: string | null;
}

/** Rust `Installation`: one selection link under Splash's models folder. */
export interface Installation {
  /** `owner/repo[:variant]` or `.selections/<sha256>`; pass to remove. */
  id: string;
  /** OWNER/REPO[:VARIANT], when known. */
  model: string | null;
  linkPath: string;
  targetPath: string | null;
  kind: InstallationKind;
  hashed: boolean;
  options: SelectionOptions | null;
  family: string | null;
  /** "mlx-affine" | "gguf" | "package" */
  targetFormat: string | null;
  /** "none" | "safetensors" | "gguf" */
  visionFormat: string | null;
  target: SourceRef | null;
  draft: SourceRef | null;
  repos: string[];
  sizeOnDisk: number;
  fileCount: number;
  complete: boolean;
  problems: string[];
  inUse: boolean;
  modifiedMs: number | null;
}

/** Rust `CachedSnapshot`. */
export interface CachedSnapshot {
  commit: string;
  refs: string[];
  files: number;
  bytes: number;
  dangling: number;
  modifiedMs: number | null;
}

/** Rust `CachedModel` (a flattened `CachedRepo` plus Splash context). */
export interface CachedModel {
  repo: string;
  path: string;
  sizeOnDisk: number;
  incompleteBytes: number;
  incompleteFiles: number;
  snapshots: CachedSnapshot[];
  splashPins: number;
  /** Every snapshot link resolves; leftover partials are in incomplete*. */
  complete: boolean;
  role: 'target' | 'draft';
  family: string | null;
  format: ModelFormat | null;
  linkedBy: string[];
  inCatalog: boolean;
  matchedBy: 'catalog' | 'installation' | 'config';
}

/** Rust `InstalledReport` (`models_installed`). */
export interface InstalledReport {
  modelsDir: string | null;
  hfCacheDir: string | null;
  installations: Installation[];
  cached: CachedModel[];
  cachedBytes: number;
}

/** Rust `ModelRequest`: `--model` and its source options. */
export interface ModelRequest {
  model: string;
  revision?: string | null;
  draftModel?: string | null;
  languageOnly?: boolean;
  /** Settings > Storage "Model download folder" (HF_HUB_CACHE). */
  hfCacheDir?: string | null;
}

export type DownloadPhase =
  'queued' | 'checking' | 'downloading' | 'preparing' | 'done' | 'failed' | 'cancelled';

export const FINAL_DOWNLOAD_PHASES: readonly DownloadPhase[] = ['done', 'failed', 'cancelled'];

/** Rust `ModelProgress`: the `models://progress` payload. */
export interface ModelProgress {
  model: string;
  /** Job key: the selection link relative to the models folder. */
  key: string;
  repo: string | null;
  bytesDone: number;
  bytesTotal: number;
  /** Bytes per second. */
  speed: number;
  /** Seconds left, when the speed is known. */
  eta: number | null;
  phase: DownloadPhase;
  segment: number;
  files: number;
  overallDone: number;
  message: string | null;
  tsMs: number;
}

export type JobKind = 'download' | 'verify';

/** Rust `ModelLog`: the `models://log` payload. */
export interface ModelLog {
  key: string;
  model: string;
  kind: JobKind;
  line: string;
  stream: OutputStream;
  tsMs: number;
}

/** Rust `JobSnapshot` (`models_jobs`). */
export interface JobSnapshot {
  key: string;
  model: string;
  kind: JobKind;
  startedAtMs: number;
  last: ModelProgress | null;
}

/** Rust `DownloadResult` (`models_download`). */
export interface DownloadResult {
  key: string;
  model: string;
  ok: boolean;
  cancelled: boolean;
  exitCode: number | null;
  phase: DownloadPhase;
  error: string | null;
  link: string;
  bytesDownloaded: number;
}

/** Rust `VerifyResult` (`models_verify`). */
export interface VerifyResult {
  key: string;
  model: string;
  full: boolean;
  ok: boolean;
  cancelled: boolean;
  exitCode: number | null;
  message: string;
  output: string[];
}

export type RemoveItemKind = 'selectionLink' | 'assembly' | 'pins' | 'hubRepo';

/** Rust `RemoveItem`. */
export interface RemoveItem {
  kind: RemoveItemKind;
  path: string;
  bytes: number;
  repo: string | null;
}

/** Rust `RemovePlan` (`models_remove_plan`): the dry run. */
export interface RemovePlan {
  id: string;
  model: string | null;
  alsoFreeDownloads: boolean;
  items: RemoveItem[];
  bytesFreed: number;
  kept: Array<{ repo: string; reason: string }>;
  /** Removal would be refused now (served, or an installation runs). */
  blocked: string | null;
}

/** Rust `RemoveResult` (`models_remove`). */
export interface RemoveResult {
  id: string;
  removed: string[];
  bytesFreed: number;
  errors: string[];
}

/** Rust `DiskSpace` (`models_disk_space`). */
export interface DiskSpace {
  path: string;
  freeBytes: number;
  totalBytes: number;
}

/** Rust `TokenStatus`. Never contains the token. */
export interface TokenStatus {
  hasToken: boolean;
  source: 'env' | 'file' | null;
  path: string | null;
  username: string | null;
  role: string | null;
  valid: boolean | null;
  error: string | null;
}

/** Rust `OfficialRefresh` (`models_catalog_refresh_official`). */
export interface OfficialRefresh {
  ok: boolean;
  message: string;
}
