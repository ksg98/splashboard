/**
 * Demo props for the app shell gallery (src/app/layout/shell.gallery.tsx).
 * Values follow design/minimal-ref: a MacBook Pro M3 Max with 64 GB running
 * the Qwen3.8-27B Splash package on 127.0.0.1:8000.
 */
import type { ShellEngineState } from './ShellPlaceholders';

export interface DemoHistoryGroup {
  label: string;
  items: { id: string; title: string }[];
}

export const demoHistory: DemoHistoryGroup[] = [
  {
    label: 'Today',
    items: [
      { id: 'c-ttft', title: 'Time to first token in Python' },
      { id: 'c-compare', title: 'Compare 27B and 35B-A3B' },
      { id: 'c-backoff', title: 'Status poller backoff' },
    ],
  },
  {
    label: 'Previous 7 days',
    items: [
      { id: 'c-pty', title: 'PTY bridge for coding agents' },
      { id: 'c-notes', title: 'Summarize the Splash 1.2 notes' },
      { id: 'c-context', title: 'Context length for coding agents' },
      { id: 'c-regex', title: 'Regex for Splash log lines' },
      { id: 'c-sidebar', title: 'Sidebar animation timing' },
      { id: 'c-models', title: 'Plan the Models screen' },
    ],
  },
];

export const demoModel = 'Qwen3.8-27B';

export const demoEngineStates = {
  ready: { label: 'Ready', tone: 'ok' },
  thinking: { label: 'Thinking', tone: 'busy' },
  starting: { label: 'Starting…', tone: 'warn' },
  stopped: { label: 'Stopped', tone: 'off' },
} as const satisfies Record<string, ShellEngineState>;

/** The models the demo title pop-up lists: Splash packages and MLX 4-bit only. */
export const demoModels = [
  { id: 'incoai/Qwen3.8-27B-Splash', name: 'Qwen3.8-27B', detail: 'Splash package · Ready' },
  { id: 'incoai/Qwen3.6-35B-A3B-Splash', name: 'Qwen3.6-35B-A3B', detail: 'Splash package' },
  { id: 'mlx-community/Qwen3.8-27B-4bit', name: 'Qwen3.8-27B (MLX 4-bit)', detail: 'MLX 4-bit' },
] as const;
