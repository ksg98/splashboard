/**
 * Form schema: turns a catalog section plus current values into ordered
 * groups and rows with everything a control needs (kind, label, help,
 * bounds, value, disabled reason, issues), so the UI step only renders.
 */
import { getCatalog, isSecretEntry } from './catalog';
import { requestFieldsFor, validateRequestValues, type ModelCapabilities } from './request-fields';
import { resolveServeState } from './state';
import type {
  Catalog,
  Choice,
  ControlKind,
  RequestValues,
  ServeEntry,
  ServeValues,
  Visibility,
} from './types';
import {
  GiB,
  formatServeValue,
  isUnset,
  normalizedDefault,
  parseTokens,
  sizeBytes,
  unitBytes,
  valuesEqual,
} from './values';
import {
  gpuMemoryCapBytes,
  issuesFor,
  validateServeValues,
  type Issue,
  type ValidationContext,
} from './validate';

export type FormScope = 'serve' | 'request';

export interface FormBounds {
  min: number | null;
  max: number | null;
  step: number | null;
  /** Splash accepts values above min only (top_p > 0). */
  exclusiveMin: number | null;
  /** Slider end; free entry may go higher. */
  softMax: number | null;
  /** Runtime ceiling in the row's unit (GPU budget, measured context, free disk), when known. */
  dynamicMax: number | null;
  /** How the runtime ceiling is computed (catalog text). */
  dynamicMaxNote: string | null;
}

export interface FormRow {
  key: string;
  scope: FormScope;
  control: ControlKind;
  type: string;
  label: string;
  help: string;
  /** Short rule summary under the control (validation.summary). */
  footnote: string | null;
  /** Version history or other remarks (entry.notes). */
  note: string | null;
  unit: string | null;
  bounds: FormBounds;
  choices: Choice[] | null;
  multiple: boolean;
  /** Current value as stored (or the default when unset). */
  value: unknown;
  /** Value in the row's unit for sliders/number fields (GiB, tokens, ...); null for auto/unset/non-numeric. */
  numericValue: number | null;
  /** Human-readable current value. */
  display: string;
  defaultValue: unknown;
  isDefault: boolean;
  disabled: boolean;
  disabledReason: string | null;
  hidden: boolean;
  restartRequired: boolean;
  secret: boolean;
  /** `--flag` (serve) or null. */
  flag: string | null;
  /** Environment variable, when the field is passed (or also readable) as env. */
  env: string | null;
  issues: Issue[];
}

export interface FormGroup {
  id: Exclude<Visibility, 'internal'>;
  label: string;
  rows: FormRow[];
}

export interface FormModel {
  scope: FormScope;
  id: string;
  label: string;
  description: string | null;
  groups: FormGroup[];
}

export interface FormOptions {
  scope?: FormScope;
  catalog?: Catalog;
  /** Serve values (scope serve) or request values (scope request). */
  values?: ServeValues | RequestValues;
  /** Version and capacity facts; ctx.version defaults to the catalog's. */
  ctx?: ValidationContext;
  /** Request scope: the loaded model's capabilities. */
  caps?: ModelCapabilities;
}

const GROUP_LABEL: Record<FormGroup['id'], string> = { basic: 'Basic', advanced: 'Advanced' };

function numericOf(
  entry: { type: string; unit: string | null; default: unknown },
  value: unknown,
): number | null {
  if (entry.type === 'size') {
    const bytes = sizeBytes(entry as ServeEntry, value);
    return bytes === null ? null : bytes / unitBytes(entry.unit);
  }
  if (entry.type === 'tokens') {
    const parsed = parseTokens(value);
    return parsed.kind === 'tokens' ? parsed.tokens : null;
  }
  return typeof value === 'number' ? value : null;
}

function serveDynamicMax(entry: ServeEntry, ctx: ValidationContext): number | null {
  if (entry.key === 'max_memory') {
    if (ctx.gpuBudgetBytes) return Math.floor(gpuMemoryCapBytes(ctx.gpuBudgetBytes) / GiB);
    if (ctx.ramBytes) return Math.floor(ctx.ramBytes / GiB);
    return null;
  }
  if (entry.key === 'max_context') return ctx.contextMax ?? null;
  if (entry.key === 'max_cache_disk' && ctx.freeDiskBytes)
    return Math.floor(ctx.freeDiskBytes / unitBytes(entry.unit));
  return null;
}

function bounds(
  entry: {
    min: number | null;
    max: number | null;
    step: number | null;
    validation: ServeEntry['validation'];
  },
  dynamicMax: number | null,
  minOverride?: number | null,
): FormBounds {
  const v = entry.validation;
  return {
    min: minOverride !== undefined ? minOverride : entry.min,
    max: entry.max,
    step: entry.step,
    exclusiveMin: v.exclusive_min ?? null,
    softMax: v.ui_soft_max ?? v.ui_max ?? null,
    dynamicMax,
    dynamicMaxNote: v.dynamic_max ?? null,
  };
}

function serveForm(
  sectionId: string,
  catalog: Catalog,
  values: ServeValues,
  ctx: ValidationContext,
): FormModel {
  const section = catalog.sections.find((s) => s.id === sectionId);
  if (!section) throw new Error(`unknown serve section ${sectionId}`);
  const version = ctx.version === undefined ? catalog.version : ctx.version;
  const state = resolveServeState(values, catalog, version);
  const result = validateServeValues(values, catalog, { ...ctx, version });
  const groups: FormGroup[] = [
    { id: 'basic', label: GROUP_LABEL.basic, rows: [] },
    { id: 'advanced', label: GROUP_LABEL.advanced, rows: [] },
  ];
  for (const entry of catalog.serve) {
    if (
      entry.section !== sectionId ||
      entry.visibility === 'internal' ||
      entry.control === 'internal'
    )
      continue;
    const field = state.get(entry.key);
    if (!field) continue;
    const raw = values[entry.key];
    const defaultValue = normalizedDefault(entry);
    const value = isUnset(raw) ? defaultValue : raw;
    const row: FormRow = {
      key: entry.key,
      scope: 'serve',
      control: entry.control,
      type: entry.type,
      label: entry.label,
      help: entry.help,
      footnote: entry.validation.summary ?? null,
      note: entry.notes ?? null,
      unit: entry.unit,
      bounds: bounds(entry, serveDynamicMax(entry, ctx)),
      choices: entry.choices,
      multiple: entry.multiple,
      value,
      numericValue: numericOf(entry, value),
      display: formatServeValue(entry, raw),
      defaultValue,
      isDefault: field.isDefault,
      disabled: field.disabledReason !== null,
      disabledReason: field.disabledReason,
      hidden: field.hidden,
      restartRequired: entry.restart_required,
      secret: isSecretEntry(entry),
      flag: entry.flag,
      env: entry.env,
      issues: issuesFor(result, entry.key),
    };
    const group = groups.find((g) => g.id === entry.visibility);
    group?.rows.push(row);
  }
  return {
    scope: 'serve',
    id: section.id,
    label: section.label,
    description: section.description ?? null,
    groups: groups.filter((g) => g.rows.length > 0),
  };
}

function requestForm(
  sectionId: string,
  catalog: Catalog,
  values: RequestValues,
  ctx: ValidationContext,
  caps: ModelCapabilities,
): FormModel {
  const section = catalog.request_sections.find((s) => s.id === sectionId);
  if (!section) throw new Error(`unknown request section ${sectionId}`);
  const version = ctx.version === undefined ? catalog.version : ctx.version;
  const fields = requestFieldsFor(version, caps, catalog);
  const result = validateRequestValues(values, catalog, { ...caps, version });
  const rows: FormRow[] = [];
  for (const field of fields) {
    if (field.section !== sectionId || field.internal) continue;
    const entry = catalog.request.find((e) => e.key === field.key);
    if (!entry) continue;
    const value = values[field.key] === undefined ? field.default : values[field.key];
    rows.push({
      key: field.key,
      scope: 'request',
      control: field.control,
      type: field.type,
      label: field.label,
      help: field.help,
      footnote: field.validation.summary ?? null,
      note: entry.notes ?? null,
      unit: field.unit,
      bounds: bounds({ ...entry, min: entry.min }, null, field.min),
      choices: field.choices,
      multiple: field.multiple,
      value,
      numericValue: typeof value === 'number' ? value : null,
      display:
        field.choices?.find((c) => valuesEqual(c.value, value))?.label ??
        (value === null || value === undefined
          ? 'Not set'
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value)),
      defaultValue: field.default,
      isDefault: valuesEqual(value, field.default),
      disabled: !field.available,
      disabledReason: field.disabledReason,
      hidden: false,
      restartRequired: entry.restart_required,
      secret: false,
      flag: null,
      env: entry.env,
      issues: issuesFor(result, field.key),
    });
  }
  return {
    scope: 'request',
    id: section.id,
    label: section.label,
    description: section.description ?? null,
    groups: rows.length ? [{ id: 'basic', label: GROUP_LABEL.basic, rows }] : [],
  };
}

/** One section's form model. `scope` defaults to serve. */
export function toFormModel(sectionId: string, options: FormOptions = {}): FormModel {
  const catalog = options.catalog ?? getCatalog();
  const ctx = options.ctx ?? {};
  if (options.scope === 'request') {
    return requestForm(
      sectionId,
      catalog,
      (options.values ?? {}) as RequestValues,
      ctx,
      options.caps ?? {},
    );
  }
  return serveForm(sectionId, catalog, (options.values ?? {}) as ServeValues, ctx);
}

/** Every section of a scope, in catalog order. */
export function toFormModels(options: FormOptions = {}): FormModel[] {
  const catalog = options.catalog ?? getCatalog();
  const sections = options.scope === 'request' ? catalog.request_sections : catalog.sections;
  return sections.map((s) => toFormModel(s.id, { ...options, catalog }));
}
