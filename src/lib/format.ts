/**
 * Number, byte, token and duration formatters for telemetry and chat UI.
 * All output uses the en-US locale so screenshots and tests are stable.
 */

const LOCALE = 'en-US';

/** 1234.5 -> "1,234.5"; `maximumFractionDigits` defaults to 1. */
export function formatNumber(value: number, maximumFractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(LOCALE, { maximumFractionDigits });
}

/** 1_234_567 -> "1.2M"; 950 -> "950". */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(LOCALE, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** 0.8734 -> "87.3%". */
export function formatPercent(ratio: number, fractionDigits = 1): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(fractionDigits)}%`;
}

export interface FormatBytesOptions {
  /** Default 1. Whole bytes never get decimals. */
  decimals?: number;
  /**
   * "binary" (default): 1024-based with KB/MB/GB labels, as macOS shows
   * memory and as Splash sizes ("28G") are meant. "iec": 1024-based with
   * KiB/MiB/GiB. "si": 1000-based with kB/MB/GB.
   */
  standard?: 'binary' | 'iec' | 'si';
}

const UNITS = {
  binary: ['B', 'KB', 'MB', 'GB', 'TB', 'PB'],
  iec: ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'],
  si: ['B', 'kB', 'MB', 'GB', 'TB', 'PB'],
} as const;

/** 68719476736 -> "64 GB"; 1536 -> "1.5 KB". */
export function formatBytes(bytes: number, options: FormatBytesOptions = {}): string {
  if (!Number.isFinite(bytes)) return '—';
  const { decimals = 1, standard = 'binary' } = options;
  const base = standard === 'si' ? 1000 : 1024;
  const units = UNITS[standard];
  const sign = bytes < 0 ? '-' : '';
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= base && unit < units.length - 1) {
    value /= base;
    unit++;
  }
  const digits = unit === 0 ? 0 : decimals;
  const rounded = Number(value.toFixed(digits));
  return `${sign}${rounded.toLocaleString(LOCALE, { maximumFractionDigits: digits })} ${units[unit]}`;
}

/**
 * Token counts the way Splash writes context sizes (K = 1024 tokens):
 * 262144 -> "256K", 131072 -> "128K", 1500 -> "1,500".
 */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens)) return '—';
  if (tokens >= 1024 && tokens % 1024 === 0) return `${tokens / 1024}K`;
  return formatNumber(tokens, 0);
}

/** 42.345 -> "42.3 tok/s". */
export function formatTokensPerSecond(rate: number): string {
  if (!Number.isFinite(rate)) return '—';
  return `${rate.toFixed(rate >= 100 ? 0 : 1)} tok/s`;
}

/**
 * Durations from milliseconds: 0.42 -> "0.42 ms", 850 -> "850 ms",
 * 1234 -> "1.2 s", 185000 -> "3m 05s", 3720000 -> "1h 02m".
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const sign = ms < 0 ? '-' : '';
  const abs = Math.abs(ms);
  if (abs < 1) return `${sign}${abs.toFixed(2)} ms`;
  if (abs < 1000) return `${sign}${Math.round(abs)} ms`;
  if (abs < 60_000) return `${sign}${(abs / 1000).toFixed(1)} s`;
  const totalSeconds = Math.round(abs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${sign}${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${sign}${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** Wall-clock time for logs: epoch ms -> "14:03:27". */
export function formatClockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(LOCALE, { hour12: false });
}
