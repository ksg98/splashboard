import { describe, expect, it } from 'vitest';
import {
  CatalogError,
  getCatalog,
  isSecretEntry,
  parseCatalog,
  requestEntry,
  serveEntriesForServe,
  serveEntry,
} from './catalog';
import { CONTROL_KINDS } from './types';
import docsText from '../../../docs/splash-params.json?raw';

describe('catalog loader', () => {
  it('loads the bundled docs/splash-params.json unchanged', () => {
    const onDisk: unknown = JSON.parse(docsText);
    expect(getCatalog()).toEqual(onDisk);
  });

  it('exposes every serve and request entry by key', () => {
    const catalog = getCatalog();
    expect(catalog.version).toBe('1.3.0');
    expect(catalog.serve.length).toBeGreaterThan(30);
    expect(serveEntry('max_memory')?.flag).toBe('--max-memory');
    expect(serveEntry('hf_token')?.env).toBe('HF_TOKEN');
    expect(requestEntry('top_p')?.field).toBe('top_p');
    expect(serveEntry('nope')).toBeUndefined();
  });

  it('knows every control kind the catalog uses', () => {
    const catalog = getCatalog();
    expect([...catalog.conventions.control].sort()).toEqual([...CONTROL_KINDS].sort());
    for (const e of [...catalog.serve, ...catalog.request]) {
      expect(CONTROL_KINDS).toContain(e.control);
    }
  });

  it('marks secrets and serve-only entries', () => {
    const keys = serveEntriesForServe().map((e) => e.key);
    expect(keys).toContain('api_key');
    expect(keys).not.toContain('hf_disable_progress_bars');
    expect(isSecretEntry(serveEntry('api_key')!)).toBe(true);
    expect(isSecretEntry(serveEntry('hf_token')!)).toBe(true);
    expect(isSecretEntry(serveEntry('port')!)).toBe(false);
  });

  it('rejects a malformed catalog', () => {
    expect(() => parseCatalog(null)).toThrow(CatalogError);
    const broken = structuredClone(getCatalog()) as unknown as {
      serve: Array<Record<string, unknown>>;
    };
    broken.serve[0]!.section = 'nowhere';
    expect(() => parseCatalog(broken)).toThrow(/unknown section/);
    const dup = structuredClone(getCatalog());
    dup.serve.push(dup.serve[0]!);
    expect(() => parseCatalog(dup)).toThrow(/repeats key/);
  });
});
