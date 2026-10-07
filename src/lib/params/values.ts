/**
 * Value normalisation for serve fields: sizes ("32G"), context ("256K"),
 * lists and numbers, so that equal settings compare equal however they were
 * typed ("40960M" == 40 GiB slider == "40G").
 */
import { getCatalog, isSecretEntry, serveEntry } from './catalog';
import type { Catalog, ParamValue, RequiresCondition, ServeEntry, ServeValues } from './types';

export const KiB = 1024;
export const MiB = 1024 * KiB;
export const GiB = 1024 * MiB;

/** Bytes per unit for numeric slider values. */
export function unitBytes(unit: string | null): number {
  if (unit === 'GiB') return GiB;
  if (unit === 'MiB') return MiB;
  if (unit === 'KiB') return KiB;
  return 1;
}

export type SizeParse = { kind: 'auto' } | { kind: 'bytes'; bytes: number } | { kind: 'invalid' };

const SIZE_RE = /^(\d+)(?:([KkMmGg])(?:[Ii]?[Bb])?)?$/;
const SIZE_SCALE: Record<string, number> = { k: KiB, m: MiB, g: GiB };

/**
 * Splash size syntax ("auto", "32G", "512m", "64GiB", "1073741824") or a
 * number in `numberUnitBytes` units (a slider value in GiB, say).
 */
export function parseSize(value: unknown, numberUnitBytes: number, allowAuto: boolean): SizeParse {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return { kind: 'invalid' };
    return { kind: 'bytes', bytes: Math.round(value * numberUnitBytes) };
  }
  if (typeof value !== 'string') return { kind: 'invalid' };
  const text = value.trim();
  if (allowAuto && text.toLowerCase() === 'auto') return { kind: 'auto' };
  const match = SIZE_RE.exec(text);
  if (!match) return { kind: 'invalid' };
  const scale = match[2] ? (SIZE_SCALE[match[2].toLowerCase()] ?? 1) : 1;
  return { kind: 'bytes', bytes: Number(match[1]) * scale };
}

/** Canonical CLI spelling: the largest of G/M/K that divides the byte count exactly. */
export function formatSizeCli(bytes: number): string {
  if (bytes === 0) return '0';
  if (bytes % GiB === 0) return `${bytes / GiB}G`;
  if (bytes % MiB === 0) return `${bytes / MiB}M`;
  if (bytes % KiB === 0) return `${bytes / KiB}K`;
  return String(bytes);
}

/** "32 GiB", "512 MiB", "1.5 GiB" for people. */
export function formatBytes(bytes: number): string {
  const units: Array<[number, string]> = [
    [GiB, 'GiB'],
    [MiB, 'MiB'],
    [KiB, 'KiB'],
  ];
  for (const [size, name] of units) {
    if (bytes >= size) {
      const n = bytes / size;
      return `${Number.isInteger(n) ? n : n.toFixed(1)} ${name}`;
    }
  }
  return `${bytes} bytes`;
}

export type TokensParse =
  { kind: 'auto' } | { kind: 'tokens'; tokens: number } | { kind: 'invalid' };

const TOKENS_RE = /^(\d+)([Kk]?)$/;

/** "auto", "256K" (K = 1024), "100000" or a number of tokens. */
export function parseTokens(value: unknown): TokensParse {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0
      ? { kind: 'tokens', tokens: value }
      : { kind: 'invalid' };
  }
  if (typeof value !== 'string') return { kind: 'invalid' };
  const text = value.trim();
  if (text.toLowerCase() === 'auto') return { kind: 'auto' };
  const match = TOKENS_RE.exec(text);
  if (!match) return { kind: 'invalid' };
  return { kind: 'tokens', tokens: Number(match[1]) * (match[2] ? 1024 : 1) };
}

/** NK when divisible by 1024, else the plain count. */
export function formatTokensCli(tokens: number): string {
  return tokens !== 0 && tokens % 1024 === 0 ? `${tokens / 1024}K` : String(tokens);
}

/** Splits a comma list ("a, b,,a") into trimmed, de-duplicated items. */
export function splitCommaList(value: string): string[] {
  const out: string[] = [];
  for (const item of value.split(',')) {
    const trimmed = item.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

export type Normalized = { ok: true; value: ParamValue } | { ok: false };

/** undefined, null and blank strings mean "not set": the default applies. */
export function isUnset(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/**
 * Canonical form of a serve value: sizes and context in CLI spelling, numbers
 * as numbers, lists trimmed. Unset values normalise to null.
 */
export function normalizeServeValue(entry: ServeEntry, value: unknown): Normalized {
  if (isUnset(value)) return { ok: true, value: null };
  if (entry.multiple) {
    const items = Array.isArray(value) ? value : [value];
    const out: string[] = [];
    for (const item of items) {
      if (typeof item !== 'string') return { ok: false };
      const trimmed = item.trim();
      if (trimmed) out.push(trimmed);
    }
    return { ok: true, value: out };
  }
  switch (entry.type) {
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
    case 'integer': {
      const n = toNumber(value);
      return n !== null && Number.isInteger(n) ? { ok: true, value: n } : { ok: false };
    }
    case 'number': {
      const n = toNumber(value);
      return n !== null ? { ok: true, value: n } : { ok: false };
    }
    case 'size': {
      const allowAuto = entry.default === 'auto';
      const parsed = parseSize(value, unitBytes(entry.unit), allowAuto);
      if (parsed.kind === 'auto') return { ok: true, value: 'auto' };
      if (parsed.kind === 'bytes') return { ok: true, value: formatSizeCli(parsed.bytes) };
      return { ok: false };
    }
    case 'tokens': {
      const parsed = parseTokens(value);
      if (parsed.kind === 'auto') return { ok: true, value: 'auto' };
      if (parsed.kind === 'tokens') return { ok: true, value: formatTokensCli(parsed.tokens) };
      return { ok: false };
    }
    default: {
      if (typeof value !== 'string') return { ok: false };
      if (entry.validation.must_include)
        return { ok: true, value: splitCommaList(value).join(',') };
      return { ok: true, value: value.trim() };
    }
  }
}

/** Bytes of a size value, or null for auto/unset/invalid. */
export function sizeBytes(entry: ServeEntry, value: unknown): number | null {
  const parsed = parseSize(value, unitBytes(entry.unit), entry.default === 'auto');
  return parsed.kind === 'bytes' ? parsed.bytes : null;
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => valuesEqual(item, b[i]));
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

/** Normalised default of a serve entry ([] for lists, null when there is none). */
export function normalizedDefault(entry: ServeEntry): ParamValue {
  const normalized = normalizeServeValue(entry, entry.default);
  const value = normalized.ok ? normalized.value : null;
  if (value === null && entry.multiple) return [];
  if (value === null && entry.type === 'boolean') return false;
  return value;
}

/** Normalised effective value: the given value, or the default when unset or invalid. */
export function effectiveServeValue(entry: ServeEntry, value: unknown): ParamValue {
  const normalized = normalizeServeValue(entry, value);
  if (!normalized.ok || normalized.value === null) return normalizedDefault(entry);
  return normalized.value;
}

/** True when the value is unset or equal to the default after normalisation. */
export function isDefaultServeValue(entry: ServeEntry, value: unknown): boolean {
  if (isUnset(value)) return true;
  const normalized = normalizeServeValue(entry, value);
  if (!normalized.ok) return false;
  return valuesEqual(normalized.value, normalizedDefault(entry));
}

/** Catalog defaults for every serve entry (lists as [], booleans as false). */
export function serveDefaults(catalog: Catalog = getCatalog()): ServeValues {
  const out: ServeValues = {};
  for (const entry of catalog.serve) {
    if (entry.visibility === 'internal') continue;
    out[entry.key] = normalizedDefault(entry);
  }
  return out;
}

/** Whether `condition` holds for the other field's normalised effective value. */
export function conditionMet(
  condition: RequiresCondition,
  other: ServeEntry | undefined,
  otherValue: ParamValue,
): boolean {
  if (condition === true || condition === false) return otherValue === condition;
  const text = condition.trim();
  if (text.startsWith('non_empty')) {
    if (Array.isArray(otherValue)) return otherValue.length > 0;
    return typeof otherValue === 'string' ? otherValue.trim() !== '' : otherValue !== null;
  }
  const compare = /^>\s*(-?\d+(?:\.\d+)?)$/.exec(text);
  if (compare) {
    const threshold = Number(compare[1]);
    if (other?.type === 'size') return (sizeBytes(other, otherValue) ?? 0) > threshold;
    return typeof otherValue === 'number' && otherValue > threshold;
  }
  return valuesEqual(otherValue, condition);
}

/** Plain-English reason a `requires` condition is unmet. */
export function requiresReason(condition: RequiresCondition, other: { label: string }): string {
  if (condition === true) return `Turn on "${other.label}" first.`;
  if (condition === false) return `Turn off "${other.label}" first.`;
  if (condition.startsWith('non_empty')) return `Add at least one entry to "${other.label}" first.`;
  if (/^>\s*0$/.test(condition.trim())) return `Set "${other.label}" above 0 first.`;
  return `Needs "${other.label}" to be ${condition}.`;
}

const PLACEHOLDER_RE = /<[^>]+>/;

/** Catalog placeholders such as "<generate>" or "<LocalHostName>.local". */
export function isPlaceholder(value: unknown): boolean {
  if (typeof value === 'string') return PLACEHOLDER_RE.test(value);
  if (Array.isArray(value)) return value.some(isPlaceholder);
  return false;
}

function choiceLabel(
  entry: { choices: Array<{ value: unknown; label: string }> | null },
  value: unknown,
) {
  return entry.choices?.find((c) => valuesEqual(c.value, value))?.label;
}

/** Human-readable value for change lists and summaries. */
export function formatServeValue(entry: ServeEntry, value: unknown): string {
  if (isSecretEntry(entry)) return isUnset(value) ? 'Not set' : '••••';
  const v = effectiveServeValue(entry, value);
  const label = choiceLabel(entry, v);
  if (label) return label;
  if (v === null) {
    if (entry.control === 'number+none') return 'No limit';
    if (entry.control === 'number+random') return 'Random';
    return 'Not set';
  }
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'None';
  if (v === 'auto') return 'Auto';
  if (entry.type === 'size') {
    const bytes = sizeBytes(entry, v) ?? 0;
    return bytes === 0 && entry.control === 'slider+off' ? 'Off' : formatBytes(bytes);
  }
  if (entry.type === 'tokens') {
    const parsed = parseTokens(v);
    return parsed.kind === 'tokens' ? `${parsed.tokens.toLocaleString('en-US')} tokens` : String(v);
  }
  if (typeof v === 'number') {
    const n = v.toLocaleString('en-US', { maximumFractionDigits: 6 });
    return entry.unit && entry.unit !== 'ratio' ? `${n} ${entry.unit}` : n;
  }
  return v;
}

/** Looks up a serve entry and formats a value with it (unknown keys are stringified). */
export function formatServeValueByKey(
  key: string,
  value: unknown,
  catalog: Catalog = getCatalog(),
): string {
  const entry = serveEntry(key, catalog);
  return entry ? formatServeValue(entry, value) : JSON.stringify(value ?? null);
}
