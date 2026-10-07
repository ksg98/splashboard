import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { connectInstallEvents, selectNeedsHomebrew, useInstallStore } from '@/lib/install/store';
import { DEFAULT_MODEL, displayModelName, engineWord, launchPhaseWord, startEngine, useLaunchStore } from '@/lib/launch';
import { isOfferedEntry, runnableModels } from '@/lib/models/runnable';
import { connectModelsEvents, isDownloadActive, useModelsStore } from '@/lib/models/store';
import { connectEngineEvents, useEngineStore } from '@/lib/splash/engine-store';
import { useNow } from '@/lib/useNow';
import { markOnboardingCompleted } from './start';
import { DownloadSheet } from './views/DownloadSheet';
import { InstallSheet } from './views/InstallSheet';
import { ModelChoice } from './views/ModelChoice';
import type { DownloadState, FirstRunStep, InstallState, ModelOption } from './views/types';
import { Welcome } from './views/Welcome';

type Sheet = 'install' | 'choose' | 'download' | null;

const FALLBACK_SIZES: Record<string, number> = {
  'incoai/Qwen3.8-27B-Splash': 17.6 * 1024 ** 3,
  'incoai/Qwen3.6-35B-A3B-Splash': 20.4 * 1024 ** 3,
};

export function WelcomePage() {
  const navigate = useNavigate();
  const now = useNow();
  const status = useInstallStore((s) => s.status);
  const job = useInstallStore((s) => s.job);
  const needsHomebrew = useInstallStore(selectNeedsHomebrew);
  const installed = useModelsStore((s) => s.installed);
  const catalog = useModelsStore((s) => s.catalog);
  const downloads = useModelsStore((s) => s.downloads);
  const engineState = useEngineStore((s) => s.state);
  const install = useEngineStore((s) => s.install);
  const launchModel = useLaunchStore((s) => s.model);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [choice, setChoice] = useState<string | null>(null);

  useEffect(() => {
    void connectInstallEvents();
    void connectModelsEvents();
    void connectEngineEvents();
    void useInstallStore.getState().refreshStatus();
    void useEngineStore.getState().detect();
    void useModelsStore.getState().refreshAll();
    void useLaunchStore.getState().load();
  }, []);

  const runnable = useMemo(() => runnableModels(installed, catalog?.entries), [installed, catalog]);
  const memoryGb = install?.system.memoryBytes ? Math.round(install.system.memoryBytes / 1024 ** 3) : 0;
  const options: ModelOption[] = useMemo(
    () =>
      (catalog?.entries ?? []).filter(isOfferedEntry).map((entry) => ({
        id: entry.id,
        name: displayModelName(entry.id),
        description: entry.description ?? '',
        sizeBytes: entry.sizeBytes ?? FALLBACK_SIZES[entry.id] ?? 0,
        quant: '4-bit',
        format: entry.format === 'package' ? 'Splash package' : 'MLX',
        publisher: entry.repo.split('/')[0] ?? '',
        recommended: entry.recommended,
        unavailableReason:
          entry.minRamGb && memoryGb && entry.minRamGb > memoryGb
            ? `Needs a Mac with ${entry.minRamGb} GB`
            : undefined,
      })),
    [catalog, memoryGb],
  );

  const chosenId = choice ?? (runnable[0]?.model ?? (options.find((o) => o.recommended)?.id ?? DEFAULT_MODEL));
  const chosen = options.find((o) => o.id === chosenId) ?? {
    id: chosenId,
    name: displayModelName(chosenId),
    description: '',
    sizeBytes: FALLBACK_SIZES[chosenId] ?? 0,
    quant: '4-bit',
    format: 'Splash package' as const,
    publisher: chosenId.split('/')[0] ?? '',
  };

  const word = engineWord(engineState);
  const splashInstalled = status?.installed ?? install?.found ?? false;
  const download = Object.values(downloads).find((d) => d.model === chosen.id);
  const step: FirstRunStep = !splashInstalled
    ? 'install'
    : runnable.length === 0
      ? 'download'
      : word.serving
        ? 'done'
        : 'start';

  const installState: InstallState = needsHomebrew
    ? { kind: 'no-homebrew' }
    : job?.phase === 'done'
      ? { kind: 'succeeded', version: status?.version ?? '' }
      : job?.phase === 'failed' || job?.phase === 'cancelled'
        ? { kind: 'failed', message: job.error?.message ?? job.result?.error ?? 'Homebrew stopped.' }
        : { kind: 'running', phase: job?.phase ?? 'starting', progress: null };

  const downloadState: DownloadState = !download
    ? { kind: 'working', label: 'Starting the download…' }
    : download.error
      ? { kind: 'failed', message: download.error.message }
      : download.progress && download.progress.bytesTotal > 0
        ? {
            kind: isDownloadActive(download) ? 'downloading' : 'paused',
            receivedBytes: download.progress.bytesDone,
            totalBytes: download.progress.bytesTotal,
            bytesPerSecond: download.progress.speed,
            secondsLeft: download.progress.eta,
          }
        : { kind: 'working', label: 'Checking files…' };

  const runInstall = () => {
    setSheet('install');
    void useInstallStore
      .getState()
      .run('install')
      .then(() => {
        void useInstallStore.getState().refreshStatus();
        void useEngineStore.getState().detect();
      });
  };
  const runDownload = () => {
    setSheet('download');
    void useModelsStore
      .getState()
      .download({ model: chosen.id })
      .then((result) => {
        if (result) {
          void useModelsStore.getState().loadInstalled();
          setSheet(null);
        }
      });
  };

  const sheetNode =
    sheet === 'install' ? (
      <InstallSheet
        state={installState}
        log={job?.lines.map((l) => l.line) ?? []}
        onCancel={() => {
          if (installState.kind === 'running') void useInstallStore.getState().cancel();
          else setSheet(null);
        }}
        onRetry={runInstall}
        onContinue={() => setSheet(null)}
        onOpenHomebrewSite={() =>
          void import('@tauri-apps/plugin-opener')
            .then(({ openUrl }) => openUrl('https://brew.sh'))
            .catch(() => window.open('https://brew.sh', '_blank', 'noopener'))
        }
      />
    ) : sheet === 'choose' ? (
      <ModelChoice
        options={options}
        value={chosen.id}
        onChange={setChoice}
        onConfirm={runDownload}
        onCancel={() => setSheet(null)}
        memoryGb={memoryGb || undefined}
      />
    ) : sheet === 'download' ? (
      <DownloadSheet
        model={{ id: chosen.id, name: chosen.name }}
        state={downloadState}
        log={download?.log.map((l) => l.line) ?? []}
        folder={installed?.hfCacheDir ?? undefined}
        onCancel={() => void useModelsStore.getState().cancelDownload(chosen.id)}
        onResume={runDownload}
        onRetry={runDownload}
        onClose={() => setSheet(null)}
      />
    ) : null;

  return (
    <>
      <Welcome
        step={step}
        model={chosen}
        mac={{
          model: 'Mac',
          chip: install?.system.chip ?? 'Apple silicon',
          memoryGb,
          macos: install?.system.macosVersion ?? '',
          ready: install?.system.arch !== 'x86_64',
        }}
        splashVersion={status?.version ?? install?.version ?? undefined}
        starting={
          word.launching
            ? {
                phase: launchPhaseWord(engineState.phase) ?? 'Starting',
                seconds: Math.max(0, Math.round((now - engineState.sinceMs) / 1000)),
                progress: null,
              }
            : null
        }
        address={`127.0.0.1:${engineState.port ?? useLaunchStore.getState().port}`}
        onInstall={runInstall}
        onDownload={runDownload}
        onChooseModel={() => setSheet('choose')}
        onStart={() => void startEngine(runnable.some((m) => m.model === launchModel) ? launchModel : chosen.id)}
        onOpenChat={() => {
          void markOnboardingCompleted().then(() => navigate('/chat'));
        }}
        sheet={sheetNode}
      />
    </>
  );
}
