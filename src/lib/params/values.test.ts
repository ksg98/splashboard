import { describe, expect, it } from 'vitest';
import { serveEntry } from './catalog';
import {
  GiB,
  MiB,
  conditionMet,
  effectiveServeValue,
  formatBytes,
  formatServeValue,
  formatSizeCli,
  formatTokensCli,
  isDefaultServeValue,
  isPlaceholder,
  normalizeServeValue,
  parseSize,
  parseTokens,
  serveDefaults,
  splitCommaList,
} from './values';

const e = (key: string) => serveEntry(key)!;

describe('sizes', () => {
  it('parses Splash size syntax (1024-based)', () => {
    expect(parseSize('32G', GiB, true)).toEqual({ kind: 'bytes', bytes: 32 * GiB });
    expect(parseSize('512m', GiB, true)).toEqual({ kind: 'bytes', bytes: 512 * MiB });
    expect(parseSize('64GiB', GiB, false)).toEqual({ kind: 'bytes', bytes: 64 * GiB });
    expect(parseSize('2kb', GiB, false)).toEqual({ kind: 'bytes', bytes: 2048 });
    expect(parseSize('1073741824', GiB, false)).toEqual({ kind: 'bytes', bytes: GiB });
    expect(parseSize('AUTO', GiB, true)).toEqual({ kind: 'auto' });
    expect(parseSize('auto', GiB, false)).toEqual({ kind: 'invalid' });
    expect(parseSize('1.5G', GiB, true)).toEqual({ kind: 'invalid' });
    expect(parseSize(-1, GiB, true)).toEqual({ kind: 'invalid' });
    expect(parseSize(1.5, GiB, true)).toEqual({ kind: 'bytes', bytes: 1.5 * GiB });
  });

  it('formats the canonical CLI spelling', () => {
    expect(formatSizeCli(0)).toBe('0');
    expect(formatSizeCli(40 * GiB)).toBe('40G');
    expect(formatSizeCli(1536 * MiB)).toBe('1536M');
    expect(formatSizeCli(3 * 1024)).toBe('3K');
    expect(formatSizeCli(1000)).toBe('1000');
    expect(formatBytes(1.5 * GiB)).toBe('1.5 GiB');
    expect(formatBytes(12)).toBe('12 bytes');
  });
});

describe('tokens', () => {
  it('parses and formats context lengths', () => {
    expect(parseTokens('256K')).toEqual({ kind: 'tokens', tokens: 262144 });
    expect(parseTokens('100k')).toEqual({ kind: 'tokens', tokens: 102400 });
    expect(parseTokens(100000)).toEqual({ kind: 'tokens', tokens: 100000 });
    expect(parseTokens('Auto')).toEqual({ kind: 'auto' });
    expect(parseTokens('12.5K')).toEqual({ kind: 'invalid' });
    expect(formatTokensCli(131072)).toBe('128K');
    expect(formatTokensCli(100000)).toBe('100000');
  });
});

describe('normalisation and defaults', () => {
  it('normalises by type', () => {
    expect(normalizeServeValue(e('max_memory'), 28)).toEqual({ ok: true, value: '28G' });
    expect(normalizeServeValue(e('max_request_size'), 256)).toEqual({ ok: true, value: '256M' });
    expect(normalizeServeValue(e('max_context'), '64k')).toEqual({ ok: true, value: '64K' });
    expect(normalizeServeValue(e('queue_size'), '64')).toEqual({ ok: true, value: 64 });
    expect(normalizeServeValue(e('queue_size'), 1.5)).toEqual({ ok: false });
    expect(normalizeServeValue(e('offline'), 'yes')).toEqual({ ok: false });
    expect(normalizeServeValue(e('allowed_host'), [' a.local ', ''])).toEqual({
      ok: true,
      value: ['a.local'],
    });
    expect(normalizeServeValue(e('no_proxy'), 'a, b,,a')).toEqual({ ok: true, value: 'a,b' });
    expect(normalizeServeValue(e('host'), '  ')).toEqual({ ok: true, value: null });
  });

  it('compares with defaults after normalisation', () => {
    expect(isDefaultServeValue(e('max_cache_disk'), 0)).toBe(true);
    expect(isDefaultServeValue(e('max_cache_disk'), '0G')).toBe(true);
    expect(isDefaultServeValue(e('max_request_size'), '131072K')).toBe(true);
    expect(isDefaultServeValue(e('max_memory'), 'Auto')).toBe(true);
    expect(isDefaultServeValue(e('max_memory'), '32G')).toBe(false);
    expect(isDefaultServeValue(e('allowed_origin'), [])).toBe(true);
    expect(isDefaultServeValue(e('persistent_cache'), undefined)).toBe(true);
    expect(effectiveServeValue(e('max_memory'), 'nonsense')).toBe('auto');
  });

  it('builds serve defaults for every visible entry', () => {
    const defaults = serveDefaults();
    expect(defaults.port).toBe(8000);
    expect(defaults.max_memory).toBe('auto');
    expect(defaults.allowed_host).toEqual([]);
    expect(defaults.language_only).toBe(false);
    expect('hf_disable_progress_bars' in defaults).toBe(false);
  });

  it('evaluates requires conditions', () => {
    expect(conditionMet('> 0', e('max_cache_disk'), '1G')).toBe(true);
    expect(conditionMet('> 0', e('max_cache_disk'), '0')).toBe(false);
    expect(conditionMet('non_empty', e('served_model_name'), [])).toBe(false);
    expect(conditionMet('non_empty', e('served_model_name'), ['x'])).toBe(true);
    expect(conditionMet(true, e('persistent_cache'), true)).toBe(true);
    expect(conditionMet(true, e('persistent_cache'), false)).toBe(false);
  });

  it('formats values for people', () => {
    expect(formatServeValue(e('max_memory'), undefined)).toBe('Auto');
    expect(formatServeValue(e('max_memory'), '32G')).toBe('32 GiB');
    expect(formatServeValue(e('max_cache_disk'), '0')).toBe('Off');
    expect(formatServeValue(e('max_context'), '256K')).toBe('262,144 tokens');
    expect(formatServeValue(e('kv_format'), 'bf16')).toBe('BF16 (full precision, ~2x KV memory)');
    expect(formatServeValue(e('host'), '0.0.0.0')).toBe('All networks (LAN)');
    expect(formatServeValue(e('request_timeout'), null)).toBe('No limit');
    expect(formatServeValue(e('api_key'), 'abc')).toBe('••••');
    expect(formatServeValue(e('offline'), true)).toBe('On');
    expect(formatServeValue(e('queue_size'), 64)).toBe('64 requests');
    expect(formatServeValue(e('decode_share'), 0.25)).toBe('0.25');
  });

  it('spots placeholders and comma lists', () => {
    expect(isPlaceholder('<generate>')).toBe(true);
    expect(isPlaceholder(['<LocalHostName>.local'])).toBe(true);
    expect(isPlaceholder('0.0.0.0')).toBe(false);
    expect(splitCommaList(' a , b,,a ')).toEqual(['a', 'b']);
  });
});
