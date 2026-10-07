/**
 * What "Start" launches, and the engine words every screen shares.
 *
 * The chosen model, port and launch flags are app settings (persisted in
 * getStorage().settings under `launch`). Models > Launch settings edits them;
 * the chat's "Start now", the engine popover and first run all start through
 * `startEngine()` so they launch the same thing.
 */
import { create } from 'zustand';
import { buildServeRequest, type ServeRequest } from '@/lib/params/serve';
import type { ServeValues } from '@/lib/params/types';
import type { EngineState } from '@/lib/splash/engine';
import { useEngineStore } from '@/lib/splash/engine-store';
import { getStorage } from '@/lib/storage';

export const DEFAULT_MODEL = 'incoai/Qwen3.8-27B-Splash';
export const DEFAULT_PORT = 8000;

export interface LaunchConfig {
  model: string;
  port: number;
  /** Launch-settings values keyed by splash-params.json serve[].key (model and port included). */
  values: ServeValues;
}

const STORAGE_KEY = 'launch';

interface LaunchStore extends LaunchConfig {
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<LaunchConfig>) => void;
}

export const useLaunchStore = create<LaunchStore>()((set, get) => ({
  model: DEFAULT_MODEL,
  port: DEFAULT_PORT,
  values: {},
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const saved = await getStorage().settings.get<Partial<LaunchConfig>>(STORAGE_KEY);
      set({ ...sanitize(saved), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  update: (patch) => {
    set(patch);
    const { model, port, values } = get();
    void getStorage()
      .settings.set(STORAGE_KEY, { model, port, values })
      .catch(() => undefined);
  },
}));

function sanitize(saved: Partial<LaunchConfig> | undefined): Partial<LaunchConfig> {
  if (!saved || typeof saved !== 'object') return {};
  const out: Partial<LaunchConfig> = {};
  if (typeof saved.model === 'string' && saved.model) out.model = saved.model;
  if (typeof saved.port === 'number' && saved.port > 0 && saved.port < 65536) out.port = saved.port;
  if (saved.values && typeof saved.values === 'object' && !Array.isArray(saved.values)) {
    out.values = saved.values;
  }
  return out;
}

/** The ServeRequest for the saved launch settings; invalid saved values fall back to model + port. */
export function launchRequest(
  config: LaunchConfig = useLaunchStore.getState(),
  version: string | null = useEngineStore.getState().install?.version ?? null,
): ServeRequest {
  try {
    return buildServeRequest(
      { ...config.values, model: config.model, port: config.port },
      undefined,
      version ?? undefined,
    );
  } catch {
    return { model: config.model, port: config.port, flags: [] };
  }
}

/** Starts the configured model (or `model`, which then becomes the configured one). */
export async function startEngine(model?: string): Promise<EngineState | null> {
  const launch = useLaunchStore.getState();
  await launch.load();
  if (model && model !== useLaunchStore.getState().model) launch.update({ model });
  return useEngineStore.getState().start(launchRequest());
}

export async function restartEngine(): Promise<EngineState | null> {
  await useLaunchStore.getState().load();
  return useEngineStore.getState().restart(launchRequest());
}

/** "incoai/Qwen3.8-27B-Splash" → "Qwen3.8-27B"; "mlx-community/Qwen3.8-27B-4bit" → "Qwen3.8-27B (MLX 4-bit)". */
export function displayModelName(model: string | null | undefined): string {
  if (!model) return 'No model';
  const name = model.split('/').pop() ?? model;
  if (/-Splash$/i.test(name)) return name.replace(/-Splash$/i, '');
  const mlx = name.match(/^(.*?)(?:-MLX)?-4bit$/i);
  if (mlx?.[1]) return `${mlx[1]} (MLX 4-bit)`;
  return name;
}

export type EngineTone = 'ok' | 'busy' | 'warn' | 'error' | 'off';

export interface EngineWord {
  label: string;
  tone: EngineTone;
  /** The server answers requests (Ready, Thinking, Idle). */
  serving: boolean;
  /** Starting, loading, warming, restoring or recovering. */
  launching: boolean;
}

/** One engine state → the words and dot every screen shows. */
export function engineWord(state: Pick<EngineState, 'phase'> & Partial<EngineState>): EngineWord {
  switch (state.phase) {
    case 'ready':
      return { label: 'Ready', tone: 'ok', serving: true, launching: false };
    case 'busy':
      return { label: 'Thinking', tone: 'busy', serving: true, launching: false };
    case 'idle_released':
      return { label: 'Idle', tone: 'ok', serving: true, launching: false };
    case 'external': {
      const ready = 'ready' in state && state.ready === true;
      return ready
        ? { label: 'Ready', tone: 'ok', serving: true, launching: false }
        : { label: 'Starting…', tone: 'warn', serving: false, launching: true };
    }
    case 'starting':
      return { label: 'Starting…', tone: 'warn', serving: false, launching: true };
    case 'downloading':
      return { label: 'Downloading…', tone: 'warn', serving: false, launching: true };
    case 'loading_weights':
      return { label: 'Loading model…', tone: 'warn', serving: false, launching: true };
    case 'warming':
      return { label: 'Warming up…', tone: 'warn', serving: false, launching: true };
    case 'restoring':
      return { label: 'Waking up…', tone: 'warn', serving: true, launching: true };
    case 'recovering':
      return { label: 'Recovering…', tone: 'warn', serving: false, launching: true };
    case 'stopping':
      return { label: 'Stopping…', tone: 'warn', serving: false, launching: false };
    case 'failed':
      return { label: 'Failed', tone: 'error', serving: false, launching: false };
    case 'not_installed':
      return { label: 'Not installed', tone: 'off', serving: false, launching: false };
    default:
      return { label: 'Stopped', tone: 'off', serving: false, launching: false };
  }
}

/** The start phase in words, for "Starting… · Loading weights · 12 s". */
export function launchPhaseWord(phase: EngineState['phase']): string | undefined {
  switch (phase) {
    case 'starting':
      return 'Starting';
    case 'downloading':
      return 'Downloading';
    case 'loading_weights':
      return 'Loading weights';
    case 'warming':
      return 'Warming up';
    case 'restoring':
      return 'Reloading weights';
    case 'recovering':
      return 'Recovering';
    default:
      return undefined;
  }
}
