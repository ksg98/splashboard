import { describe, expect, it } from 'vitest';
import { serveEntry } from './catalog';
import { compareVersions, isAvailable, unavailableReason, versionAtLeast } from './version';

describe('compareVersions', () => {
  it.each([
    ['1.2.0', '1.2.0', 0],
    ['1.0', '1.0.0', 0],
    ['1.0.1', '1.0', 1],
    ['1.1.0', '1.2.0', -1],
    ['1.10.0', '1.9.9', 1],
    ['v1.2.0', '1.2.0', 0],
    ['1.2.0rc1', '1.2.0', -1],
    ['1.2.0.dev3', '1.2.0', -1],
    ['2', '1.99.99', 1],
  ])('%s vs %s', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
    expect(compareVersions(b, a)).toBe(-expected || 0);
  });
});

describe('version gating', () => {
  const persistent = serveEntry('persistent_cache')!;

  it('gates by min_version', () => {
    expect(isAvailable(persistent, '1.2.0')).toBe(true);
    expect(isAvailable(persistent, '1.1.0')).toBe(false);
    expect(isAvailable(serveEntry('model')!, '1.0')).toBe(true);
  });

  it('treats an unknown version as new enough', () => {
    expect(isAvailable(persistent, null)).toBe(true);
    expect(versionAtLeast(undefined, '9.9')).toBe(true);
    expect(versionAtLeast('1.0', null)).toBe(true);
  });

  it('explains why a control is disabled', () => {
    expect(unavailableReason(persistent, '1.1.0')).toBe(
      'Needs Splash 1.2.0 or newer (installed: 1.1.0).',
    );
    expect(unavailableReason(persistent, '1.2.0')).toBeNull();
  });
});
