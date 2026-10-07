/*
 * Demo data for the overlay primitives' gallery entries and tests. Plain
 * values only (no icons or callbacks), so tests can import it too.
 * Models are Splash packages and MLX 4-bit builds Splash can run.
 */

export type ThinkingLevel = 'none' | 'low' | 'medium' | 'high';

export const thinkingOptions: { value: ThinkingLevel; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'Answer right away, no thinking' },
  { value: 'low', label: 'Low', description: 'Think briefly' },
  { value: 'medium', label: 'Medium', description: 'Balanced' },
  { value: 'high', label: 'High', description: 'Think longest, for hard problems' },
];

export const thinkingPillLabel: Record<ThinkingLevel, string> = {
  none: 'Thinking off',
  low: 'Low thinking',
  medium: 'Medium thinking',
  high: 'High thinking',
};

export type VersionId = 'mlx-community' | 'lmstudio-community';

/** The downloadable versions of Qwen3.8-27B besides the installed Splash package. */
export const versionOptions: { value: VersionId; label: string; description: string }[] = [
  {
    value: 'mlx-community',
    label: 'MLX 4-bit',
    description: 'mlx-community · 15.6 GB · a plain conversion',
  },
  {
    value: 'lmstudio-community',
    label: 'MLX 4-bit (LM Studio)',
    description: 'lmstudio-community · 15.6 GB',
  },
];

export const versionRepos: Record<VersionId, string> = {
  'mlx-community': 'mlx-community/Qwen3.8-27B-4bit',
  'lmstudio-community': 'lmstudio-community/Qwen3.8-27B-MLX-4bit',
};

export type PresetId = 'recommended' | 'defaults' | 'custom';

export const presetOptions: { value: PresetId; label: string; description: string }[] = [
  {
    value: 'recommended',
    label: 'Recommended for this Mac (64 GB)',
    description: 'A 32 GB SSD cache keeps long prompts ready across restarts',
  },
  {
    value: 'defaults',
    label: 'Splash defaults',
    description: 'Only the model and port; Splash picks the rest',
  },
  { value: 'custom', label: 'Custom', description: 'Your own values below' },
];

export type ModelId = 'qwen3.8-27b' | 'qwen3.6-35b-a3b' | 'qwen3.8-27b-mlx';

/** The title pop-up: installed models, each with a unique title (version rule). */
export const installedModels: { id: ModelId; name: string; detail: string }[] = [
  { id: 'qwen3.8-27b', name: 'Qwen3.8-27B', detail: 'Splash package · Ready' },
  { id: 'qwen3.6-35b-a3b', name: 'Qwen3.6-35B-A3B', detail: 'Splash package' },
  { id: 'qwen3.8-27b-mlx', name: 'Qwen3.8-27B (MLX 4-bit)', detail: 'mlx-community · 15.6 GB' },
];

export const engineSample = {
  model: 'Qwen3.8-27B',
  repo: 'incoai/Qwen3.8-27B-Splash',
  version: 'Splash 1.2.0',
  address: '127.0.0.1:8000',
  speed: 92,
  acceptance: { kept: 5.6, of: 7 },
  memory: { used: 31.4, total: 48 },
  context: '128K',
};
