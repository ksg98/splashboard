import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from '@/components/ui/Toast';
import { displayModelName, engineWord, restartEngine, startEngine, useLaunchStore } from '@/lib/launch';
import {

  gigabytes,
  isOfferedEntry,
  runnableModels,
  type RunnableModel,
} from '@/lib/models/runnable';
import { downloadFraction, isDownloadActive, useModelsStore, type DownloadState } from '@/lib/models/store';
import type { CatalogEntry } from '@/lib/models/types';
import type { ServeValues } from '@/lib/params/types';
import { useEngineStore } from '@/lib/splash/engine-store';
import { useTelemetryStore } from '@/lib/telemetry';
import {
  CUSTOM_PRESET,
  fromSheetValue,
  launchCommand,
  launchSections,
  presetPicker,
  withPreset,
} from './launchForm';
import { LaunchSettingsSheet } from './views/LaunchSettingsSheet';
import { ModelsView } from './views/ModelsView';
import type { ModelRowAction, ModelRowData, ModelSearch, RunningModel } from './views/types';

function contextLabel(tokens: number | null | undefined): string {
  if (!tokens) return '';
  return `${tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : tokens} context`;
}

function downloadAction(download: DownloadState): ModelRowAction {
  const fraction = downloadFraction(download) ?? 0;
  const progress = download.progress;
  const done =
    progress && progress.bytesTotal > 0
      ? `${gigabytes(progress.bytesDone)} of ${gigabytes(progress.bytesTotal)}`
      : 'Starting…';
  const eta =
    progress?.eta != null && progress.eta > 0
      ? `about ${Math.max(1, Math.round(progress.eta / 60))} min`
      : undefined;
  return { kind: 'downloading', progress: fraction, done, eta };
}

function rowFor(
  model: string,
  name: string,
  format: 'package' | 'mlx',
  description: string,
  size: number | null,
  action: ModelRowAction,
): ModelRowData {
  return {
    id: model,
    name: name.replace(/ \(MLX 4-bit\)$/, ''),
    variant: format === 'mlx' ? 'MLX 4-bit' : undefined,
    description,
    size: gigabytes(size),
    quant: '4-bit',
    format: format === 'package' ? 'splash' : 'mlx',
    repo: model,
    action,
  };
}

function entryDescription(entry: CatalogEntry | undefined, publisher: string): string {
  return [publisher, entry?.description].filter(Boolean).join(' · ');
}

export function ModelsPage() {
  const [params, setParams] = useSearchParams();
  const installed = useModelsStore((s) => s.installed);
  const catalog = useModelsStore((s) => s.catalog);
  const downloads = useModelsStore((s) => s.downloads);
  const engineState = useEngineStore((s) => s.state);
  const install = useEngineStore((s) => s.install);
  const launch = useLaunchStore();
  const live = useTelemetryStore((s) => s.tracker.live);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<{ model: string; values: ServeValues; preset: string } | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    void useModelsStore.getState().refreshAll();
    void useLaunchStore.getState().load();
  }, []);

  const word = engineWord(engineState);
  const runningRepo = engineState.model ?? launch.model;
  const runnable = useMemo(() => runnableModels(installed, catalog?.entries), [installed, catalog]);
  const activeDownloads = useMemo(
    () => Object.values(downloads).filter(isDownloadActive),
    [downloads],
  );
  const version = install?.version ?? null;
  const ramBytes = install?.system.memoryBytes ?? null;
  const gpuBudgetBytes = install?.system.metalWorkingSetBytes ?? null;

  // The sheet is open while the URL says ?launch=<model> (the engine popover links here).
  const launchParam = params.get('launch');
  const sheetModel = launchParam === '1' ? launch.model : launchParam;
  const sheet =
    sheetModel === null
      ? null
      : draft && draft.model === sheetModel
        ? draft
        : {
            model: sheetModel,
            values: { ...launch.values, model: sheetModel, port: launch.port } as ServeValues,
            preset: CUSTOM_PRESET,
          };
  const setSheet = (
    update:
      | { model: string; values: ServeValues; preset: string }
      | null
      | ((current: { model: string; values: ServeValues; preset: string } | null) => {
          model: string;
          values: ServeValues;
          preset: string;
        } | null),
  ) => {
    const next = typeof update === 'function' ? update(sheet) : update;
    setDraft(next);
    const nextParams = new URLSearchParams(params);
    if (next) nextParams.set('launch', next.model);
    else nextParams.delete('launch');
    if (nextParams.toString() !== params.toString()) setParams(nextParams, { replace: true });
  };
  const openSheet = (model: string) =>
    setSheet({
      model,
      values: { ...launch.values, model, port: launch.port },
      preset: CUSTOM_PRESET,
    });

  const running: RunningModel | null =
    word.serving || word.launching
      ? {
          id: runningRepo,
          name: displayModelName(runningRepo).replace(/ \(MLX 4-bit\)$/, ''),
          format: /-splash$/i.test(runningRepo) ? 'splash' : 'mlx',
          size: gigabytes(runnable.find((m) => m.model === runningRepo)?.sizeBytes),
          context: contextLabel(live?.contextTokens ?? engineState.readyInfo?.contextTokens),
          repo: runningRepo,
          state: engineState.phase === 'busy' ? 'busy' : word.launching ? 'starting' : 'ready',
        }
      : null;

  const installedRows = runnable
    .filter((model) => !(running && model.model === running.id))
    .map((model: RunnableModel) => {
      const download = activeDownloads.find((d) => d.model === model.model);
      return rowFor(
        model.model,
        model.name,
        model.format,
        entryDescription(catalog?.entries.find((e) => e.id === model.model), model.publisher),
        model.sizeBytes,
        download ? downloadAction(download) : { kind: 'run' },
      );
    });

  const installedIds = new Set(runnable.map((m) => m.model));
  const needle = query.trim().toLowerCase();
  const availableRows = (catalog?.entries ?? [])
    .filter(isOfferedEntry)
    .filter((entry) => !installedIds.has(entry.id))
    .filter((entry) => !needle || `${entry.id} ${entry.label}`.toLowerCase().includes(needle))
    .map((entry) => {
      const download = activeDownloads.find((d) => d.model === entry.id);
      const fits =
        !entry.minRamGb || !ramBytes || entry.minRamGb * 1024 ** 3 <= ramBytes * 1.02;
      const action: ModelRowAction = download
        ? downloadAction(download)
        : fits
          ? { kind: 'get' }
          : { kind: 'incompatible', reason: `Needs a Mac with ${entry.minRamGb} GB` };
      return rowFor(
        entry.id,
        displayModelName(entry.id),
        entry.format === 'package' ? 'package' : 'mlx',
        entryDescription(entry, entry.repo.split('/')[0] ?? ''),
        entry.sizeBytes,
        action,
      );
    });

  const search: ModelSearch = { query, status: needle ? 'results' : 'idle', results: [] };

  const report = (result: unknown, fallback: string) => {
    if (!result) toast(useEngineStore.getState().error?.message ?? fallback, { tone: 'error' });
  };

  const run = (model: string) => {
    useLaunchStore.getState().update({ model });
    const action = word.serving || word.launching ? restartEngine() : startEngine(model);
    void action.then((result) => report(result, `Couldn't start ${displayModelName(model)}.`));
  };

  const sections = sheet
    ? launchSections({
        values: sheet.values,
        saved: launch.values,
        models: runnable,
        version,
        ramBytes,
        gpuBudgetBytes,
      })
    : [];
  const command = sheet ? launchCommand(sheet.values, version) : { command: '', error: null };
  const dirty = sheet
    ? JSON.stringify({ ...sheet.values }) !==
      JSON.stringify({ ...launch.values, model: sheet.model, port: launch.port })
    : false;

  return (
    <>
      <ModelsView
        diskUsage={installed ? gigabytes(installed.cachedBytes) : null}
        downloadsFolder={installed?.hfCacheDir ?? '~/.cache/huggingface/hub'}
        running={running}
        installed={installedRows}
        available={availableRows}
        search={search}
        onSearchChange={setQuery}
        onOpenLaunchSettings={openSheet}
        onStart={() => void startEngine().then((r) => report(r, 'Splash could not start.'))}
        onStop={() => void useEngineStore.getState().stop().then((r) => report(r, 'Splash could not stop.'))}
        onRun={run}
        onGet={(model) =>
          void useModelsStore
            .getState()
            .download({ model })
            .then((result) => {
              if (!result) toast(`Couldn't download ${displayModelName(model)}.`, { tone: 'error' });
            })
        }
        onCancelDownload={(model) => void useModelsStore.getState().cancelDownload(model)}
        onStopModel={() => void useEngineStore.getState().stop()}
      />
      {sheet && (
        <LaunchSettingsSheet
          open
          title="Launch settings"
          subtitle={`${displayModelName(sheet.model)} · ${sheet.model}`}
          preset={presetPicker(ramBytes, version, sheet.preset)}
          sections={sections}
          command={command.command || command.error || ''}
          dirty={dirty}
          commandOpen={commandOpen}
          onCommandOpenChange={setCommandOpen}
          onChange={(key, value) =>
            setSheet((current) =>
              current
                ? {
                    ...current,
                    preset: CUSTOM_PRESET,
                    model: key === 'model' && typeof value === 'string' ? value : current.model,
                    values: { ...current.values, [key]: fromSheetValue(key, value, sections) as ServeValues[string] },
                  }
                : current,
            )
          }
          onPresetChange={(preset) =>
            setSheet((current) =>
              current
                ? {
                    ...current,
                    preset,
                    values:
                      preset === CUSTOM_PRESET
                        ? current.values
                        : withPreset(current.values, preset, ramBytes, version),
                  }
                : current,
            )
          }
          onCancel={() => setSheet(null)}
          saveDisabled={!!command.error}
          footerNote={command.error ?? undefined}
          primaryLabel={word.serving || word.launching ? 'Save and restart' : 'Save'}
          onSave={() => {
            const { model, port, ...rest } = sheet.values;
            useLaunchStore.getState().update({
              model: typeof model === 'string' ? model : sheet.model,
              port: typeof port === 'number' ? port : launch.port,
              values: rest,
            });
            setSheet(null);
            if (word.serving || word.launching) {
              void restartEngine().then((r) => report(r, 'Splash could not restart.'));
            }
          }}
        />
      )}
    </>
  );
}

