/**
 * Typed loader for docs/splash-params.json. The JSON is imported directly
 * from docs/ (no copy to keep in sync); `parseCatalog` checks its shape once
 * so the rest of the code can trust the types.
 */
import rawCatalog from '../../../docs/splash-params.json';
import {
  CONTROL_KINDS,
  type Catalog,
  type ControlKind,
  type RequestEntry,
  type Section,
  type ServeEntry,
} from './types';

export class CatalogError extends Error {
  override name = 'CatalogError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new CatalogError(`splash-params.json: ${message}`);
}

const VISIBILITIES = new Set(['basic', 'advanced', 'internal']);
const PASS_AS = new Set(['argv', 'env']);

function checkEntry(
  entry: unknown,
  where: string,
  sections: Set<string>,
  controls: Set<string>,
): Record<string, unknown> {
  if (!isRecord(entry)) fail(`${where} is not an object`);
  const key = entry.key;
  if (typeof key !== 'string' || key === '') fail(`${where} has no key`);
  const at = `${where} (${key})`;
  if (typeof entry.label !== 'string') fail(`${at} has no label`);
  if (typeof entry.section !== 'string' || !sections.has(entry.section)) {
    fail(`${at} names unknown section ${String(entry.section)}`);
  }
  if (typeof entry.control !== 'string' || !controls.has(entry.control)) {
    fail(`${at} uses unknown control ${String(entry.control)}`);
  }
  if (typeof entry.min_version !== 'string') fail(`${at} has no min_version`);
  if (!isRecord(entry.validation)) fail(`${at} has no validation object`);
  if (typeof entry.restart_required !== 'boolean') fail(`${at} has no restart_required`);
  return entry;
}

/** Validates the parsed JSON and returns it typed. Throws CatalogError on a malformed file. */
export function parseCatalog(json: unknown): Catalog {
  if (!isRecord(json)) fail('top level is not an object');
  if (typeof json.version !== 'string') fail('missing version');
  if (!isRecord(json.conventions) || !Array.isArray(json.conventions.control)) {
    fail('missing conventions.control');
  }
  const controls = new Set<string>(json.conventions.control as string[]);
  for (const kind of CONTROL_KINDS) {
    if (!controls.has(kind)) fail(`conventions.control lacks ${kind}`);
  }
  for (const kind of controls) {
    if (!(CONTROL_KINDS as readonly string[]).includes(kind)) {
      fail(`conventions.control has ${kind}, which Splashboard does not know; update types.ts`);
    }
  }
  for (const list of ['sections', 'serve', 'request_sections', 'request', 'presets'] as const) {
    if (!Array.isArray(json[list])) fail(`missing ${list}[]`);
  }
  const serveSections = new Set((json.sections as Section[]).map((s) => s.id));
  const requestSections = new Set((json.request_sections as Section[]).map((s) => s.id));

  const seen = new Set<string>();
  (json.serve as unknown[]).forEach((raw, i) => {
    const entry = checkEntry(raw, `serve[${i}]`, serveSections, controls);
    const key = entry.key as string;
    if (seen.has(key)) fail(`serve[] repeats key ${key}`);
    seen.add(key);
    if (!VISIBILITIES.has(entry.visibility as string)) fail(`serve key ${key} has bad visibility`);
    if (!PASS_AS.has(entry.pass_as as string)) fail(`serve key ${key} has bad pass_as`);
    if (entry.flag === null && typeof entry.env !== 'string') {
      fail(`serve key ${key} has neither a flag nor an env var`);
    }
    if (!Array.isArray(entry.applies_to)) fail(`serve key ${key} has no applies_to`);
  });
  seen.clear();
  (json.request as unknown[]).forEach((raw, i) => {
    const entry = checkEntry(raw, `request[${i}]`, requestSections, controls);
    const key = entry.key as string;
    if (seen.has(key)) fail(`request[] repeats key ${key}`);
    seen.add(key);
  });
  return json as unknown as Catalog;
}

let cached: Catalog | null = null;

/** The catalog bundled with this build (docs/splash-params.json). */
export function getCatalog(): Catalog {
  cached ??= parseCatalog(rawCatalog as unknown);
  return cached;
}

const serveIndex = new WeakMap<Catalog, Map<string, ServeEntry>>();
const requestIndex = new WeakMap<Catalog, Map<string, RequestEntry>>();

function indexOf<T extends { key: string }>(
  cache: WeakMap<Catalog, Map<string, T>>,
  catalog: Catalog,
  list: T[],
): Map<string, T> {
  let map = cache.get(catalog);
  if (!map) {
    map = new Map(list.map((e) => [e.key, e]));
    cache.set(catalog, map);
  }
  return map;
}

export function serveEntry(key: string, catalog: Catalog = getCatalog()): ServeEntry | undefined {
  return indexOf(serveIndex, catalog, catalog.serve).get(key);
}

export function requestEntry(
  key: string,
  catalog: Catalog = getCatalog(),
): RequestEntry | undefined {
  return indexOf(requestIndex, catalog, catalog.request).get(key);
}

/** Serve entries that configure `splash serve` (not download-only knobs). */
export function serveEntriesForServe(catalog: Catalog = getCatalog()): ServeEntry[] {
  return catalog.serve.filter((e) => e.applies_to.includes('serve'));
}

/** Keys whose value is a secret: never on argv, never in ServeRequest.flags. */
export const SECRET_ENV: Readonly<Record<string, 'SPLASH_API_KEY' | 'HF_TOKEN'>> = {
  api_key: 'SPLASH_API_KEY',
  hf_token: 'HF_TOKEN',
};

export function isSecretEntry(entry: { control: ControlKind; key: string }): boolean {
  return (
    entry.control === 'secret' || entry.control === 'secret+generate' || entry.key in SECRET_ENV
  );
}

/** Default value of a serve or request field, as written in the catalog. */
export function defaultOf(entry: { default: unknown }): unknown {
  return entry.default;
}
