import type { SamplingPreset, SamplingValues } from './types';

const KEYS: (keyof SamplingValues)[] = [
  'temperature',
  'topP',
  'topK',
  'minP',
  'presencePenalty',
  'frequencyPenalty',
  'repetitionPenalty',
];

/** The preset whose seven values all equal these, if any. */
export function matchPreset(
  presets: readonly SamplingPreset[],
  values: SamplingValues,
): SamplingPreset | undefined {
  return presets.find((preset) =>
    KEYS.every((key) => Math.abs(preset.values[key] - values[key]) < 1e-9),
  );
}

/** "Temperature 1.00 · Top P 0.95 · Top K 20" for the preset row's help line. */
export function summarizeSampling(values: SamplingValues): string {
  const topK = values.topK <= 0 ? 'Top K off' : `Top K ${values.topK}`;
  return `Temperature ${values.temperature.toFixed(2)} · Top P ${values.topP.toFixed(2)} · ${topK}`;
}
