/**
 * Types for the Splash installer commands (src-tauri/src/install/). Every
 * field mirrors the Rust struct named in its comment (serde camelCase).
 */

/** Rust `OpError`: what install_*, models_* and hf_token_* commands reject with. */
export interface OpError {
  kind:
    | 'needsTerminal'
    | 'splashNotInstalled'
    | 'busy'
    | 'inUse'
    | 'invalidRequest'
    | 'notFound'
    | 'failed'
    | 'io'
    | 'timeout'
    | 'offline'
    | 'http'
    | 'other'
    /** Browser mode: the desktop app is needed. */
    | 'unavailable';
  message: string;
  /** needsTerminal: the command to run in the embedded terminal. */
  command?: string;
  /** needsTerminal: a page to open instead. */
  url?: string;
}

export function isOpError(value: unknown): value is OpError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as OpError).kind === 'string' &&
    typeof (value as OpError).message === 'string'
  );
}

/** Any rejection as an OpError (Tauri rejects with the serialized error). */
export function toOpError(value: unknown): OpError {
  if (isOpError(value)) return value;
  if (value instanceof Error) return { kind: 'other', message: value.message };
  return { kind: 'other', message: String(value) };
}

/** Rust `runner::Stream`. */
export type OutputStream = 'stdout' | 'stderr' | 'system';

/** Rust `HomebrewStatus`. */
export interface HomebrewStatus {
  found: boolean;
  path: string | null;
  prefix: string | null;
}

/** Rust `SplashLocation`. */
export interface SplashLocation {
  source: 'homebrew' | 'tester';
  libexec: string;
  version: string | null;
  python: string;
  pythonOk: boolean;
  engine: string;
}

/** Rust `RunningServer` (from Splash's runtime/serve-<port>.lock). */
export interface RunningServer {
  pid: number;
  model: string;
  port: number;
  lockFile: string;
}

/** Rust `InstallStatus` (`install_status`). */
export interface InstallStatus {
  homebrew: HomebrewStatus;
  splash: SplashLocation | null;
  installed: boolean;
  version: string | null;
  dataDir: string | null;
  modelsDir: string | null;
  runningServers: RunningServer[];
}

/** Rust `TapInfo` (brew info --json=v2 incoai/tap/splash). */
export interface TapInfo {
  formula: string;
  stable: string | null;
  installed: string[];
  outdated: boolean;
  pinned: boolean;
  tap: string | null;
}

/** Rust `GithubRelease`. */
export interface GithubRelease {
  version: string;
  name: string | null;
  url: string | null;
  publishedAt: string | null;
  notes: string | null;
}

/** Rust `LatestCheck` (`install_check_latest`). */
export interface LatestCheck {
  installed: string | null;
  tap: TapInfo | null;
  tapError: string | null;
  github: GithubRelease | null;
  githubError: string | null;
  latest: string | null;
  /** `brew upgrade` would install a newer version. */
  upgradeAvailable: boolean;
  /** GitHub has a newer release than the tap offers yet. */
  releaseNotInTap: boolean;
  checkedAtMs: number;
}

export type BrewAction = 'install' | 'upgrade' | 'uninstall';

export type InstallPhase =
  | 'starting'
  | 'updating'
  | 'downloading'
  | 'installing'
  | 'uninstalling'
  | 'finishing'
  | 'done'
  | 'failed'
  | 'cancelled';

/** Rust `InstallProgress`: the `install://progress` payload. */
export interface InstallProgress {
  jobId: string;
  action: BrewAction;
  phase: InstallPhase;
  /** null on the final phase-only event. */
  line: string | null;
  stream: OutputStream;
  tsMs: number;
  /** Set on the final event. */
  exitCode: number | null;
}

/** Rust `BrewRunResult` (`install_run`). */
export interface BrewRunResult {
  jobId: string;
  action: BrewAction;
  ok: boolean;
  cancelled: boolean;
  exitCode: number | null;
  phase: InstallPhase;
  logTail: string[];
  error: string | null;
}

/** Rust `HomebrewInstallCommand`. */
export interface HomebrewInstallCommand {
  command: string;
  url: string;
}

/** Rust `ActiveBrewJob`. */
export interface ActiveBrewJob {
  jobId: string;
  action: BrewAction;
}

export const FINAL_INSTALL_PHASES: readonly InstallPhase[] = ['done', 'failed', 'cancelled'];
