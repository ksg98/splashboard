/**
 * Demo props for the Models views (gallery and tests). Sample machine: a
 * MacBook Pro, M3 Max, 64 GB, running Splash 1.2.0 on 127.0.0.1:8000.
 *
 * Only what Splash runs is listed: the two Splash packages from Inco and MLX
 * 4-bit checkpoints of the same models.
 */
import type {
  LaunchRow,
  LaunchSection,
  LaunchSettingsSheetProps,
  ModelRowData,
  ModelSearch,
  ModelsViewProps,
  RunningModel,
} from './types';

const noop = () => undefined;

/* ---------------------------------------------------------------------------
 * Models
 * ------------------------------------------------------------------------- */

export const runningQwen27: RunningModel = {
  id: 'incoai/Qwen3.8-27B-Splash',
  name: 'Qwen3.8-27B',
  format: 'splash',
  size: '17.6 GB',
  context: '128K context',
  repo: 'incoai/Qwen3.8-27B-Splash',
  detail: '4-bit · reads images and PDFs',
  state: 'ready',
};

export const installedQwen35: ModelRowData = {
  id: 'incoai/Qwen3.6-35B-A3B-Splash',
  name: 'Qwen3.6-35B-A3B',
  description: 'Inco · Mixture of experts with 3B active, the fastest choice on this Mac',
  size: '20.4 GB',
  quant: '4-bit',
  format: 'splash',
  repo: 'incoai/Qwen3.6-35B-A3B-Splash',
  action: { kind: 'run' },
};

export const downloadingQwen35Mlx: ModelRowData = {
  id: 'mlx-community/Qwen3.6-35B-A3B-4bit',
  name: 'Qwen3.6-35B-A3B',
  variant: 'MLX 4-bit',
  description: 'mlx-community · A plain 4-bit conversion. Splash adds its draft model',
  size: '19.6 GB',
  quant: '4-bit',
  format: 'mlx',
  repo: 'mlx-community/Qwen3.6-35B-A3B-4bit',
  action: { kind: 'downloading', progress: 0.44, done: '8.6 of 19.6 GB', eta: 'about 3 min' },
};

/** One row, two downloadable versions: App Store style, with a Version pop-up. */
export const qwen27Mlx: ModelRowData = {
  id: 'qwen3.8-27b-mlx',
  name: 'Qwen3.8-27B',
  variant: 'MLX 4-bit',
  description: 'A plain 4-bit conversion by mlx-community. Splash adds its draft model',
  size: '15.6 GB',
  quant: '4-bit',
  format: 'mlx',
  repo: 'mlx-community/Qwen3.8-27B-4bit',
  action: { kind: 'get' },
  version: 'mlx-community/Qwen3.8-27B-4bit',
  versions: [
    {
      id: 'mlx-community/Qwen3.8-27B-4bit',
      label: 'mlx-community',
      description: '15.6 GB · a plain conversion',
      size: '15.6 GB',
      summary: 'A plain 4-bit conversion by mlx-community. Splash adds its draft model',
    },
    {
      id: 'lmstudio-community/Qwen3.8-27B-MLX-4bit',
      label: 'LM Studio',
      description: '15.3 GB · converted by lmstudio-community',
      size: '15.3 GB',
      summary: 'A 4-bit conversion by lmstudio-community. Splash adds its draft model',
    },
  ],
};

export const emptySearch: ModelSearch = { query: '', status: 'idle', results: [] };

export const modelsViewProps: ModelsViewProps = {
  // Installed sizes: 17.6 (Qwen3.8-27B) + 20.4 (Qwen3.6-35B-A3B). The download is not counted.
  diskUsage: '38.0 GB',
  downloadsFolder: '~/.cache/huggingface/hub',
  running: runningQwen27,
  installed: [installedQwen35],
  available: [downloadingQwen35Mlx, qwen27Mlx],
  search: emptySearch,
  onSearchChange: noop,
  onOpenLaunchSettings: noop,
  onStart: noop,
  onStop: noop,
  onRun: noop,
  onGet: noop,
  onCancelDownload: noop,
  onVersionChange: noop,
  onStopModel: noop,
};

export const modelsViewStopped: ModelsViewProps = {
  ...modelsViewProps,
  running: { ...runningQwen27, state: 'stopped' },
};

export const modelsViewStarting: ModelsViewProps = {
  ...modelsViewProps,
  running: { ...runningQwen27, state: 'starting' },
};

export const modelsViewBusy: ModelsViewProps = {
  ...modelsViewProps,
  running: { ...runningQwen27, state: 'busy' },
};

/** Search Hugging Face: only Splash packages and MLX 4-bit checkpoints come back. */
export const searchResults: ModelSearch = {
  query: 'Qwen3.8',
  status: 'results',
  results: [
    {
      id: 'incoai/Qwen3.8-27B-Splash',
      name: 'incoai/Qwen3.8-27B-Splash',
      description: 'The Splash package from Inco, with its draft model built in',
      size: '17.6 GB',
      quant: '4-bit',
      format: 'splash',
      repo: 'incoai/Qwen3.8-27B-Splash',
      action: { kind: 'installed' },
    },
    {
      id: 'mlx-community/Qwen3.8-27B-4bit',
      name: 'mlx-community/Qwen3.8-27B-4bit',
      description: 'A plain 4-bit conversion. Splash adds its draft model',
      size: '15.6 GB',
      quant: '4-bit',
      format: 'mlx',
      repo: 'mlx-community/Qwen3.8-27B-4bit',
      action: { kind: 'get' },
    },
    {
      id: 'lmstudio-community/Qwen3.8-27B-MLX-4bit',
      name: 'lmstudio-community/Qwen3.8-27B-MLX-4bit',
      description: 'A 4-bit conversion for LM Studio. Splash adds its draft model',
      size: '15.3 GB',
      quant: '4-bit',
      format: 'mlx',
      repo: 'lmstudio-community/Qwen3.8-27B-MLX-4bit',
      action: { kind: 'get' },
    },
  ],
};

export const modelsViewSearch: ModelsViewProps = { ...modelsViewProps, search: searchResults };

export const modelsViewSearchLoading: ModelsViewProps = {
  ...modelsViewProps,
  search: { query: 'Qwen3.6', status: 'loading', results: [] },
};

export const modelsViewSearchEmpty: ModelsViewProps = {
  ...modelsViewProps,
  search: { query: 'llama', status: 'empty', results: [] },
};

export const modelsViewSearchError: ModelsViewProps = {
  ...modelsViewProps,
  search: {
    query: 'Qwen3.6',
    status: 'error',
    results: [],
    error: 'Hugging Face didn’t answer. Check your connection and try again.',
  },
};

/** A 16 GB Mac: both models need more memory than it has, so nothing can be fetched. */
const tooSmall = (needs: string) => ({
  kind: 'incompatible' as const,
  reason: `Needs ${needs} of memory; this Mac has 16 GB`,
});

export const modelsViewSmallMac: ModelsViewProps = {
  ...modelsViewProps,
  diskUsage: null,
  running: null,
  installed: [],
  available: [
    {
      id: 'incoai/Qwen3.8-27B-Splash',
      name: 'Qwen3.8-27B',
      description: 'Inco · The Splash package, with its draft model built in',
      size: '17.6 GB',
      quant: '4-bit',
      format: 'splash',
      repo: 'incoai/Qwen3.8-27B-Splash',
      action: tooSmall('24 GB'),
    },
    {
      ...installedQwen35,
      action: tooSmall('24 GB'),
    },
    { ...qwen27Mlx, action: tooSmall('24 GB') },
  ],
};

/* ---------------------------------------------------------------------------
 * Launch settings (docs/splash-params.json, `serve` entries, 64 GB Mac)
 * ------------------------------------------------------------------------- */

const formatGb = (value: number) => (value === 0 ? 'Off' : `${value} GB`);

function modelSection(model: 'q27' | 'q35'): LaunchSection {
  return {
    id: 'model',
    title: 'Model',
    rows: [
      {
        key: 'model',
        label: 'Model',
        restartRequired: true,
        control: {
          kind: 'select',
          value: model === 'q27' ? 'incoai/Qwen3.8-27B-Splash' : 'incoai/Qwen3.6-35B-A3B-Splash',
          options: [
            {
              value: 'incoai/Qwen3.8-27B-Splash',
              label: 'Qwen3.8-27B',
              description: 'Splash package · 17.6 GB',
            },
            {
              value: 'incoai/Qwen3.6-35B-A3B-Splash',
              label: 'Qwen3.6-35B-A3B',
              description: 'Splash package · 20.4 GB',
            },
          ],
        },
      },
      {
        key: 'draft_model',
        label: 'Draft model',
        help: 'Proposes 7 tokens at a time for the main model to check, which is where most of the speed comes from.',
        restartRequired: true,
        control: {
          kind: 'select',
          value: 'auto',
          options: [
            {
              value: 'auto',
              label: 'Automatic',
              description:
                model === 'q27' ? 'incoai/Qwen3.8-27B-DFlash2' : 'incoai/Qwen3.6-35B-A3B-DFlash2',
            },
            { value: 'custom', label: 'Other…', description: 'A Hugging Face repo or a folder' },
          ],
        },
      },
      {
        key: 'default_reasoning_effort',
        label: 'Default thinking',
        help: 'Used when an app doesn’t ask for a level.',
        restartRequired: true,
        control: {
          kind: 'select',
          value: 'default',
          options: [
            { value: 'default', label: 'Model default', description: 'High for this model' },
            { value: 'none', label: 'Off' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'xhigh', label: 'High' },
          ],
        },
      },
      {
        key: 'language_only',
        label: 'Text only',
        help: 'Frees memory for a longer context. Images and PDFs are turned off.',
        restartRequired: true,
        control: { kind: 'toggle', value: false },
      },
      {
        key: 'offline',
        label: 'Start offline',
        help: 'Skip the update check at start. Works for installed models only.',
        restartRequired: true,
        control: { kind: 'toggle', value: false },
      },
    ],
  };
}

function memorySection(model: 'q27' | 'q35'): LaunchSection {
  const context: LaunchRow = {
    key: 'max_context',
    label: 'Context length',
    restartRequired: true,
    control: {
      kind: 'slider',
      value: model === 'q27' ? 131072 : 262144,
      min: 8192,
      max: 262144,
      step: 8192,
      format: 'tokens',
    },
  };
  if (model === 'q27') context.changed = 'Changed from Automatic (256K)';
  return {
    id: 'memory',
    title: 'Memory & context',
    footnote:
      'Automatic uses as much memory as macOS considers safe for the GPU. Context stops at 256K, the most this Mac has measured. Coding agents need about 100K.',
    rows: [
      {
        key: 'max_memory',
        label: 'GPU memory limit',
        restartRequired: true,
        control: {
          kind: 'select',
          value: 'auto',
          options: [
            { value: 'auto', label: 'Automatic (48 GB)', description: 'What macOS considers safe' },
            { value: '40', label: '40 GB' },
            { value: '32', label: '32 GB' },
            { value: '24', label: '24 GB' },
          ],
        },
      },
      context,
      {
        key: 'max_image_pixels',
        label: 'Largest image size',
        restartRequired: true,
        control: {
          kind: 'slider',
          value: 4194304,
          min: 65536,
          max: 4194304,
          step: 65536,
          format: 'megapixels',
        },
      },
    ],
  };
}

const cacheSection: LaunchSection = {
  id: 'cache',
  title: 'Cache',
  footnote:
    'Working memory holds the conversation the model is reading (the KV cache). Compact fits about twice the context of Full. The SSD cache keeps long prompts ready when memory runs short; it doesn’t raise the context limit, and it writes to your SSD.',
  rows: [
    {
      key: 'kv_format',
      label: 'Working memory precision',
      restartRequired: true,
      control: {
        kind: 'segmented',
        value: 'int8',
        options: [
          { value: 'int8', label: 'Compact (8-bit)' },
          { value: 'bf16', label: 'Full (16-bit)' },
        ],
      },
    },
    {
      key: 'max_cache_disk',
      label: 'SSD cache',
      restartRequired: true,
      control: { kind: 'slider', value: 32, min: 0, max: 128, step: 4, format: formatGb },
    },
    {
      key: 'persistent_cache',
      label: 'Keep SSD cache across restarts',
      restartRequired: true,
      control: { kind: 'toggle', value: true },
    },
  ],
};

const networkSection: LaunchSection = {
  id: 'network',
  title: 'Network & security',
  footnote:
    'Agents launched from Splashboard use this port and key automatically. Keep the API key on before listening on all networks.',
  rows: [
    {
      key: 'port',
      label: 'Port',
      restartRequired: true,
      control: { kind: 'number', value: 8000, min: 1024, max: 65535, step: 1 },
    },
    {
      key: 'host',
      label: 'Listen on',
      restartRequired: true,
      control: {
        kind: 'select',
        value: '127.0.0.1',
        options: [
          { value: '127.0.0.1', label: 'This Mac only' },
          {
            value: '0.0.0.0',
            label: 'All networks',
            description: 'Other devices on your network can connect',
          },
        ],
      },
    },
    {
      key: 'api_key',
      label: 'Require an API key',
      restartRequired: true,
      control: { kind: 'secret', value: 'sk-splash-••••••••7f3a', enabled: true },
    },
    {
      key: 'allowed_origin',
      label: 'Allowed web origins',
      help: 'Web pages that may call the server, Splashboard included.',
      restartRequired: true,
      control: { kind: 'multi-value', value: ['tauri://localhost'], emptyLabel: 'None' },
    },
  ],
};

const advancedSection: LaunchSection = {
  id: 'advanced',
  title: 'Advanced',
  rows: [
    {
      key: 'queue_size',
      label: 'Request queue',
      help: 'Splash runs up to 4 requests at once. The rest wait here.',
      restartRequired: true,
      control: { kind: 'number', value: 32, min: 1, max: 1024, step: 1 },
    },
    {
      key: 'request_timeout',
      label: 'Request time limit',
      restartRequired: true,
      control: {
        kind: 'select',
        value: 'none',
        options: [
          { value: 'none', label: 'None' },
          { value: '300', label: '5 minutes' },
          { value: '600', label: '10 minutes' },
          { value: '1800', label: '30 minutes' },
          { value: '3600', label: '1 hour' },
        ],
      },
    },
    {
      key: 'decode_share',
      label: 'Reply share during long prompts',
      help: 'Higher keeps other chats and agents flowing while a long prompt is read; that prompt finishes later.',
      restartRequired: true,
      control: {
        kind: 'slider',
        value: 0.5,
        stops: [0, 0.25, 0.5, 1, 2],
        ends: ['Long prompt first', 'Replies first'],
        stopLabels: [
          'Long prompt first',
          'More to the long prompt',
          'Balanced (default)',
          'More to replies',
          'Replies first',
        ],
      },
    },
    {
      // The row is the page itself: true means the page is on, which is `--no-webui` NOT passed.
      key: 'no_webui',
      label: 'Built-in chat page',
      help: 'Splash’s own page at 127.0.0.1:8000. Splashboard doesn’t need it.',
      restartRequired: true,
      control: { kind: 'toggle', value: true },
    },
    {
      key: 'crash_trace',
      label: 'Record crash traces',
      help: 'Traces can contain conversation text.',
      restartRequired: true,
      control: { kind: 'toggle', value: false },
    },
  ],
  moreRows: [
    {
      key: 'revision',
      label: 'Model revision',
      help: 'A branch, tag or commit. Pin a commit to freeze the model.',
      restartRequired: true,
      control: {
        kind: 'select',
        value: 'latest',
        options: [
          { value: 'latest', label: 'Latest', description: 'Checks for a newer version at start' },
          { value: 'pin', label: 'This version', description: 'Freezes the model as it is now' },
        ],
      },
    },
    {
      key: 'served_model_name',
      label: 'Model aliases',
      help: 'Other names apps can use for this model.',
      restartRequired: true,
      control: { kind: 'multi-value', value: ['local-qwen'], emptyLabel: 'None' },
    },
    {
      key: 'allowed_host',
      label: 'Extra host names',
      help: 'Names such as mymac.local that clients may put in the address.',
      restartRequired: true,
      control: { kind: 'multi-value', value: [], emptyLabel: 'None' },
    },
    {
      key: 'max_request_size',
      label: 'Largest request',
      help: 'Images and PDFs travel inside a request. Larger ones are refused.',
      restartRequired: true,
      control: { kind: 'number', value: 128, min: 1, max: 2048, step: 1, unit: 'MB' },
    },
    {
      key: 'cache_dir',
      label: 'SSD cache folder',
      help: 'Where the kept SSD cache lives. Choose another disk if you like.',
      restartRequired: true,
      control: { kind: 'directory', value: null, emptyLabel: 'Default' },
    },
  ],
};

const presetOptions = [
  {
    value: 'recommended',
    label: 'Recommended for this Mac (64 GB)',
    description: 'Qwen3.8-27B with an SSD cache for agents',
  },
  {
    value: 'recipe-warm-prompt',
    label: 'Keep long agent prompts warm',
    description: 'A 32 GB SSD cache that survives restarts',
  },
  {
    value: 'recipe-lan-share',
    label: 'Share on my network',
    description: 'All networks, with an API key',
  },
  {
    value: 'recipe-offline',
    label: 'Start offline',
    description: 'No Hugging Face request at start',
  },
  { value: 'custom', label: 'Custom' },
];

const COMMAND_27B = [
  'splash serve \\',
  '  --model=incoai/Qwen3.8-27B-Splash \\',
  '  --port=8000 \\',
  '  --max-context=128K \\',
  '  --max-cache-disk=32G \\',
  '  --persistent-cache \\',
  '  --allowed-origin=tauri://localhost \\',
  '  --served-model-name=local-qwen',
].join('\n');

const COMMAND_35B = [
  'splash serve \\',
  '  --model=incoai/Qwen3.6-35B-A3B-Splash \\',
  '  --port=8000 \\',
  '  --max-cache-disk=32G \\',
  '  --persistent-cache \\',
  '  --allowed-origin=tauri://localhost \\',
  '  --served-model-name=local-qwen',
].join('\n');

export const COMMAND_FOOTNOTE =
  'Exactly what Splashboard runs. Besides the model and port, only settings that differ from Splash’s defaults are listed. The API key and Hugging Face token are passed in the environment, never on the command line.';

/** Opened from the running model's card: one change (128K context) waits for a restart. */
export const launchSettingsProps: LaunchSettingsSheetProps = {
  open: true,
  title: 'Launch settings',
  subtitle: 'Qwen3.8-27B · incoai/Qwen3.8-27B-Splash',
  preset: {
    value: 'recommended',
    options: presetOptions,
    footnote:
      'Qwen3.8-27B with a 32 GB SSD cache that keeps coding agents’ long prompts ready across restarts.',
  },
  sections: [
    modelSection('q27'),
    memorySection('q27'),
    cacheSection,
    networkSection,
    advancedSection,
  ],
  command: COMMAND_27B,
  commandFootnote: COMMAND_FOOTNOTE,
  dirty: true,
  onChange: noop,
  onPresetChange: noop,
  onCancel: noop,
  onSave: noop,
  onAction: noop,
};

/** Opened from another installed model: the primary runs it instead. */
export const launchSettingsOtherProps: LaunchSettingsSheetProps = {
  ...launchSettingsProps,
  subtitle: 'Qwen3.6-35B-A3B · incoai/Qwen3.6-35B-A3B-Splash',
  preset: {
    value: 'recommended',
    options: presetOptions,
    footnote:
      'Qwen3.6-35B-A3B with a 32 GB SSD cache. Only 3B of its 35B parameters work on each word, so it replies fastest on this Mac.',
  },
  sections: [
    modelSection('q35'),
    memorySection('q35'),
    cacheSection,
    networkSection,
    advancedSection,
  ],
  command: COMMAND_35B,
  dirty: false,
  footerNote: 'Stops Qwen3.8-27B and starts this model.',
  primaryLabel: 'Run Qwen3.6-35B-A3B',
};

/** Same sheet scrolled to the end with Advanced › More options and the command open. */
export const launchSettingsCommandProps: LaunchSettingsSheetProps = {
  ...launchSettingsProps,
  commandOpen: true,
  moreOpen: { advanced: true },
};
