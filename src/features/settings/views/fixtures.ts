/**
 * Demo props for the Settings dialog (gallery and tests). Models are the two
 * Splash packages and an MLX 4-bit build Splash runs; the Mac is a MacBook Pro
 * M3 Max with 64 GB; Splash 1.2.0 on 127.0.0.1:8000.
 */
import type { SamplingPreset, SettingsInfo, SettingsValues } from './types';

export const samplingPresets: SamplingPreset[] = [
  {
    id: 'sampling-thinking',
    label: 'Thinking (Qwen recommended)',
    description: 'Qwen’s settings for thinking mode',
    footnote:
      'Qwen’s settings for thinking mode. Splashboard sends only the values you change. With thinking off, Qwen suggests a presence penalty of 1.50.',
    values: {
      temperature: 1,
      topP: 0.95,
      topK: 20,
      minP: 0,
      presencePenalty: 0,
      frequencyPenalty: 0,
      repetitionPenalty: 1,
    },
  },
  {
    id: 'sampling-instruct',
    label: 'Instruct (thinking off)',
    description: 'Qwen’s settings with thinking off',
    footnote:
      'Qwen’s settings for answering without thinking. Splashboard sends only the values you change.',
    values: {
      temperature: 0.7,
      topP: 0.8,
      topK: 20,
      minP: 0,
      presencePenalty: 1.5,
      frequencyPenalty: 0,
      repetitionPenalty: 1,
    },
  },
  {
    id: 'sampling-greedy',
    label: 'Deterministic',
    description: 'Always the most likely word',
    footnote:
      'Temperature 0 always picks the most likely word, so the same prompt gives the same reply. Set a seed below to repeat sampled replies too.',
    values: {
      temperature: 0,
      topP: 0.95,
      topK: 20,
      minP: 0,
      presencePenalty: 0,
      frequencyPenalty: 0,
      repetitionPenalty: 1,
    },
  },
];

export const settingsValues: SettingsValues = {
  appearance: 'system',
  openAtLogin: false,
  startServerAtLogin: 'none',
  keepRunningOnQuit: false,
  restartOnCrash: true,
  preventSleep: true,
  defaultModel: 'incoai/Qwen3.8-27B-Splash',
  thinking: 'medium',
  samplingPreset: 'sampling-thinking',
  sampling: { ...samplingPresets[0]!.values },
  maxTokens: 32768,
  seed: null,
  hfToken: 'hf_demo_token_for_previews',
  downloadFolder: '~/.cache/huggingface/hub',
  checkForUpdatesAutomatically: true,
};

export const settingsInfo: SettingsInfo = {
  models: [
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
    {
      value: 'mlx-community/Qwen3.8-27B-4bit',
      label: 'Qwen3.8-27B (MLX 4-bit)',
      description: 'mlx-community · 15.6 GB',
    },
  ],
  samplingPresets,
  hfToken: { state: 'signed-in', user: 'ada' },
  modelsDiskUsed: '53.6 GB',
  modelsCount: 3,
  diskFree: '412 GB',
  splash: {
    version: '1.2.0',
    update: { state: 'up-to-date', latest: '1.2.0', checkedAt: 'today at 11:02' },
  },
  app: {
    version: '0.1.0',
    update: { state: 'up-to-date', latest: '0.1.0', checkedAt: 'today at 11:02' },
  },
  mac: 'MacBook Pro · M3 Max · 64 GB',
  server: '127.0.0.1:8000',
  license: 'Apache-2.0',
  links: [
    {
      label: 'Splash on GitHub',
      help: 'Server settings, the API and the agents, documented.',
      url: 'https://github.com/incoai/splash',
    },
  ],
};

/** A tuned sampling set that matches no preset ("Custom"). */
export const settingsValuesCustom: SettingsValues = {
  ...settingsValues,
  samplingPreset: 'custom',
  sampling: { ...settingsValues.sampling, temperature: 0.6, minP: 0.05 },
};

export const settingsInfoUpdateAvailable: SettingsInfo = {
  ...settingsInfo,
  hfToken: { state: 'none' },
  splash: { version: '1.2.0', update: { state: 'available', latest: '1.2.1' } },
};
