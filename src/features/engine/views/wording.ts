/**
 * Wording and number formatting for the engine views. Plain English only:
 * memory in GB (never pages), concurrency as "1 of 4 at once" (never lanes).
 */
import type { ActivityStatus, EngineTone, LogLine, MemoryPressure } from './types';

const LOCALE = 'en-US';

export const DASH = '—';

/** 92.4 → "92"; 1840 → "1,840". */
export function wholeNumber(value: number): string {
  if (!Number.isFinite(value)) return DASH;
  return Math.round(value).toLocaleString(LOCALE);
}

/** 31.42 → "31.4"; 48 → "48". */
export function oneDecimal(value: number): string {
  if (!Number.isFinite(value)) return DASH;
  return value.toLocaleString(LOCALE, { maximumFractionDigits: 1 });
}

/** 0.874 → "87". */
export function percentNumber(ratio: number): string {
  if (!Number.isFinite(ratio)) return DASH;
  return String(Math.round(ratio * 100));
}

/** 0.42 → "0.42 s"; 1.93 → "1.9 s"; 12.4 → "12 s". */
export function seconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  if (value < 1) return `${value.toFixed(2)} s`;
  if (value < 10) return `${value.toFixed(1)} s`;
  return `${Math.round(value)} s`;
}

/** 5.5, 16 → "5.5 of 16 GB". */
export function gbOf(used: number, total: number): string {
  return `${oneDecimal(used)} of ${oneDecimal(total)} GB`;
}

/** 131072 → "128K"; Splash writes context sizes in units of 1,024 tokens. */
export function contextLength(tokens: number): string {
  if (!Number.isFinite(tokens)) return DASH;
  if (tokens >= 1024 && tokens % 1024 === 0) return `${tokens / 1024}K`;
  return wholeNumber(tokens);
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString(LOCALE)} ${count === 1 ? one : many}`;
}

export const PRECISION_LABEL = {
  int8: 'Compact (8-bit)',
  bf16: 'Full (16-bit)',
} as const;

export const PRESSURE: Record<MemoryPressure, { label: string; tone: EngineTone }> = {
  normal: { label: 'Normal', tone: 'ok' },
  warning: { label: 'High', tone: 'warn' },
  critical: { label: 'Critical', tone: 'error' },
};

/** The one engine vocabulary: Ready, Thinking, Starting…, Stopped. */
export function stateLabel(status: ActivityStatus): { label: string; tone: EngineTone } {
  switch (status.kind) {
    case 'ready':
    case 'idle':
      return { label: 'Ready', tone: 'ok' };
    case 'busy':
      return { label: 'Thinking', tone: 'busy' };
    case 'starting':
      return { label: 'Starting…', tone: 'warn' };
    case 'stopped':
      return { label: 'Stopped', tone: 'off' };
    case 'failed':
      return { label: 'Couldn’t start', tone: 'error' };
  }
}

/** True while the server runs (Ready, Thinking, weights released). */
export function isLive(status: ActivityStatus): boolean {
  return status.kind === 'ready' || status.kind === 'busy' || status.kind === 'idle';
}

/** Lines as they are copied or saved: "09:12:01  Loading · …". */
export function logText(lines: readonly LogLine[]): string {
  return lines.map((line) => `${line.time}  ${line.text}`).join('\n');
}

/** Chart scale: 0 to the next multiple of 40 above the data, at least 120. */
export function chartMax(values: readonly (number | null)[]): number {
  let max = 0;
  for (const value of values) if (value !== null && value > max) max = value;
  return Math.max(120, Math.ceil((max * 1.1) / 40) * 40);
}
