import { describe, expect, it } from 'vitest';
import * as fixtures from './fixtures';
import {
  formatModelMeta,
  formatProgressSize,
  formatSize,
  formatSpeed,
  formatTimeLeft,
  sentenceTimeLeft,
} from './format';

describe('first-run fixtures', () => {
  it('offer only Splash packages and MLX 4-bit models, never GGUF', () => {
    expect(JSON.stringify(fixtures)).not.toMatch(/gguf/i);
    for (const model of fixtures.DEMO_MODELS) {
      expect(['Splash package', 'MLX']).toContain(model.format);
      expect(model.quant).toBe('4-bit');
      expect(model.id).not.toContain(':');
    }
    expect(fixtures.DEMO_MODELS.filter((model) => model.recommended)).toEqual([fixtures.QWEN_27B]);
  });
});

describe('first-run formatting', () => {
  it('formats sizes in decimal units', () => {
    expect(formatSize(17_600_000_000)).toBe('17.6 GB');
    expect(formatSize(418_000_000)).toBe('418 MB');
    expect(formatProgressSize(214_000_000, 418_000_000)).toBe('214 of 418 MB');
    expect(formatProgressSize(8_600_000_000, 17_600_000_000)).toBe('8.6 of 17.6 GB');
    expect(formatSpeed(52_000_000)).toBe('52 MB/s');
    expect(formatSpeed(1_500_000)).toBe('1.5 MB/s');
  });

  it('rounds time left so it does not flicker', () => {
    expect(formatTimeLeft(4)).toBe('a few seconds');
    expect(formatTimeLeft(28)).toBe('about 30 seconds');
    expect(formatTimeLeft(173)).toBe('about 3 min');
    expect(formatTimeLeft(4000)).toBe('about 1 hr 7 min');
    expect(sentenceTimeLeft(28)).toBe('About 30 seconds left');
  });

  it('writes the model meta line', () => {
    expect(formatModelMeta(fixtures.QWEN_27B)).toBe('17.6 GB · 4-bit · Splash package');
    expect(formatModelMeta(fixtures.QWEN_27B_MLX)).toBe('15.6 GB · 4-bit · MLX');
  });
});
