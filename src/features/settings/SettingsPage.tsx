import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTheme } from '@/app/theme/useTheme';
import { toast } from '@/components/ui/Toast';
import { useInstallStore } from '@/lib/install/store';
import { useLaunchStore } from '@/lib/launch';
import { formatLabel, gigabytes, runnableModels } from '@/lib/models/runnable';
import { useModelsStore } from '@/lib/models/store';
import type { ChatSettings, ThinkingLevel as ChatThinking } from '@/lib/splash/request';
import { useEngineStore } from '@/lib/splash/engine-store';
import { getStorage } from '@/lib/storage';
import { useChatStore } from '@/lib/chat/store';
import { samplingPresets } from './views/fixtures';
import { SettingsDialog } from './views/SettingsDialog';
import type {
  HfTokenStatus,
  SettingsInfo,
  SettingsValues,
  ThinkingLevel,
  UpdateStatus,
} from './views/types';

const APP_SETTINGS_KEY = 'app.settings';
const APP_VERSION = '0.1.0';

const TO_CHAT: Record<ThinkingLevel, ChatThinking> = {
  none: 'off',
  low: 'low',
  medium: 'medium',
  xhigh: 'high',
};
const FROM_CHAT: Record<ChatThinking, ThinkingLevel> = {
  off: 'none',
  on: 'xhigh',
  low: 'low',
  medium: 'medium',
  high: 'xhigh',
};

function initialValues(defaults: ChatSettings, model: string): SettingsValues {
  const preset = samplingPresets[0]!;
  return {
    appearance: 'system',
    openAtLogin: false,
    startServerAtLogin: 'none',
    keepRunningOnQuit: false,
    restartOnCrash: true,
    preventSleep: true,
    defaultModel: model,
    thinking: FROM_CHAT[defaults.thinking ?? 'high'],
    samplingPreset: preset.id,
    sampling: {
      temperature: defaults.temperature ?? preset.values.temperature,
      topP: defaults.top_p ?? preset.values.topP,
      topK: defaults.top_k ?? preset.values.topK,
      minP: defaults.min_p ?? preset.values.minP,
      presencePenalty: defaults.presence_penalty ?? preset.values.presencePenalty,
      frequencyPenalty: defaults.frequency_penalty ?? preset.values.frequencyPenalty,
      repetitionPenalty: defaults.repetition_penalty ?? preset.values.repetitionPenalty,
    },
    maxTokens: defaults.max_tokens ?? 32768,
    seed: defaults.seed ?? null,
    hfToken: '',
    downloadFolder: '~/.cache/huggingface/hub',
    checkForUpdatesAutomatically: true,
  };
}

function checkedAt(ms: number): string {
  return `today at ${new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function SettingsPage() {
  const navigate = useNavigate();
  const { preference, setPreference } = useTheme();
  const chatDefaults = useChatStore((s) => s.defaults);
  const launchModel = useLaunchStore((s) => s.model);
  const installed = useModelsStore((s) => s.installed);
  const catalog = useModelsStore((s) => s.catalog);
  const token = useModelsStore((s) => s.token);
  const install = useEngineStore((s) => s.install);
  const latest = useInstallStore((s) => s.latest);
  const checking = useInstallStore((s) => s.checkingLatest);
  const [values, setValues] = useState<SettingsValues>(() => ({
    ...initialValues(chatDefaults, launchModel),
    appearance: preference,
  }));

  useEffect(() => {
    void useModelsStore.getState().loadToken();
    void useChatStore.getState().load();
    void getStorage()
      .settings.get<Partial<SettingsValues>>(APP_SETTINGS_KEY)
      .then((saved) => {
        if (saved) setValues((current) => ({ ...current, ...saved, hfToken: '' }));
      })
      .catch(() => undefined);
  }, []);

  const onChange = (patch: Partial<SettingsValues>) => {
    setValues((current) => {
      const next = { ...current, ...patch };
      const { hfToken: _token, ...persisted } = next;
      void getStorage().settings.set(APP_SETTINGS_KEY, persisted).catch(() => undefined);
      return next;
    });
    if (patch.appearance) setPreference(patch.appearance);
    if (patch.defaultModel) useLaunchStore.getState().update({ model: patch.defaultModel });
    const chat: Partial<ChatSettings> = {};
    if (patch.thinking) chat.thinking = TO_CHAT[patch.thinking];
    if (patch.sampling) {
      chat.temperature = patch.sampling.temperature;
      chat.top_p = patch.sampling.topP;
      chat.top_k = patch.sampling.topK;
      chat.min_p = patch.sampling.minP;
      chat.presence_penalty = patch.sampling.presencePenalty;
      chat.frequency_penalty = patch.sampling.frequencyPenalty;
      chat.repetition_penalty = patch.sampling.repetitionPenalty;
    }
    if (patch.maxTokens !== undefined) chat.max_tokens = patch.maxTokens;
    if (patch.seed !== undefined) chat.seed = patch.seed;
    if (Object.keys(chat).length) useChatStore.getState().setDefaults(chat);
  };

  const runnable = useMemo(() => runnableModels(installed, catalog?.entries), [installed, catalog]);
  const hfToken: HfTokenStatus = !token
    ? { state: 'checking' }
    : !token.hasToken
      ? { state: 'none' }
      : token.valid === false
        ? { state: 'invalid', message: token.error ?? undefined }
        : { state: 'signed-in', user: token.username ?? 'Hugging Face' };
  const splashUpdate: UpdateStatus = checking
    ? { state: 'checking' }
    : latest?.upgradeAvailable && latest.latest
      ? { state: 'available', latest: latest.latest }
      : latest?.latest
        ? { state: 'up-to-date', latest: latest.latest, checkedAt: checkedAt(latest.checkedAtMs) }
        : { state: 'up-to-date', latest: install?.version ?? '—', checkedAt: 'not yet' };
  const memory = install?.system.memoryBytes ? `${Math.round(install.system.memoryBytes / 1024 ** 3)} GB` : '';

  const info: SettingsInfo = {
    models: runnable.map((m) => ({
      value: m.model,
      label: m.name,
      description: `${formatLabel(m.format)} · ${gigabytes(m.sizeBytes)}`,
    })),
    samplingPresets,
    hfToken,
    modelsDiskUsed: gigabytes(installed?.cachedBytes) || '0 GB',
    modelsCount: runnable.length,
    splash: { version: install?.version ?? 'not installed', update: splashUpdate },
    app: { version: APP_VERSION, update: { state: 'up-to-date', latest: APP_VERSION, checkedAt: 'not yet' } },
    mac: [install?.system.chip, memory].filter(Boolean).join(' · ') || 'This Mac',
    server: `127.0.0.1:${useLaunchStore.getState().port}`,
    license: 'Apache-2.0',
    links: [
      { label: 'Splash on GitHub', help: 'The engine: server options, the API and the agents.', url: 'https://github.com/incoai/splash' },
    ],
  };

  return (
    <SettingsDialog
      open
      onOpenChange={(open) => {
        if (!open) void navigate(-1);
      }}
      values={values}
      onChange={(patch) => {
        if (patch.hfToken !== undefined) {
          setValues((current) => ({ ...current, hfToken: patch.hfToken ?? '' }));
          return;
        }
        onChange(patch);
      }}
      info={info}
      onTestToken={() => {
        const value = values.hfToken.trim();
        if (!value) return;
        void useModelsStore
          .getState()
          .saveToken(value, true)
          .then((status) => {
            setValues((current) => ({ ...current, hfToken: '' }));
            if (!status?.valid) toast('Hugging Face did not accept that token.', { tone: 'error' });
          });
      }}
      onManageModels={() => void navigate('/models')}
      onCheckForUpdates={() => void useInstallStore.getState().checkLatest()}
      onUpdateSplash={() =>
        void useInstallStore
          .getState()
          .run('upgrade')
          .then((result) => {
            if (result) void useEngineStore.getState().detect();
          })
      }
      onOpenLink={(url) =>
        void import('@tauri-apps/plugin-opener')
          .then(({ openUrl }) => openUrl(url))
          .catch(() => window.open(url, '_blank', 'noopener'))
      }
    />
  );
}
