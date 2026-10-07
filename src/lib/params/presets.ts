/**
 * Presets from the catalog: RAM tiers for this Mac, one-click recipes and
 * sampling presets; applying one to form values; and the "changed settings"
 * list (old -> new, restart or not) the UI shows before applying.
 */
import { getCatalog, isSecretEntry, requestEntry } from './catalog';
import { parseModelId } from './state';
import type { Catalog, ParamValue, Preset, PresetKind, RequestValues, ServeValues } from './types';
import {
  GiB,
  effectiveServeValue,
  formatServeValue,
  isDefaultServeValue,
  isPlaceholder,
  isUnset,
  valuesEqual,
} from './values';
import { serveEntry } from './catalog';
import { compareVersions, versionAtLeast } from './version';

export interface PresetOption {
  preset: Preset;
  available: boolean;
  /** Oldest Splash that can apply every value in the preset. */
  minVersion: string | null;
  disabledReason: string | null;
}

export interface MacPresets {
  /** This Mac's RAM, rounded to whole GB. */
  ramGb: number | null;
  /** The preset tier used: the nearest tier at or below ramGb. */
  tierGb: number | null;
  /** Under the smallest tier (24 GB): Splash does not document support. */
  belowMinimum: boolean;
  ram: PresetOption[];
  recipes: PresetOption[];
  sampling: PresetOption[];
}

export function ramGbFromBytes(bytes: number): number {
  return Math.round(bytes / GiB);
}

/** RAM tiers the catalog has presets for, ascending. */
export function ramTiers(catalog: Catalog = getCatalog()): number[] {
  const tiers = new Set<number>();
  for (const p of catalog.presets) if (p.kind === 'ram' && p.ram_gb !== null) tiers.add(p.ram_gb);
  return [...tiers].sort((a, b) => a - b);
}

/** Nearest tier at or below `ramGb`; below the smallest tier, the smallest (flagged). */
export function ramTierFor(
  ramGb: number,
  catalog: Catalog = getCatalog(),
): { tierGb: number | null; belowMinimum: boolean } {
  const tiers = ramTiers(catalog);
  const lower = tiers.filter((t) => t <= ramGb);
  if (lower.length) return { tierGb: lower[lower.length - 1] ?? null, belowMinimum: false };
  return { tierGb: tiers[0] ?? null, belowMinimum: tiers.length > 0 };
}

function maxVersion(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return compareVersions(a, b) >= 0 ? a : b;
}

/** Oldest Splash that accepts every value the preset sets. */
export function presetMinVersion(preset: Preset, catalog: Catalog = getCatalog()): string | null {
  let min = preset.min_version;
  for (const [key, value] of Object.entries(preset.serve)) {
    const entry = serveEntry(key, catalog);
    if (!entry || isPlaceholder(value) || isDefaultServeValue(entry, value)) continue;
    min = maxVersion(min, entry.min_version);
    if (key === 'model' && typeof value === 'string') {
      const id = parseModelId(value);
      if (id.kind === 'repo' && (!id.legacy || id.variant)) min = maxVersion(min, '1.1.0');
    }
  }
  for (const [key, value] of Object.entries(preset.request ?? {})) {
    const entry = requestEntry(key, catalog);
    if (!entry || valuesEqual(value, entry.default)) continue;
    min = maxVersion(min, entry.min_version);
  }
  return min;
}

export function presetOption(
  preset: Preset,
  version: string | null | undefined,
  catalog: Catalog = getCatalog(),
): PresetOption {
  const minVersion = presetMinVersion(preset, catalog);
  const available = versionAtLeast(version, minVersion);
  return {
    preset,
    available,
    minVersion,
    disabledReason: available
      ? null
      : `Needs Splash ${minVersion} or newer (installed: ${version}).`,
  };
}

/** Presets of one kind (all kinds when omitted); RAM presets narrowed to this Mac's tier when ramBytes is given. */
export function listPresets(
  catalog: Catalog = getCatalog(),
  options: { kind?: PresetKind; ramBytes?: number | null; version?: string | null } = {},
): PresetOption[] {
  const version = options.version === undefined ? catalog.version : options.version;
  const tier = options.ramBytes
    ? ramTierFor(ramGbFromBytes(options.ramBytes), catalog).tierGb
    : null;
  return catalog.presets
    .filter((p) => !options.kind || p.kind === options.kind)
    .filter((p) => p.kind !== 'ram' || tier === null || p.ram_gb === tier)
    .map((p) => presetOption(p, version, catalog));
}

/** Everything the presets picker needs for this Mac. */
export function presetsForMac(
  ramBytes: number | null,
  version: string | null,
  catalog: Catalog = getCatalog(),
): MacPresets {
  const ramGb = ramBytes ? ramGbFromBytes(ramBytes) : null;
  const { tierGb, belowMinimum } =
    ramGb !== null ? ramTierFor(ramGb, catalog) : { tierGb: null, belowMinimum: false };
  return {
    ramGb,
    tierGb,
    belowMinimum,
    ram: listPresets(catalog, { kind: 'ram', ramBytes, version }),
    recipes: listPresets(catalog, { kind: 'recipe', version }),
    sampling: listPresets(catalog, { kind: 'sampling', version }),
  };
}

export interface PendingInput {
  key: string;
  label: string;
  /** e.g. "<generate>", "<LocalHostName>.local", "<chosen folder>". */
  placeholder: string;
}

export interface ApplyResult<V> {
  values: V;
  /** Placeholders the resolver could not fill: ask the user, then set these keys. */
  pending: PendingInput[];
}

/** Returns the value for a placeholder, or undefined to leave it pending. */
export type PlaceholderResolver = (key: string, placeholder: string) => string | undefined;

/** 32 random bytes, base64url without padding (validation.generate for the API key). */
export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Resolver for the catalog's placeholders from what the app knows. */
export function placeholderResolver(known: {
  localHostName?: string | null;
  chosenFolder?: string | null;
  generateApiKey?: () => string;
}): PlaceholderResolver {
  return (_key, placeholder) => {
    if (placeholder === '<generate>') return (known.generateApiKey ?? generateApiKey)();
    if (placeholder === '<chosen folder>') return known.chosenFolder ?? undefined;
    if (placeholder.includes('<LocalHostName>') && known.localHostName) {
      return placeholder.replaceAll('<LocalHostName>', known.localHostName.replace(/\.local$/, ''));
    }
    return undefined;
  };
}

/** Keys any preset of this kind sets: reset to defaults before applying a RAM or sampling preset. */
function profileKeys(kind: PresetKind, side: 'serve' | 'request', catalog: Catalog): Set<string> {
  const keys = new Set<string>();
  for (const p of catalog.presets) {
    if (p.kind !== kind) continue;
    for (const key of Object.keys((side === 'serve' ? p.serve : p.request) ?? {})) keys.add(key);
  }
  return keys;
}

function resolveValue(
  key: string,
  value: ParamValue,
  resolve: PlaceholderResolver | undefined,
): { ok: true; value: ParamValue } | { ok: false; placeholder: string } {
  if (!isPlaceholder(value)) return { ok: true, value: Array.isArray(value) ? [...value] : value };
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      if (!isPlaceholder(item)) {
        out.push(item);
        continue;
      }
      const resolved = resolve?.(key, item);
      if (resolved === undefined) return { ok: false, placeholder: item };
      out.push(resolved);
    }
    return { ok: true, value: out };
  }
  const placeholder = String(value);
  const resolved = resolve?.(key, placeholder);
  return resolved === undefined ? { ok: false, placeholder } : { ok: true, value: resolved };
}

/**
 * Applies a preset's serve values. RAM presets first reset every key any RAM
 * preset sets (model, text only, memory, context, caches) so nothing from a
 * previous tier leaks through; recipes only add their keys. Placeholders are
 * filled by `resolve` or returned in `pending` (the current value is kept).
 */
export function applyPreset(
  values: ServeValues,
  preset: Preset,
  catalog: Catalog = getCatalog(),
  options: { resolve?: PlaceholderResolver } = {},
): ApplyResult<ServeValues> {
  const next: ServeValues = { ...values };
  if (preset.kind === 'ram') {
    for (const key of profileKeys('ram', 'serve', catalog)) delete next[key];
    // A pinned revision or draft belongs to the old model.
    delete next.revision;
    delete next.draft_model;
  }
  const pending: PendingInput[] = [];
  for (const [key, value] of Object.entries(preset.serve)) {
    const resolved = resolveValue(key, value, options.resolve);
    if (resolved.ok) next[key] = resolved.value;
    else
      pending.push({
        key,
        label: serveEntry(key, catalog)?.label ?? key,
        placeholder: resolved.placeholder,
      });
  }
  return { values: next, pending };
}

/** Applies a preset's request values (sampling presets reset the other sampling keys first). */
export function applyRequestPreset(
  values: RequestValues,
  preset: Preset,
  catalog: Catalog = getCatalog(),
): ApplyResult<RequestValues> {
  const next: RequestValues = { ...values };
  if (preset.kind === 'sampling') {
    for (const key of profileKeys('sampling', 'request', catalog)) delete next[key];
  }
  for (const [key, value] of Object.entries(preset.request ?? {}))
    next[key] = structuredClone(value);
  return { values: next, pending: [] };
}

export interface SettingChange {
  key: string;
  label: string;
  section: string;
  from: unknown;
  to: unknown;
  fromText: string;
  toText: string;
  restartRequired: boolean;
}

export interface ChangeSet {
  changes: SettingChange[];
  /** True when any change needs a running server to restart. */
  restartRequired: boolean;
}

/** Changed serve settings (catalog order), compared after normalisation. */
export function diffServeValues(
  before: ServeValues,
  after: ServeValues,
  catalog: Catalog = getCatalog(),
): ChangeSet {
  const changes: SettingChange[] = [];
  for (const entry of catalog.serve) {
    if (entry.visibility === 'internal') continue;
    const a = before[entry.key];
    const b = after[entry.key];
    const same = isSecretEntry(entry)
      ? (isUnset(a) && isUnset(b)) || a === b
      : valuesEqual(effectiveServeValue(entry, a), effectiveServeValue(entry, b));
    if (same) continue;
    changes.push({
      key: entry.key,
      label: entry.label,
      section: entry.section,
      from: isSecretEntry(entry) ? null : effectiveServeValue(entry, a),
      to: isSecretEntry(entry) ? null : effectiveServeValue(entry, b),
      fromText: formatServeValue(entry, a),
      toText:
        isSecretEntry(entry) && !isUnset(b)
          ? isUnset(a)
            ? 'Set'
            : 'Changed'
          : formatServeValue(entry, b),
      restartRequired: entry.restart_required,
    });
  }
  return { changes, restartRequired: changes.some((c) => c.restartRequired) };
}

function requestText(
  entry: { choices: Array<{ value: unknown; label: string }> | null },
  value: unknown,
): string {
  const label = entry.choices?.find((c) => valuesEqual(c.value, value))?.label;
  if (label) return label;
  if (value === null || value === undefined) return 'Not set';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : 'None';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** Changed request settings; request fields never need a restart. */
export function diffRequestValues(
  before: RequestValues,
  after: RequestValues,
  catalog: Catalog = getCatalog(),
): ChangeSet {
  const changes: SettingChange[] = [];
  for (const entry of catalog.request) {
    const a = before[entry.key] === undefined ? entry.default : before[entry.key];
    const b = after[entry.key] === undefined ? entry.default : after[entry.key];
    if (valuesEqual(a, b)) continue;
    changes.push({
      key: entry.key,
      label: entry.label,
      section: entry.section,
      from: a,
      to: b,
      fromText: requestText(entry, a),
      toText: requestText(entry, b),
      restartRequired: entry.restart_required,
    });
  }
  return { changes, restartRequired: changes.some((c) => c.restartRequired) };
}

/** What applying a preset would change, for the confirmation sheet. */
export function previewPreset(
  serveValues: ServeValues,
  requestValues: RequestValues,
  preset: Preset,
  catalog: Catalog = getCatalog(),
  options: { resolve?: PlaceholderResolver } = {},
): { serve: ApplyResult<ServeValues>; request: ApplyResult<RequestValues>; changes: ChangeSet } {
  const serve = applyPreset(serveValues, preset, catalog, options);
  const request = preset.request
    ? applyRequestPreset(requestValues, preset, catalog)
    : { values: requestValues, pending: [] };
  const s = diffServeValues(serveValues, serve.values, catalog);
  const r = diffRequestValues(requestValues, request.values, catalog);
  const changes = [...s.changes, ...r.changes];
  return {
    serve,
    request,
    changes: { changes, restartRequired: s.restartRequired || r.restartRequired },
  };
}
