/**
 * Typed bindings for the engine supervisor (src-tauri/src/splash/) and the
 * transport config commands. In a plain browser there is no supervisor:
 * `engine.available` is false, reads return neutral values and actions reject
 * with an `AppError` of kind "unavailable".
 *
 * Launch options are the catalog-driven `ServeRequest` built by
 * `buildServeRequest()` in `@/lib/params`; the Rust side renders exactly the
 * argv/env/command `renderServe()` shows (shared vectors in
 * src/lib/params/__fixtures__/serve-vectors.json).
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from '../env';
import type { RenderedServe, ServeFlag, ServeRequest } from '../params/serve';

export type { RenderedServe, ServeRequest } from '../params/serve';

export const ENGINE_STATE_EVENT = 'engine://state';
export const ENGINE_LOG_EVENT = 'engine://log';

/** Every lifecycle phase, in rough lifecycle order. */
export const ENGINE_PHASES = [
  'not_installed',
  'stopped',
  'starting',
  'downloading',
  'loading_weights',
  'warming',
  'ready',
  'busy',
  'idle_released',
  'restoring',
  'recovering',
  'stopping',
  'failed',
  'external',
] as const;

export type EnginePhase = (typeof ENGINE_PHASES)[number];

/** Rust `DownloadProgress`: bytes added to the HF cache since `Fetching …`. */
export interface DownloadProgress {
  repo: string;
  files: number;
  totalBytes: number;
  doneBytes: number;
  /** 0..1, or null when the total is unknown. */
  fraction: number | null;
}

/** Parsed from `Ready · <model> · context <N> · <url>`. */
export interface ReadyInfo {
  /** As printed, e.g. "256K" or "102,393". */
  context: string | null;
  contextTokens: number | null;
  languageOnly: boolean;
  url: string | null;
}

export interface ExitSummary {
  code: number | null;
  signal: number | null;
  /** True when the app asked it to stop. */
  requested: boolean;
  atMs: number;
}

/** Who runs the server the state describes. */
export type EngineOwner = 'none' | 'app' | 'adopted' | 'external';

/** Phase-specific fields (Rust `Phase`, flattened into the state). */
export type EnginePhaseState =
  | { phase: 'not_installed' }
  | { phase: 'stopped' }
  | { phase: 'starting' }
  | { phase: 'downloading'; progress: DownloadProgress | null }
  | { phase: 'loading_weights' }
  | { phase: 'warming' }
  | { phase: 'ready' }
  | { phase: 'busy' }
  | { phase: 'idle_released' }
  | { phase: 'restoring' }
  | { phase: 'recovering'; reason: string | null }
  | { phase: 'stopping' }
  | {
      phase: 'failed';
      reason: string;
      exitCode: number | null;
      signal: number | null;
      /** The last (up to 50) log lines of the run that failed. */
      lastLogLines: string[];
    }
  | {
      phase: 'external';
      /** Splash's own port lock is held (vs. any other program). */
      splash: boolean;
      /** Started by an earlier Splashboard session. */
      previousSession: boolean;
      /** `/ready` answered 200 at the last probe. */
      ready: boolean;
    };

/** Fields every state carries. */
export interface EngineStateCommon {
  /** @deprecated Same value as `phase`. */
  status: EnginePhase;
  owner: EngineOwner;
  pid: number | null;
  port: number | null;
  model: string | null;
  /** When the current phase was entered. */
  sinceMs: number;
  startedAtMs: number | null;
  readyAtMs: number | null;
  readyInfo: ReadyInfo | null;
  /** The command that was run, secrets redacted; null when not ours. */
  command: RenderedServe | null;
  /** Automatic restarts after crashes in this run. */
  restarts: number;
  lastExit: ExitSummary | null;
}

/** Rust `EngineState` (payload of `engine://state`). */
export type EngineState = EngineStateCommon & EnginePhaseState;

/** Rust `LogLine` (payload of `engine://log`). */
export interface LogLine {
  /** Monotonic per app run. */
  seq: number;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  tsMs: number;
  /** Set when this line moved the engine to a new phase. */
  phase?: EnginePhase;
}

/** Rust `SystemInfo`. */
export interface SystemInfo {
  macosVersion: string | null;
  chip: string | null;
  memoryBytes: number | null;
  arch: string;
  /** Metal's recommendedMaxWorkingSetSize: the real ceiling for --max-memory. */
  metalWorkingSetBytes: number;
  /** True when Metal was unavailable and 0.75 × RAM was used. */
  metalEstimated: boolean;
  unifiedMemory: boolean | null;
}

/** Rust `SplashInstall` (`engine_detect`). */
export interface SplashInstall {
  found: boolean;
  path: string | null;
  version: string | null;
  versionOutput: string | null;
  searched: string[];
  modelsDir: string | null;
  modelsDirExists: boolean;
  hfCacheDir: string | null;
  resolvedPath: string | null;
  libexecDir: string | null;
  homebrew: boolean;
  runtimeDir: string | null;
  system: SystemInfo;
}

/** Rust `ExternalServer` (`engine_discover`). */
export interface ExternalServer {
  port: number;
  pid: number | null;
  model: string | null;
  lockHeld: boolean;
  isSplash: boolean;
  previousSession: boolean;
  ready: boolean;
}

/** Rust `SupervisorSettings`. */
export interface SupervisorSettings {
  /** Restart after a crash of a server that reached Ready. Default off. */
  autoRestart: boolean;
  maxRestarts: number;
  restartWindowSecs: number;
  restartBackoffMs: number;
  /** Seconds between SIGINT and SIGTERM on stop. */
  stopGraceSecs: number;
  keepRunningOnQuit: boolean;
}

export type SupervisorSettingsPatch = Partial<SupervisorSettings>;

/** Rust `TransportConfigView`. */
export interface TransportConfig {
  port: number;
  baseUrl: string;
  hasApiKey: boolean;
}

export interface TransportConfigPatch {
  port?: number;
  /** "" clears the key. */
  apiKey?: string;
}

/** Rust `AppError` (src-tauri/src/error.rs), plus "unavailable" in a browser. */
export interface AppError {
  kind:
    | 'splashNotFound'
    | 'alreadyRunning'
    | 'portInUse'
    | 'invalidRequest'
    | 'versionTooOld'
    | 'notSplash'
    | 'notRunning'
    | 'timeout'
    | 'unreachable'
    | 'http'
    | 'io'
    | 'other'
    | 'unavailable';
  message: string;
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AppError).kind === 'string' &&
    typeof (value as AppError).message === 'string'
  );
}

/** Any thrown value as an `AppError`. */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  return { kind: 'other', message: value instanceof Error ? value.message : String(value) };
}

/** Listening and alive (requests are accepted). */
export function isServing(state: Pick<EngineState, 'phase'>): boolean {
  return (
    state.phase === 'ready' ||
    state.phase === 'busy' ||
    state.phase === 'idle_released' ||
    state.phase === 'restoring' ||
    state.phase === 'recovering'
  );
}

/** Spawned but not listening yet. */
export function isLaunching(state: Pick<EngineState, 'phase'>): boolean {
  return (
    state.phase === 'starting' ||
    state.phase === 'downloading' ||
    state.phase === 'loading_weights' ||
    state.phase === 'warming'
  );
}

/** A start would be accepted (nothing of ours is running). */
export function canStart(state: Pick<EngineState, 'phase'>): boolean {
  return state.phase === 'stopped' || state.phase === 'failed' || state.phase === 'external';
}

/** A neutral state (browser mode, before the first event). */
export function initialEngineState(phase: 'stopped' | 'not_installed' = 'stopped'): EngineState {
  return {
    phase,
    status: phase,
    owner: 'none',
    pid: null,
    port: null,
    model: null,
    sinceMs: 0,
    startedAtMs: null,
    readyAtMs: null,
    readyInfo: null,
    command: null,
    restarts: 0,
    lastExit: null,
  };
}

/**
 * @deprecated The pre-catalog typed launch options. Use `ServeRequest`
 * (`buildServeRequest()` from `@/lib/params`); `serveOptionsToRequest()`
 * converts. `apiKey` and `extraArgs` are not carried over: secrets come from
 * the app's settings and free-form argv is not allowed.
 */
export interface ServeOptions {
  model: string;
  port?: number;
  revision?: string;
  draftModel?: string;
  languageOnly?: boolean;
  offline?: boolean;
  host?: string;
  servedModelNames?: string[];
  announceServedName?: boolean;
  defaultReasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  kvFormat?: 'int8' | 'bf16';
  maxMemory?: string;
  maxCacheDisk?: string;
  persistentCache?: boolean;
  cacheDir?: string;
  maxContext?: string;
  decodeShare?: number;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  maxRequestSize?: string;
  maxImagePixels?: number;
  requestTimeout?: number;
  queueSize?: number;
  apiKey?: string;
  noWebui?: boolean;
  extraArgs?: string[];
}

const OPTION_KEYS: ReadonlyArray<[keyof ServeOptions, string]> = [
  ['revision', 'revision'],
  ['draftModel', 'draft_model'],
  ['languageOnly', 'language_only'],
  ['offline', 'offline'],
  ['host', 'host'],
  ['allowedHosts', 'allowed_host'],
  ['servedModelNames', 'served_model_name'],
  ['announceServedName', 'announce_served_name'],
  ['noWebui', 'no_webui'],
  ['maxMemory', 'max_memory'],
  ['maxContext', 'max_context'],
  ['maxImagePixels', 'max_image_pixels'],
  ['kvFormat', 'kv_format'],
  ['maxCacheDisk', 'max_cache_disk'],
  ['persistentCache', 'persistent_cache'],
  ['cacheDir', 'cache_dir'],
  ['decodeShare', 'decode_share'],
  ['queueSize', 'queue_size'],
  ['requestTimeout', 'request_timeout'],
  ['maxRequestSize', 'max_request_size'],
  ['defaultReasoningEffort', 'default_reasoning_effort'],
  ['allowedOrigins', 'allowed_origin'],
];

/** Converts the deprecated `ServeOptions` to a `ServeRequest` (no defaults stripped). */
export function serveOptionsToRequest(options: ServeOptions): ServeRequest {
  const flags: ServeFlag[] = [];
  for (const [field, key] of OPTION_KEYS) {
    const value = options[field];
    if (value === undefined || value === null || value === false || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    flags.push({ key, value });
  }
  return { model: options.model.trim(), port: options.port ?? 8000, flags };
}

const unavailable = (): Promise<never> =>
  Promise.reject<never>({
    kind: 'unavailable',
    message: 'Engine control needs the Splashboard desktop app.',
  } satisfies AppError);

const BROWSER_SYSTEM: SystemInfo = {
  macosVersion: null,
  chip: null,
  memoryBytes: null,
  arch: '',
  metalWorkingSetBytes: 0,
  metalEstimated: true,
  unifiedMemory: null,
};

const BROWSER_INSTALL: SplashInstall = {
  found: false,
  path: null,
  version: null,
  versionOutput: null,
  searched: [],
  modelsDir: null,
  modelsDirExists: false,
  hfCacheDir: null,
  resolvedPath: null,
  libexecDir: null,
  homebrew: false,
  runtimeDir: null,
  system: BROWSER_SYSTEM,
};

export const DEFAULT_SUPERVISOR_SETTINGS: SupervisorSettings = {
  autoRestart: false,
  maxRestarts: 3,
  restartWindowSecs: 300,
  restartBackoffMs: 1000,
  stopGraceSecs: 20,
  keepRunningOnQuit: false,
};

export const engine = {
  /** False in a plain browser: no process control, no engine events. */
  get available(): boolean {
    return isTauri();
  },

  /** Locate the CLI and describe the Mac. `binary` must be named `splash`. */
  detect(binary?: string): Promise<SplashInstall> {
    if (!isTauri()) return Promise.resolve(BROWSER_INSTALL);
    return invoke<SplashInstall>('engine_detect', { binary: binary ?? null });
  },

  /**
   * The argv / env (secrets redacted) / command `options` becomes for the
   * installed Splash, without starting it. Rejects like `start` would.
   */
  render(options: ServeRequest): Promise<RenderedServe> {
    if (!isTauri()) return unavailable();
    return invoke<RenderedServe>('engine_render', { options });
  },

  /**
   * Spawn `splash serve`. Resolves with `starting`, or with `external` when
   * a Splash server already holds the port (adopt or stop it). Rejects with
   * `portInUse` when another program holds it.
   */
  start(options: ServeRequest): Promise<EngineState> {
    if (!isTauri()) return unavailable();
    return invoke<EngineState>('engine_start', { options });
  },

  /** SIGINT → SIGTERM → SIGKILL; resolves with the final state. */
  stop(): Promise<EngineState> {
    if (!isTauri()) return unavailable();
    return invoke<EngineState>('engine_stop');
  },

  /** Stop, then start `options` (or the last request). */
  restart(options?: ServeRequest): Promise<EngineState> {
    if (!isTauri()) return unavailable();
    return invoke<EngineState>('engine_restart', { options: options ?? null });
  },

  state(): Promise<EngineState> {
    if (!isTauri()) return Promise.resolve(initialEngineState());
    return invoke<EngineState>('engine_state');
  },

  /** Buffered log backlog, oldest first. */
  logs(): Promise<LogLine[]> {
    if (!isTauri()) return Promise.resolve([]);
    return invoke<LogLine[]>('engine_logs');
  },

  /**
   * Save every log line of this app run to `path` (absolute, .log/.txt) or
   * to ~/Downloads. Resolves with the path written.
   */
  saveLog(path?: string): Promise<string> {
    if (!isTauri()) return unavailable();
    return invoke<string>('engine_save_log', { path: path ?? null });
  },

  /** Take over the external Splash server (shown in state, or on `port`). */
  adopt(port?: number): Promise<EngineState> {
    if (!isTauri()) return unavailable();
    return invoke<EngineState>('engine_adopt', { port: port ?? null });
  },

  /** SIGINT the Splash server holding `port`'s lock (verified to be Splash). */
  stopExternal(port?: number): Promise<EngineState> {
    if (!isTauri()) return unavailable();
    return invoke<EngineState>('engine_stop_external', { port: port ?? null });
  },

  /** Every running Splash server found through its port lock. */
  discover(): Promise<ExternalServer[]> {
    if (!isTauri()) return Promise.resolve([]);
    return invoke<ExternalServer[]>('engine_discover');
  },

  /** Read (no patch) or change the supervisor settings. */
  configure(patch?: SupervisorSettingsPatch): Promise<SupervisorSettings> {
    if (!isTauri()) {
      return patch ? unavailable() : Promise.resolve(DEFAULT_SUPERVISOR_SETTINGS);
    }
    return invoke<SupervisorSettings>('engine_configure', { patch: patch ?? null });
  },

  onState(handler: (state: EngineState) => void): Promise<UnlistenFn> {
    if (!isTauri()) return Promise.resolve(() => undefined);
    return listen<EngineState>(ENGINE_STATE_EVENT, (event) => handler(event.payload));
  },

  onLog(handler: (line: LogLine) => void): Promise<UnlistenFn> {
    if (!isTauri()) return Promise.resolve(() => undefined);
    return listen<LogLine>(ENGINE_LOG_EVENT, (event) => handler(event.payload));
  },

  /** Where the transport sends requests (Tauri), or the dev proxy (browser). */
  getConfig(): Promise<TransportConfig> {
    if (!isTauri()) {
      return Promise.resolve({ port: 8000, baseUrl: '/splash', hasApiKey: false });
    }
    return invoke<TransportConfig>('splash_config_get');
  },

  /** Point the transport at another port / API key (e.g. an external server). */
  setConfig(patch: TransportConfigPatch): Promise<TransportConfig> {
    if (!isTauri()) return unavailable();
    return invoke<TransportConfig>('splash_config_set', { patch });
  },
};
