/**
 * Prop shapes for the Models views. Presentational only: the page (wiring
 * phase) maps engine, catalog and download state onto these.
 *
 * Scope: Splashboard lists only what Splash runs, Splash packages and MLX
 * 4-bit checkpoints.
 */

/** The two formats Splash runs. */
export type ModelFormat = 'splash' | 'mlx';

/** Engine words, used the same everywhere: Ready, Thinking, Starting…, Stopped. */
export type EngineState = 'ready' | 'busy' | 'starting' | 'stopped';

/** One downloadable version of a model (the Version pop-up). */
export interface ModelVersion {
  /** Hub repo id, e.g. "mlx-community/Qwen3.8-27B-4bit". Also the pop-up value. */
  id: string;
  /** Short label in the pop-up button, e.g. "mlx-community". */
  label: string;
  /** Second line in the pop-up menu, e.g. "15.6 GB · a plain conversion". */
  description?: string;
  /** Size of this version, e.g. "15.6 GB". */
  size: string;
  /** Row help when this version is chosen. */
  summary: string;
}

/** What the trailing action slot shows. */
export type ModelRowAction =
  /** Installed, not running: Run. The row itself opens its launch settings. */
  | { kind: 'run' }
  /** Running or starting from this row: Stop. */
  | { kind: 'stop' }
  /** Not on this Mac: Get. */
  | { kind: 'get' }
  /** Download in progress: a ring with a stop square, centred in the same slot. */
  | {
      kind: 'downloading';
      /** 0..1 */
      progress: number;
      /** e.g. "8.6 of 19.6 GB" */
      done: string;
      /** e.g. "about 3 min" */
      eta?: string;
    }
  /** Too big or otherwise unusable on this Mac: dimmed row, no action. */
  | { kind: 'incompatible'; reason: string }
  /** Already installed (search results): a quiet word instead of a button. */
  | { kind: 'installed' };

export interface ModelRowData {
  /** Stable id, usually the repo id ("incoai/Qwen3.6-35B-A3B-Splash"). */
  id: string;
  /** Plain model name, e.g. "Qwen3.8-27B". */
  name: string;
  /**
   * Version shown after the name in regular weight, e.g. "MLX 4-bit". The
   * Splash package carries no variant; any other version of a model does.
   */
  variant?: string;
  /** One line, led by the publisher: "Inco · Mixture of experts, the fastest choice on this Mac". */
  description: string;
  /** e.g. "20.4 GB" */
  size: string;
  /** e.g. "4-bit" */
  quant: string;
  format: ModelFormat;
  /** Hub repo id, shown as a tooltip. */
  repo: string;
  action: ModelRowAction;
  /** Several downloadable versions of one model: one row with a Version pop-up. */
  versions?: ModelVersion[];
  /** Chosen version id (one of `versions`). */
  version?: string;
}

export interface RunningModel {
  id: string;
  name: string;
  variant?: string;
  format: ModelFormat;
  size: string;
  /** e.g. "128K context" */
  context: string;
  repo: string;
  /** e.g. "4-bit · reads images and PDFs", shown with the repo on hover. */
  detail?: string;
  state: EngineState;
}

export type SearchStatus = 'idle' | 'loading' | 'results' | 'empty' | 'error';

export interface ModelSearch {
  query: string;
  status: SearchStatus;
  results: ModelRowData[];
  /** Plain-English error, shown when status is "error". */
  error?: string;
}

export interface ModelsViewProps {
  /** Total size of installed models, e.g. "38.0 GB"; null when nothing is installed. */
  diskUsage: string | null;
  /** Where downloads go, e.g. "~/.cache/huggingface/hub". */
  downloadsFolder: string;
  /** The model the server runs, or null before the first start. */
  running: RunningModel | null;
  installed: ModelRowData[];
  available: ModelRowData[];
  search: ModelSearch;
  onSearchChange: (query: string) => void;
  onOpenLaunchSettings: (modelId: string) => void;
  onStart: () => void;
  onStop: () => void;
  onRun: (modelId: string) => void;
  onGet: (modelId: string, versionId?: string) => void;
  onCancelDownload: (modelId: string) => void;
  onVersionChange?: (modelId: string, versionId: string) => void;
  /** Optional: stop the model a row is running (rows with a "stop" action). */
  onStopModel?: (modelId: string) => void;
}

/* ---------------------------------------------------------------------------
 * Launch settings: a generic form model, rendered with the Form primitives.
 * ------------------------------------------------------------------------- */

export type LaunchControlKind =
  | 'toggle'
  | 'select'
  | 'segmented'
  | 'slider'
  | 'number'
  | 'text'
  | 'secret'
  | 'directory'
  | 'multi-value';

export type LaunchValue = string | number | boolean | string[] | null;

export interface LaunchOption {
  value: string;
  label: string;
  description?: string;
}

/** Named formats for numeric controls; a function can be passed instead. */
export type LaunchFormat = 'tokens' | 'gb' | 'mb' | 'megapixels' | 'seconds' | 'plain';

export interface LaunchControl {
  kind: LaunchControlKind;
  value: LaunchValue;
  /** select, segmented */
  options?: LaunchOption[];
  /** slider, number */
  min?: number;
  max?: number;
  step?: number;
  /** number: unit after the stepper ("MB"); slider: used by the default format. */
  unit?: string;
  /** slider: how the value at the right is written. */
  format?: LaunchFormat | ((value: number) => string);
  /**
   * slider: a few named stops instead of a number line (e.g. 0, 0.25, 0.5, 1, 2).
   * The track gets one tick per stop and `ends` below it instead of a value.
   */
  stops?: number[];
  /** slider with stops: labels under the two ends. */
  ends?: [string, string];
  /** slider with stops: spoken value for each stop (aria-valuetext). */
  stopLabels?: string[];
  /**
   * secret: when set, the row is a switch ("Require an API key"); the masked
   * `value` and a Regenerate… text button appear under the label while it is on.
   * Without it the secret is a SecureField.
   */
  enabled?: boolean;
  /** text, secret: placeholder. */
  placeholder?: string;
  /** text: monospace field (paths, URLs). */
  monospace?: boolean;
  /** directory, multi-value: what to show when empty ("Default", "None"). */
  emptyLabel?: string;
}

export interface LaunchRow {
  /** Parameter key (splash-params.json `serve[].key`), passed back to onChange. */
  key: string;
  label: string;
  help?: string;
  footnote?: string;
  control: LaunchControl;
  disabled?: boolean;
  disabledReason?: string;
  /** Changing it needs a server restart (all `serve` flags do). */
  restartRequired?: boolean;
  /** Differs from the default; a string is shown as the help line ("Changed from Automatic (256K)"). */
  changed?: boolean | string;
}

export interface LaunchSection {
  id: string;
  title: string;
  footnote?: string;
  rows: LaunchRow[];
  /** Rows behind a "More options" disclosure at the end of the same group. */
  moreRows?: LaunchRow[];
}

export interface LaunchPreset {
  value: string;
  options: LaunchOption[];
  /** One or two sentences under the preset pop-up. */
  footnote?: string;
}

/** Row-level buttons that open a picker or run a command. */
export type LaunchAction = 'edit' | 'choose' | 'regenerate';

export interface LaunchSettingsSheetProps {
  /** Defaults to true. */
  open?: boolean;
  title: string;
  /** "Qwen3.8-27B · incoai/Qwen3.8-27B-Splash" */
  subtitle: string;
  preset: LaunchPreset;
  sections: LaunchSection[];
  /** The equivalent `splash serve …` command, one flag per line. */
  command: string;
  /** Something differs from what the server runs. */
  dirty: boolean;
  onChange: (key: string, value: LaunchValue) => void;
  onPresetChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  /** Edit…, Choose…, Regenerate… */
  onAction?: (key: string, action: LaunchAction) => void;
  /**
   * Footer note in place of "Restart required to apply changes", e.g.
   * "Stops Qwen3.8-27B and starts this model." for another installed model.
   */
  footerNote?: string;
  /** Primary button label. Defaults to "Save and restart". */
  primaryLabel?: string;
  /** Footnote under the command. */
  commandFootnote?: string;
  /** Controlled "Show command" disclosure (uncontrolled when omitted). */
  commandOpen?: boolean;
  onCommandOpenChange?: (open: boolean) => void;
  /** Controlled "More options" disclosures, by section id. */
  moreOpen?: Record<string, boolean>;
  onMoreOpenChange?: (sectionId: string, open: boolean) => void;
  /** Disable Save while the form has errors. */
  saveDisabled?: boolean;
}
