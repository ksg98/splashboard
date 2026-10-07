/**
 * Resolves form values against the catalog: normalised value, default-ness,
 * and whether each control is disabled (version, legacy package, requires,
 * disabled_when). Shared by validation, the serve request builder and the
 * form model so all three agree on what is sent.
 */
import { getCatalog, serveEntry } from './catalog';
import type { Catalog, ParamValue, ServeEntry, ServeValues } from './types';
import {
  conditionMet,
  isDefaultServeValue,
  normalizeServeValue,
  normalizedDefault,
  requiresReason,
} from './values';
import { isAvailable, unavailableReason } from './version';

export interface ModelId {
  kind: 'repo' | 'directory' | 'invalid';
  owner?: string;
  repo?: string;
  variant?: string;
  /** incoai/*-Splash runtime packages: no :VARIANT, revision, draft or text-only. */
  legacy: boolean;
}

/** Parses OWNER/REPO[:VARIANT] or an absolute directory. */
export function parseModelId(model: string): ModelId {
  const text = model.trim();
  if (text.startsWith('/')) return { kind: 'directory', legacy: false };
  const match = /^([^/:\s]+)\/([^/:\s]+)(?::([^/\s]+))?$/.exec(text);
  if (!match) return { kind: 'invalid', legacy: false };
  const [, owner = '', repo = '', variant] = match;
  return {
    kind: 'repo',
    owner,
    repo,
    variant,
    legacy: owner.toLowerCase() === 'incoai' && /-Splash$/i.test(repo),
  };
}

export interface FieldState {
  entry: ServeEntry;
  /** The value as given (undefined when absent). */
  raw: unknown;
  /** False when the value cannot be read as the field's type. */
  valid: boolean;
  /** Normalised effective value: the default when unset, invalid or dropped. */
  value: ParamValue;
  /** Normalised value as given (before dropping); null when unset or invalid. */
  given: ParamValue;
  isDefault: boolean;
  /** Why the control is disabled, or null. */
  disabledReason: string | null;
  /** Hide rather than grey out (disabled_when met, or a folder that needs a toggle on). */
  hidden: boolean;
  /** The installed Splash is too old for this field. A non-default value is an error, not dropped. */
  versionBlocked: boolean;
  /** Not sent: disabled by requires, disabled_when or a legacy model. */
  dropped: boolean;
}

export type ServeState = Map<string, FieldState>;

const LEGACY_REASON =
  'Inco Splash packages (incoai/…-Splash) do not support this; pick an upstream model to use it.';

/** Resolves every serve entry (catalog order) against `values`. */
export function resolveServeState(
  values: ServeValues,
  catalog: Catalog = getCatalog(),
  version: string | null = catalog.version,
): ServeState {
  const state: ServeState = new Map();
  for (const entry of catalog.serve) {
    const raw = values[entry.key];
    const normalized = normalizeServeValue(entry, raw);
    const given = normalized.ok ? normalized.value : null;
    const value = given === null ? normalizedDefault(entry) : given;
    state.set(entry.key, {
      entry,
      raw,
      valid: normalized.ok,
      value,
      given,
      isDefault: isDefaultServeValue(entry, raw),
      disabledReason: null,
      hidden: false,
      versionBlocked: false,
      dropped: false,
    });
  }

  const modelValue = state.get('model')?.value;
  const legacy = typeof modelValue === 'string' && parseModelId(modelValue).legacy;

  // Second pass in catalog order, so a dropped field counts as its default
  // for the fields after it (max_cache_disk -> persistent_cache -> cache_dir).
  for (const field of state.values()) {
    const { entry } = field;
    const v = entry.validation;
    if (!isAvailable(entry, version)) {
      field.versionBlocked = true;
      field.disabledReason = unavailableReason(entry, version);
      continue;
    }
    let reason: string | null = null;
    let hidden = false;
    if (legacy && v.not_for_legacy_packages) reason = LEGACY_REASON;
    for (const [otherKey, condition] of Object.entries(v.requires ?? {})) {
      if (reason) break;
      const other = state.get(otherKey);
      if (!other) continue;
      if (!conditionMet(condition, other.entry, other.value)) {
        reason = requiresReason(condition, other.entry);
        hidden = condition === true && entry.control === 'directory-picker';
      }
    }
    for (const [otherKey, when] of Object.entries(v.disabled_when ?? {})) {
      if (reason) break;
      const other = state.get(otherKey);
      if (other && other.value === when) {
        reason = `Not used while "${other.entry.label}" is ${when === true ? 'on' : String(when)}.`;
        hidden = true;
      }
    }
    if (reason) {
      field.disabledReason = reason;
      field.hidden = hidden;
      field.dropped = true;
      field.value = normalizedDefault(entry);
    }
  }
  return state;
}

/** The serve entry for `key`, throwing for unknown keys (programming errors). */
export function requireServeEntry(key: string, catalog: Catalog = getCatalog()): ServeEntry {
  const entry = serveEntry(key, catalog);
  if (!entry) throw new Error(`unknown serve key ${key}`);
  return entry;
}
