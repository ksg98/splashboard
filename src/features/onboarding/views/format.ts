/**
 * Formatting for first-run progress lines. Sizes use decimal units (1 GB =
 * 10^9 bytes), as Hugging Face and Finder report downloads. Output is en-US
 * so screenshots and tests are stable.
 */

const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'] as const;

function unitFor(bytes: number): number {
  let unit = 0;
  let value = Math.abs(bytes);
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  return unit;
}

function scaled(bytes: number, unit: number): string {
  const value = bytes / 1000 ** unit;
  // MB and below are whole numbers ("214 MB"); GB and up keep one decimal ("17.6 GB").
  const digits = unit >= 3 ? 1 : 0;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 17_600_000_000 -> "17.6 GB"; 418_000_000 -> "418 MB". */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const unit = unitFor(bytes);
  return `${scaled(bytes, unit)} ${UNITS[unit]}`;
}

/** Both numbers in the total's unit: "214 of 418 MB", "8.6 of 17.6 GB". */
export function formatProgressSize(received: number, total: number): string {
  if (!Number.isFinite(received) || !Number.isFinite(total) || total <= 0) return '—';
  const unit = unitFor(total);
  return `${scaled(Math.min(received, total), unit)} of ${scaled(total, unit)} ${UNITS[unit]}`;
}

/** Bytes per second as a transfer speed: "48 MB/s". */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—';
  const unit = Math.max(1, unitFor(bytesPerSecond));
  const value = bytesPerSecond / 1000 ** unit;
  const digits = value < 10 && unit >= 2 ? 1 : 0;
  return `${value.toLocaleString('en-US', { maximumFractionDigits: digits })} ${UNITS[unit]}/s`;
}

/**
 * Time left the way macOS says it, rounded so it doesn't flicker:
 * 28 -> "about 30 seconds", 170 -> "about 3 min", 4000 -> "about 1 hr 7 min".
 */
export function formatTimeLeft(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 10) return 'a few seconds';
  if (seconds < 60) return `about ${Math.max(10, Math.round(seconds / 10) * 10)} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `about ${hours} hr` : `about ${hours} hr ${rest} min`;
}

/** "About 30 seconds left" as a sentence. */
export function sentenceTimeLeft(seconds: number): string {
  const text = formatTimeLeft(seconds);
  if (text === '—') return '';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} left`;
}

/** "17.6 GB · 4-bit · Splash package" */
export function formatModelMeta(model: {
  sizeBytes: number;
  quant: string;
  format: string;
}): string {
  return [formatSize(model.sizeBytes), model.quant, model.format].join(' · ');
}
