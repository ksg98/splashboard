import type { EngineState, ModelFormat, ModelRowData } from './types';

/** The format word on a row's third line ("20.4 GB · 4-bit · Splash package"). */
export const FORMAT_WORD: Record<ModelFormat, string> = {
  splash: 'Splash package',
  mlx: 'MLX',
};

/** The format as one phrase (running card, labels): "Splash package", "MLX 4-bit". */
export function formatPhrase(format: ModelFormat, quant = '4-bit'): string {
  return format === 'splash' ? 'Splash package' : `MLX ${quant}`;
}

/** "Qwen3.8-27B (MLX 4-bit)" */
export function modelTitle(model: { name: string; variant?: string }): string {
  return model.variant ? `${model.name} (${model.variant})` : model.name;
}

export interface EngineWord {
  label: string;
  tone: 'ok' | 'busy' | 'warn' | 'error' | 'off';
  pulse: boolean;
}

/** One vocabulary for the engine: Ready, Thinking, Starting…, Stopped. */
export const ENGINE_WORD: Record<EngineState, EngineWord> = {
  ready: { label: 'Ready', tone: 'ok', pulse: false },
  busy: { label: 'Thinking', tone: 'busy', pulse: true },
  starting: { label: 'Starting…', tone: 'warn', pulse: false },
  stopped: { label: 'Stopped', tone: 'off', pulse: false },
};

/** The chosen version of a multi-version row, if any. */
export function chosenVersion(model: ModelRowData) {
  if (!model.versions || model.versions.length === 0) return undefined;
  return model.versions.find((v) => v.id === model.version) ?? model.versions[0];
}
