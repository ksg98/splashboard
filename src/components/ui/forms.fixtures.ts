/*
 * Demo values for the form primitives' gallery (forms.gallery.tsx).
 * Names and flags follow docs/splash-params.json; the Mac is a MacBook Pro,
 * M3 Max, 64 GB running Splash 1.2.0 at 127.0.0.1:8000.
 */

export const sheetSubtitle = 'Qwen3.8-27B · incoai/Qwen3.8-27B-Splash';

export type PresetId = 'recommended' | 'coding' | 'custom';
export const presetOptions: { value: PresetId; label: string; description?: string }[] = [
  {
    value: 'recommended',
    label: 'Recommended for this Mac (64 GB)',
    description: '128K context, 32 GB SSD cache',
  },
  { value: 'coding', label: 'Coding agents', description: 'Longest context, prompts kept on SSD' },
  { value: 'custom', label: 'Custom' },
];
export const presetFootnote =
  'Qwen3.8-27B with a 32 GB SSD cache that keeps coding agents’ long prompts ready across restarts.';

export type ModelId = 'qwen38-27b' | 'qwen36-35b-a3b' | 'qwen38-27b-mlx';
export const modelOptions: { value: ModelId; label: string; description: string }[] = [
  { value: 'qwen38-27b', label: 'Qwen3.8-27B', description: 'incoai/Qwen3.8-27B-Splash' },
  {
    value: 'qwen36-35b-a3b',
    label: 'Qwen3.6-35B-A3B',
    description: 'incoai/Qwen3.6-35B-A3B-Splash',
  },
  {
    value: 'qwen38-27b-mlx',
    label: 'Qwen3.8-27B (MLX 4-bit)',
    description: 'mlx-community/Qwen3.8-27B-4bit',
  },
];

export type DraftId = 'auto' | 'off';
export const draftOptions: { value: DraftId; label: string; description?: string }[] = [
  { value: 'auto', label: 'Automatic', description: 'The draft model that ships with the package' },
  { value: 'off', label: 'Off', description: 'Slower; for comparing speed only' },
];
export const draftHelp =
  'Proposes 7 tokens at a time for the main model to check, which is where most of the speed comes from.';

export type ThinkingId = 'default' | 'none' | 'low' | 'medium' | 'high';
export const thinkingOptions: { value: ThinkingId; label: string; description?: string }[] = [
  { value: 'default', label: 'Model default' },
  { value: 'none', label: 'None', description: 'Answer right away' },
  { value: 'low', label: 'Low', description: 'Think briefly' },
  { value: 'medium', label: 'Medium', description: 'Think it through' },
  { value: 'high', label: 'High', description: 'Think longest, for hard problems' },
];

export type MemoryLimitId = 'auto' | '40' | '32';
export const memoryLimitOptions: { value: MemoryLimitId; label: string }[] = [
  { value: 'auto', label: 'Automatic (48 GB)' },
  { value: '40', label: '40 GB' },
  { value: '32', label: '32 GB' },
];
export const memoryFootnote =
  'Automatic uses as much memory as macOS considers safe for the GPU. Context stops at 256K, the most this Mac has measured. Coding agents need about 100K.';

export type KvFormat = 'int8' | 'bf16';
/** Plain-English labels for --kv-format (int8 | bf16), per the reviewer's fix. */
export const kvOptions: { value: KvFormat; label: string }[] = [
  { value: 'int8', label: 'Compact (8-bit)' },
  { value: 'bf16', label: 'Full (16-bit)' },
];
export const cacheFootnote =
  'Working memory holds the conversation the model is reading (the KV cache). Compact fits about twice the context of Full. The SSD cache keeps long prompts ready when memory runs short; it doesn’t raise the context limit, and it writes to your SSD.';

export type ListenId = '127.0.0.1' | '0.0.0.0';
export const listenOptions: { value: ListenId; label: string; description: string }[] = [
  { value: '127.0.0.1', label: 'This Mac only', description: '127.0.0.1' },
  { value: '0.0.0.0', label: 'All networks', description: 'Other devices can connect' },
];
export const maskedApiKey = 'sk-splash-••••••••7f3a';
export const networkFootnote =
  'Agents launched from Splashboard use this port and key automatically. Keep the API key on before listening on all networks.';

export type TimeLimitId = 'none' | '300' | '1800';
export const timeLimitOptions: { value: TimeLimitId; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: '300', label: '5 minutes' },
  { value: '1800', label: '30 minutes' },
];

/** --decode-share in five steps, named for VoiceOver; the slider shows its named ends. */
export const replyShareSteps = [
  'Long prompt first',
  'Mostly long prompt',
  'Balanced (default)',
  'Mostly replies',
  'Replies first',
] as const;

export type RevisionId = 'latest' | 'pinned';
export const revisionOptions: { value: RevisionId; label: string; description?: string }[] = [
  { value: 'latest', label: 'Latest', description: 'main' },
  { value: 'pinned', label: 'Pinned commit', description: '4f1c2a9' },
];

export const serveCommand = `splash serve \\
  --model=incoai/Qwen3.8-27B-Splash \\
  --port=8000 \\
  --max-context=128K \\
  --max-cache-disk=32G \\
  --persistent-cache \\
  --allowed-origin=tauri://localhost \\
  --served-model-name=local-qwen`;
export const commandFootnote =
  'Exactly what Splashboard runs. Besides the model and port, only settings that differ from Splash’s defaults are listed. The API key and Hugging Face token are passed in the environment, never on the command line.';

export type AppearanceId = 'system' | 'light' | 'dark';
export const appearanceOptions: { value: AppearanceId; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export const hfTokenSample = 'hf_kVq3TzP8mWb1yXcR4nLd7sJa2';

/** "128K" for 131072 tokens; context is set in 8K steps from 8K to 256K. */
export function formatContext(k: number): string {
  return `${k}K`;
}

export function formatGigabytes(gb: number): string {
  return gb === 0 ? 'Off' : `${gb} GB`;
}

export function formatMegapixels(mp: number): string {
  return `${mp.toFixed(1)} MP`;
}

export function formatSampling(value: number): string {
  return value.toFixed(2);
}
