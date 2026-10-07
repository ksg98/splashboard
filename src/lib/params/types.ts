/**
 * Types for docs/splash-params.json, the single source of truth for every
 * `splash serve` flag, environment variable, chat request field and preset.
 * Field names mirror the JSON (snake_case) so the file can be read as-is.
 */

/** Every control kind listed in `conventions.control`. */
export const CONTROL_KINDS = [
  'model-picker',
  'revision-picker',
  'combobox+directory-picker',
  'toggle',
  'secret',
  'secret+generate',
  'directory-picker',
  'number',
  'number+none',
  'number+auto',
  'number+random',
  'select',
  'segmented',
  'slider',
  'slider+auto',
  'slider+off',
  'multi-value-list',
  'text',
  'textarea',
  'tri-state',
  'json-editor',
  'select+json-schema-editor',
  'tool-list-editor',
  'file-attach',
  'internal',
] as const;

export type ControlKind = (typeof CONTROL_KINDS)[number];

/** basic = shown by default, advanced = behind "Show advanced", internal = never shown. */
export type Visibility = 'basic' | 'advanced' | 'internal';

/** argv = `--flag=value` on the command line; env = environment of the spawned process. */
export type PassAs = 'argv' | 'env';

/** A value a serve form field can hold (sizes in CLI spelling such as "32G" or a number in the field's unit). */
export type ParamValue = string | number | boolean | string[] | null;

/** Form values keyed by `serve[].key`. Missing keys mean "use the default". */
export type ServeValues = Partial<Record<string, ParamValue | undefined>>;

/** Request values keyed by `request[].key`. Objects (response_format, tools, ...) are allowed. */
export type RequestValues = Partial<Record<string, unknown>>;

export interface Choice {
  /** string for most selects; null = "unset"; an object for a named tool_choice. */
  value: unknown;
  label: string;
}

/**
 * A `validation.requires` condition: `true` (the other key must be on),
 * `"non_empty"`, `"> 0"`, or `"non_empty unless auto|none"`.
 */
export type RequiresCondition = string | boolean;

/** `validation` block. Known keys are typed; the rest stay available as unknown. */
export interface Validation {
  summary?: string;
  required?: boolean;
  pattern?: string;
  pattern_is_hint_only?: boolean;
  item_pattern?: string;
  item_format?: string;
  format?: string;
  integer?: boolean;
  finite?: boolean;
  min?: number;
  max?: number;
  exclusive_min?: number;
  ui_soft_max?: number;
  ui_max?: number;
  dynamic_max?: string;
  min_bytes?: number;
  max_tokens?: number;
  units_base?: number;
  k_multiplier?: number;
  requires?: Record<string, RequiresCondition>;
  disabled_when?: Record<string, unknown>;
  choices?: string[];
  unique?: boolean;
  max_items?: number;
  item_non_empty?: boolean;
  conflicts?: string[];
  env_value_when_on?: string;
  env_min_version?: string;
  env_equivalent?: Record<string, string>;
  send_only_if_not_default?: boolean;
  send_only_if_set?: boolean;
  not_for_legacy_packages?: boolean;
  must_include?: string[];
  implies?: Record<string, string>;
  forbid_substrings?: string[];
  repo_must_not_end_with?: string;
  repo_pattern?: string;
  directory_must_be_absolute?: boolean;
  min_effective_mib?: Record<string, number>;
  warn_below_for_agents?: number;
  confirm_on_enable?: string;
  requires_installed_model?: boolean;
  requires_server?: Record<string, unknown>;
  reserved_keys?: string[];
  version_gates?: Record<string, string>;
  per_model_ui?: Record<string, string[]>;
  ui_value?: unknown;
  [extra: string]: unknown;
}

interface EntryBase {
  key: string;
  label: string;
  section: string;
  control: ControlKind;
  /** model_id, string, boolean, integer, number, size, tokens, enum, path, url, ipv4, hostname, origin, ... */
  type: string;
  default: unknown;
  min: number | null;
  max: number | null;
  step: number | null;
  unit: string | null;
  choices: Choice[] | null;
  multiple: boolean;
  restart_required: boolean;
  /** First Splash release that accepts the field. */
  min_version: string;
  help: string;
  validation: Validation;
  env: string | null;
  notes?: string | null;
}

/** One `serve[]` entry: a `splash serve` flag or an environment variable. */
export interface ServeEntry extends EntryBase {
  flag: string | null;
  pass_as: PassAs;
  cli_format: string;
  visibility: Visibility;
  /** serve, download, catalog_refresh, agents */
  applies_to: string[];
}

/** One `request[]` entry: a chat request field. */
export interface RequestEntry extends EntryBase {
  field: string;
  endpoint_map: Record<string, string | null>;
}

export type ParamEntry = ServeEntry | RequestEntry;

export interface Section {
  id: string;
  label: string;
  description?: string;
}

export type PresetKind = 'ram' | 'recipe' | 'sampling';

export interface Preset {
  id: string;
  kind: PresetKind;
  label: string;
  ram_gb: number | null;
  evidence?: string;
  description?: string;
  /** Values keyed by serve[].key in CLI spelling; may contain placeholders such as "<generate>". */
  serve: Record<string, ParamValue>;
  observed?: unknown;
  alternatives: string[];
  source?: unknown;
  request: Record<string, unknown> | null;
  min_version: string | null;
}

export interface AppSetting {
  key: string;
  label: string;
  control: ControlKind;
  default: unknown;
  help: string;
  replaces?: string;
  source?: unknown;
}

export interface Conventions {
  control: ControlKind[];
  pass_as: Record<PassAs, string>;
  restart_required: string;
  min_max: string;
  headless: string;
  visibility: Record<Visibility, string>;
  'validation.requires': string;
  'validation.dynamic_max': string;
}

export interface Catalog {
  /** Splash release the catalog was generated from. */
  version: string;
  conventions: Conventions;
  sections: Section[];
  serve: ServeEntry[];
  request_sections: Section[];
  request: RequestEntry[];
  presets: Preset[];
  /** Owned by the connect feature; kept untyped here. */
  connectors: unknown[];
  client_configs: unknown[];
  app_settings: AppSetting[];
}
