import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatCompact,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTokenCount,
  formatTokensPerSecond,
} from './format';

describe('format', () => {
  it('formats numbers', () => {
    expect(formatNumber(1234.56)).toBe('1,234.6');
    expect(formatNumber(1234.56, 0)).toBe('1,235');
    expect(formatNumber(Number.NaN)).toBe('—');
    expect(formatCompact(1_234_567)).toBe('1.2M');
    expect(formatCompact(950)).toBe('950');
    expect(formatPercent(0.8734)).toBe('87.3%');
  });

  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(68719476736)).toBe('64 GB');
    expect(formatBytes(15159640064)).toBe('14.1 GB');
    expect(formatBytes(15159640064, { standard: 'iec', decimals: 2 })).toBe('14.12 GiB');
    expect(formatBytes(1_500_000, { standard: 'si' })).toBe('1.5 MB');
    expect(formatBytes(-2048)).toBe('-2 KB');
  });

  it('formats tokens like Splash (K = 1024)', () => {
    expect(formatTokenCount(262144)).toBe('256K');
    expect(formatTokenCount(131072)).toBe('128K');
    expect(formatTokenCount(1500)).toBe('1,500');
    expect(formatTokensPerSecond(42.345)).toBe('42.3 tok/s');
    expect(formatTokensPerSecond(123.6)).toBe('124 tok/s');
  });

  it('formats durations', () => {
    expect(formatDuration(0.42)).toBe('0.42 ms');
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(1234)).toBe('1.2 s');
    expect(formatDuration(185_000)).toBe('3m 05s');
    expect(formatDuration(3_720_000)).toBe('1h 02m');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
