/**
 * Request-side catalog data for the chat request builder (owned by api-core).
 * Plain data and functions only: this module must not import chat code.
 */
import { getCatalog } from './catalog';
import type {
  Catalog,
  Choice,
  ControlKind,
  RequestEntry,
  RequestValues,
  Validation,
} from './types';
import { isPlaceholder, valuesEqual } from './values';
import { summarize, type Issue, type ValidationResult } from './validate';
import { unavailableReason, versionAtLeast } from './version';

export interface ModelCapabilities {
  /** false when the server runs text only (--language-only or a text model). */
  vision?: boolean;
  /** Loaded model id (selects per-model reasoning choices). */
  modelId?: string | null;
}

export interface RequestFieldInfo {
  key: string;
  /** Wire field (Chat Completions spelling). */
  field: string;
  label: string;
  section: string;
  control: ControlKind;
  type: string;
  help: string;
  default: unknown;
  min: number | null;
  max: number | null;
  step: number | null;
  unit: string | null;
  /** Narrowed per model where the catalog says so (reasoning effort). */
  choices: Choice[] | null;
  multiple: boolean;
  available: boolean;
  disabledReason: string | null;
  /** Set by Splashboard, never shown (stream, include_usage, return_progress). */
  internal: boolean;
  /** Value the UI always sends for internal fields. */
  uiValue: unknown;
  endpointMap: Record<string, string | null>;
  validation: Validation;
}

const TOP_K_DISABLE_VERSION = '1.2.0';

function reasoningChoices(
  entry: RequestEntry,
  modelId: string | null | undefined,
): Choice[] | null {
  const perModel = entry.validation.per_model_ui;
  if (!entry.choices || !perModel || !modelId) return entry.choices;
  const family = Object.keys(perModel).find((name) =>
    modelId.toLowerCase().includes(name.toLowerCase()),
  );
  if (!family) return entry.choices;
  const allowed = perModel[family] ?? [];
  const out: Choice[] = [];
  for (const item of allowed) {
    if (item.startsWith('<unset')) {
      out.push({ value: null, label: 'On' });
      continue;
    }
    const choice = entry.choices.find((c) => c.value === item);
    if (choice)
      out.push(
        item === 'none' && allowed.some((a) => a.startsWith('<unset'))
          ? { value: 'none', label: 'Off' }
          : choice,
      );
  }
  return out;
}

/** Request fields with availability for this Splash version and model. */
export function requestFieldsFor(
  version: string | null,
  caps: ModelCapabilities = {},
  catalog: Catalog = getCatalog(),
): RequestFieldInfo[] {
  return catalog.request.map((entry) => {
    let reason = unavailableReason(entry, version);
    if (!reason && entry.validation.requires_server?.vision === true && caps.vision === false) {
      reason = 'This model is running text only (no vision).';
    }
    let min = entry.min;
    if (entry.key === 'top_k' && !versionAtLeast(version, TOP_K_DISABLE_VERSION)) min = 1;
    return {
      key: entry.key,
      field: entry.field,
      label: entry.label,
      section: entry.section,
      control: entry.control,
      type: entry.type,
      help: entry.help,
      default: entry.default,
      min,
      max: entry.max,
      step: entry.step,
      unit: entry.unit,
      choices:
        entry.key === 'reasoning_effort' ? reasoningChoices(entry, caps.modelId) : entry.choices,
      multiple: entry.multiple,
      available: reason === null,
      disabledReason: reason,
      internal: entry.control === 'internal',
      uiValue: entry.validation.ui_value,
      endpointMap: entry.endpoint_map,
      validation: entry.validation,
    };
  });
}

/**
 * Default request values from the catalog (null defaults and placeholders
 * such as "<loaded model ID>" left out; internal fields at their UI value).
 */
export function defaultsFromCatalog(catalog: Catalog = getCatalog()): RequestValues {
  const out: RequestValues = {};
  for (const entry of catalog.request) {
    const value =
      entry.control === 'internal' && entry.validation.ui_value !== undefined
        ? entry.validation.ui_value
        : entry.default;
    if (value === null || value === undefined || isPlaceholder(value)) continue;
    out[entry.key] = structuredClone(value);
  }
  return out;
}

/** defaultsFromCatalog limited to the fields this version and model accept. */
export function requestDefaultsFor(
  version: string | null,
  caps: ModelCapabilities = {},
  catalog: Catalog = getCatalog(),
): RequestValues {
  const available = new Set(
    requestFieldsFor(version, caps, catalog)
      .filter((f) => f.available)
      .map((f) => f.key),
  );
  const defaults = defaultsFromCatalog(catalog);
  return Object.fromEntries(Object.entries(defaults).filter(([key]) => available.has(key)));
}

function isActive(key: string, value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (key === 'response_format') return !valuesEqual(value, { type: 'text' });
  return true;
}

/** Plain-English checks of chat request values (bounds, version gates, conflicts). */
export function validateRequestValues(
  values: RequestValues,
  catalog: Catalog = getCatalog(),
  ctx: { version?: string | null } & ModelCapabilities = {},
): ValidationResult {
  const version = ctx.version === undefined ? catalog.version : ctx.version;
  const issues: Issue[] = [];
  const err = (key: string, code: Issue['code'], message: string, minVersion?: string) =>
    issues.push({ key, level: 'error', code, message, ...(minVersion ? { minVersion } : {}) });
  const fields = new Map(requestFieldsFor(version, ctx, catalog).map((f) => [f.key, f]));

  for (const [key, value] of Object.entries(values)) {
    const field = fields.get(key);
    if (!field) {
      err(
        key,
        'unknown_key',
        `"${key}" is not a request setting this version of Splashboard knows.`,
      );
      continue;
    }
    if (value === undefined || value === null) continue;
    const v = field.validation;
    if (!field.available && !valuesEqual(value, field.default) && isActive(key, value)) {
      const needed = versionAtLeast(
        version,
        catalog.request.find((e) => e.key === key)?.min_version,
      );
      err(
        key,
        needed ? 'requires' : 'version',
        `${field.label}: ${field.disabledReason ?? 'not available.'}`,
      );
      continue;
    }
    if (typeof value === 'number') {
      if (
        !Number.isFinite(value) ||
        ((v.integer || field.type === 'integer') && !Number.isInteger(value))
      ) {
        err(
          key,
          'invalid',
          `${field.label} must be a ${field.type === 'integer' ? 'whole number' : 'number'}.`,
        );
        continue;
      }
      const min = v.min ?? field.min;
      const max = v.max ?? (field.type === 'integer' ? null : field.max);
      if (v.exclusive_min !== undefined && value <= v.exclusive_min) {
        err(key, 'range', `${field.label} must be more than ${v.exclusive_min}.`);
      } else if (key === 'top_k' && value < 1 && !versionAtLeast(version, TOP_K_DISABLE_VERSION)) {
        err(
          key,
          'version',
          `Top K of 0 or -1 (off) needs Splash 1.2.0 or newer; use 1 or more.`,
          TOP_K_DISABLE_VERSION,
        );
      } else if (
        (min !== null && min !== undefined && value < min) ||
        (max !== null && max !== undefined && value > max)
      ) {
        err(key, 'range', `${field.label} must be from ${min ?? '-∞'} to ${max ?? '∞'}.`);
      }
    }
    if (key === 'stop' && Array.isArray(value)) {
      if (value.length > (v.max_items ?? 4))
        err(key, 'range', `Use at most ${v.max_items ?? 4} stop sequences.`);
      if (value.some((s) => typeof s !== 'string' || s === ''))
        err(key, 'invalid', 'Stop sequences must not be empty.');
    }
    if (key === 'chat_template_kwargs') {
      if (typeof value !== 'object' || Array.isArray(value)) {
        err(key, 'invalid', 'Template variables must be a JSON object.');
      } else {
        const reserved = (v.reserved_keys ?? []).filter(
          (k) => k in (value as Record<string, unknown>),
        );
        if (reserved.length)
          err(key, 'invalid', `Template variables cannot set ${reserved.join(', ')}.`);
      }
    }
  }

  // Conflicts: stop / ignore_eos cannot combine with tools or a response format.
  for (const key of ['stop', 'ignore_eos']) {
    if (!isActive(key, values[key])) continue;
    const conflicts = (fields.get(key)?.validation.conflicts ?? []).map(
      (c) => c.split(' ')[0] ?? c,
    );
    const hit = conflicts.find((other) => isActive(other, values[other]));
    if (hit) {
      err(
        key,
        'conflict',
        `${fields.get(key)?.label} cannot be combined with ${fields.get(hit)?.label?.toLowerCase() ?? hit}.`,
      );
    }
  }
  const toolChoice = values.tool_choice;
  const tools = Array.isArray(values.tools)
    ? (values.tools as Array<{ function?: { name?: string } }>)
    : [];
  if (toolChoice === 'required' && tools.length === 0) {
    err('tool_choice', 'requires', 'Add a tool before requiring one.');
  } else if (typeof toolChoice === 'object' && toolChoice !== null) {
    const name = (toolChoice as { function?: { name?: string } }).function?.name;
    if (!tools.some((t) => t.function?.name === name)) {
      err('tool_choice', 'requires', `There is no tool named "${name ?? ''}".`);
    }
  }
  return summarize(issues);
}
