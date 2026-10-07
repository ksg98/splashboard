/** Props-level types for the Settings dialog. The wiring phase maps stores onto these. */

export type SettingsTab = 'general' | 'chat' | 'models' | 'updates' | 'about';

export type AppearanceChoice = 'system' | 'light' | 'dark';

/** `reasoning_effort` values the UI offers for Qwen3.8-27B: None, Low, Medium, High. */
export type ThinkingLevel = 'none' | 'low' | 'medium' | 'xhigh';

/** Request sampling fields (docs/splash-params.json request[]). */
export interface SamplingValues {
  /** temperature, 0–2, step 0.05. */
  temperature: number;
  /** top_p, 0.01–1, step 0.01. */
  topP: number;
  /** top_k, integer; 0 turns the limit off. */
  topK: number;
  /** min_p, 0–1, step 0.01 (Splash 1.2.0+). */
  minP: number;
  /** presence_penalty, −2–2, step 0.1 (Splash 1.2.0+). */
  presencePenalty: number;
  /** frequency_penalty, −2–2, step 0.1 (Splash 1.2.0+). */
  frequencyPenalty: number;
  /** repetition_penalty, 0.01–2, step 0.01; 1 is off (Splash 1.2.0+). */
  repetitionPenalty: number;
}

export interface SamplingPreset {
  id: string;
  /** "Thinking (Qwen recommended)". */
  label: string;
  /** One line in the pop-up menu. */
  description?: string;
  /** The group footnote while this preset is chosen. */
  footnote: string;
  values: SamplingValues;
}

/** Every value the Settings dialog edits. */
export interface SettingsValues {
  appearance: AppearanceChoice;
  openAtLogin: boolean;
  /** "none" or the id of the model to start. */
  startServerAtLogin: string;
  keepRunningOnQuit: boolean;
  restartOnCrash: boolean;
  preventSleep: boolean;
  /** Model id for new chats. */
  defaultModel: string;
  thinking: ThinkingLevel;
  /** A preset id, or "custom" once a value differs from every preset. */
  samplingPreset: string;
  sampling: SamplingValues;
  /** max_completion_tokens for chat replies (thinking counts toward it). */
  maxTokens: number;
  /** null: random. */
  seed: number | null;
  /** Hugging Face token (kept in the Keychain by the wiring phase). */
  hfToken: string;
  /** Where new downloads go, as shown: "~/.cache/huggingface/hub". */
  downloadFolder: string;
  checkForUpdatesAutomatically: boolean;
}

export interface ModelOption {
  /** Model id (repo id), e.g. "incoai/Qwen3.8-27B-Splash". */
  value: string;
  /** Unique display title, e.g. "Qwen3.8-27B" or "Qwen3.8-27B (MLX 4-bit)". */
  label: string;
  /** "Splash package · 17.6 GB". */
  description?: string;
}

export type HfTokenStatus =
  | { state: 'none' }
  | { state: 'checking' }
  | { state: 'signed-in'; user: string }
  | { state: 'invalid'; message?: string };

export type UpdateStatus =
  | { state: 'up-to-date'; latest: string; checkedAt: string }
  | { state: 'checking' }
  | { state: 'available'; latest: string }
  | { state: 'error'; message: string };

/** Read-only facts the dialog shows. */
export interface SettingsInfo {
  models: ModelOption[];
  samplingPresets: SamplingPreset[];
  hfToken: HfTokenStatus;
  /** "53.6 GB". */
  modelsDiskUsed: string;
  modelsCount: number;
  /** "412 GB" free on the download folder's disk. */
  diskFree?: string;
  splash: { version: string; update: UpdateStatus };
  app: { version: string; update: UpdateStatus };
  /** "MacBook Pro · M3 Max · 64 GB". */
  mac: string;
  /** "127.0.0.1:8000". */
  server: string;
  license: string;
  /** About › Learn more: rows with an Open ↗ button. */
  links: { label: string; help?: string; url: string }[];
}

export interface SettingsActions {
  onTestToken?: () => void;
  onChooseFolder?: () => void;
  onManageModels?: () => void;
  onCheckForUpdates?: () => void;
  onUpdateSplash?: () => void;
  onUpdateApp?: () => void;
  onUninstallSplash?: () => void;
  /** Opens a URL in the browser (About links). */
  onOpenLink?: (url: string) => void;
}

/** What every Settings pane receives. */
export interface SettingsPaneProps {
  values: SettingsValues;
  onChange: (patch: Partial<SettingsValues>) => void;
  info: SettingsInfo;
  actions: SettingsActions;
}
