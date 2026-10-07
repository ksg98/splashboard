/**
 * docs/splash-params.json (through @/lib/params) → the Launch settings sheet.
 * Every `splash serve` flag becomes a row; values stay in CLI spelling
 * ("32G", "auto", 131072) so they round-trip through buildServeRequest.
 */
import { toFormModels, type FormRow } from '@/lib/params/form';
import { applyPreset, presetsForMac } from '@/lib/params/presets';
import { renderCommand, tryBuildServeRequest } from '@/lib/params/serve';
import type { ServeValues } from '@/lib/params/types';
import type { RunnableModel } from '@/lib/models/runnable';
import { formatLabel } from '@/lib/models/runnable';
import type {
  LaunchControl,
  LaunchPreset,
  LaunchRow,
  LaunchSection,
  LaunchValue,
} from './views/types';

export const CUSTOM_PRESET = 'custom';

/** Rows the sheet doesn't show: secrets live in Settings, the rest is internal plumbing. */
const HIDDEN = new Set(['hf_token', 'hf_disable_progress_bars']);

function sizeSuffix(unit: string | null): string {
  if (unit === 'MiB') return 'M';
  if (unit === 'KiB') return 'K';
  return 'G';
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function control(row: FormRow, models: RunnableModel[]): LaunchControl {
  const min = row.bounds.min ?? 0;
  const max =
    row.bounds.dynamicMax ?? row.bounds.softMax ?? row.bounds.max ?? Math.max(min * 4, 64);
  const step = row.bounds.step ?? 1;
  switch (row.control) {
    case 'model-picker':
      return {
        kind: 'select',
        value: typeof row.value === 'string' ? row.value : '',
        options: models.map((m) => ({
          value: m.model,
          label: m.name,
          description: `${formatLabel(m.format)} · ${m.publisher}`,
        })),
      };
    case 'toggle':
      return { kind: 'toggle', value: row.value === true };
    case 'select':
    case 'segmented':
      return {
        kind: row.control === 'segmented' ? 'segmented' : 'select',
        value: row.value == null ? '' : String(row.value),
        options: [
          ...(row.control === 'select' && row.value == null
            ? [{ value: '', label: 'Model default' }]
            : []),
          ...(row.choices ?? []).map((choice) => ({
            value: String(choice.value),
            label: choice.label || String(choice.value),
          })),
        ],
      };
    case 'slider':
    case 'slider+auto':
    case 'slider+off':
      return {
        kind: 'slider',
        value: row.numericValue ?? (row.control === 'slider+off' ? 0 : max),
        min,
        max,
        step,
        unit: row.unit === 'GiB' ? 'GB' : (row.unit ?? undefined),
        format:
          row.type === 'tokens'
            ? 'tokens'
            : row.unit === 'GiB'
              ? 'gb'
              : row.unit === 'pixels'
                ? 'megapixels'
                : 'plain',
        enabled:
          row.control === 'slider+auto' ? row.value !== 'auto' && row.value != null : undefined,
        emptyLabel:
          row.control === 'slider+auto'
            ? 'Automatic'
            : row.control === 'slider+off'
              ? 'Off'
              : undefined,
      };
    case 'number':
    case 'number+none':
    case 'number+auto':
    case 'number+random':
      return {
        kind: 'number',
        value: row.numericValue ?? numberOr(row.value, numberOr(row.defaultValue, min)),
        min,
        max: row.bounds.max ?? undefined,
        step,
        unit: row.unit ?? undefined,
      };
    case 'secret':
    case 'secret+generate':
      return { kind: 'secret', value: typeof row.value === 'string' ? row.value : '' };
    case 'multi-value-list':
      return { kind: 'multi-value', value: Array.isArray(row.value) ? row.value.map(String) : [] };
    case 'directory-picker':
    case 'combobox+directory-picker':
      return {
        kind: 'text',
        value: typeof row.value === 'string' ? row.value : '',
        placeholder: typeof row.defaultValue === 'string' ? row.defaultValue : 'Default',
        monospace: true,
      };
    default:
      return {
        kind: 'text',
        value: row.value == null ? '' : String(row.value),
        placeholder: row.defaultValue == null ? undefined : String(row.defaultValue),
        monospace: row.type === 'url' || row.type === 'path',
      };
  }
}

function toRow(row: FormRow, models: RunnableModel[], saved: ServeValues): LaunchRow {
  const changed =
    JSON.stringify(saved[row.key] ?? null) !== JSON.stringify(row.value ?? null) && !row.isDefault;
  return {
    key: row.key,
    label: row.label,
    help: row.help || undefined,
    footnote: row.footnote ?? undefined,
    control: control(row, models),
    disabled: row.disabled,
    disabledReason: row.disabledReason ?? undefined,
    restartRequired: row.restartRequired,
    changed: changed || undefined,
  };
}

export interface LaunchFormInput {
  values: ServeValues;
  saved: ServeValues;
  models: RunnableModel[];
  version: string | null;
  ramBytes: number | null;
  gpuBudgetBytes: number | null;
}

export function launchSections(input: LaunchFormInput): LaunchSection[] {
  const forms = toFormModels({
    scope: 'serve',
    values: input.values,
    ctx: {
      version: input.version ?? undefined,
      ramBytes: input.ramBytes ?? undefined,
      gpuBudgetBytes: input.gpuBudgetBytes ?? undefined,
    },
  });
  return forms
    .map((form) => {
      const rows = form.groups.flatMap((group) =>
        group.rows
          .filter((row) => !row.hidden && !HIDDEN.has(row.key))
          .map((row) => ({ row, basic: group.id === 'basic' })),
      );
      return {
        id: form.id,
        title: form.label,
        footnote: form.description ?? undefined,
        rows: rows.filter((r) => r.basic).map((r) => toRow(r.row, input.models, input.saved)),
        moreRows: rows.filter((r) => !r.basic).map((r) => toRow(r.row, input.models, input.saved)),
      };
    })
    .filter((section) => section.rows.length + (section.moreRows?.length ?? 0) > 0)
    .map((section) =>
      section.rows.length === 0
        ? { ...section, rows: section.moreRows ?? [], moreRows: [] }
        : section,
    );
}

/** A value from the sheet → the value buildServeRequest expects. */
export function fromSheetValue(
  key: string,
  value: LaunchValue,
  sections: LaunchSection[],
): unknown {
  const row = sections
    .flatMap((s) => [...s.rows, ...(s.moreRows ?? [])])
    .find((r) => r.key === key);
  if (!row) return value;
  if (row.control.kind === 'slider' && typeof value === 'number') {
    if (row.control.format === 'gb')
      return value === 0 && key === 'max_cache_disk' ? '0' : `${value}${sizeSuffix('GiB')}`;
    return value;
  }
  if (
    row.control.kind === 'text' ||
    row.control.kind === 'secret' ||
    row.control.kind === 'select'
  ) {
    return value === '' ? undefined : value;
  }
  return value;
}

export function presetPicker(
  ramBytes: number | null,
  version: string | null,
  chosen: string,
): LaunchPreset {
  const mac = presetsForMac(ramBytes, version);
  const options = [...mac.ram, ...mac.recipes]
    .filter((option) => option.available)
    .map((option) => ({
      value: option.preset.id,
      label: option.preset.label,
      description: option.preset.description ?? undefined,
    }));
  const current = options.find((option) => option.value === chosen);
  return {
    value: current ? chosen : CUSTOM_PRESET,
    options: [{ value: CUSTOM_PRESET, label: 'Custom' }, ...options],
    footnote: current?.description,
  };
}

export function withPreset(
  values: ServeValues,
  presetId: string,
  ramBytes: number | null,
  version: string | null,
): ServeValues {
  const mac = presetsForMac(ramBytes, version);
  const option = [...mac.ram, ...mac.recipes].find((o) => o.preset.id === presetId);
  if (!option) return values;
  return applyPreset(values, option.preset).values;
}

export function launchCommand(
  values: ServeValues,
  version: string | null,
): { command: string; error: string | null } {
  const built = tryBuildServeRequest(values, undefined, version ?? undefined);
  if (!built.request) {
    return { command: '', error: built.issues[0]?.message ?? 'These settings are not valid.' };
  }
  return { command: renderCommand(built.request), error: null };
}
