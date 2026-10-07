/**
 * Stateful wrappers for the gallery only. They hold the bits of local state a
 * static fixture can't (the chosen model, which sheet is up) so entries can
 * be clicked through. The walkthrough fakes progress with short timers; real
 * progress comes from the data layer through props.
 */
import { useEffect, useState } from 'react';
import { DownloadSheet } from './DownloadSheet';
import {
  DEMO_ADDRESS,
  DEMO_MAC,
  DEMO_MODELS,
  DEMO_START_PROGRESS,
  DOWNLOAD_LOG,
  INSTALL_LOG_RUNNING,
  INSTALL_LOG_SUCCEEDED,
  INSTALL_RUNNING,
  QWEN_27B,
  SPLASH_VERSION,
} from './fixtures';
import { InstallSheet } from './InstallSheet';
import { ModelChoice } from './ModelChoice';
import type { DownloadState, FirstRunStep, InstallState, ModelOption } from './types';
import { Welcome } from './Welcome';

const noop = () => undefined;

/** The model choice over step 2; choosing a row renames the step and the button. */
export function ModelChoiceDemo({ initial = QWEN_27B.id }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const chosen = DEMO_MODELS.find((model) => model.id === value) ?? QWEN_27B;
  return (
    <Welcome
      step="download"
      model={chosen}
      mac={DEMO_MAC}
      splashVersion={SPLASH_VERSION}
      onDownload={noop}
      onChooseModel={noop}
      sheet={
        <ModelChoice
          options={DEMO_MODELS}
          value={value}
          onChange={setValue}
          onConfirm={noop}
          onCancel={noop}
          memoryGb={DEMO_MAC.memoryGb}
        />
      }
    />
  );
}

type Sheet = 'none' | 'install' | 'choose' | 'download';

function downloadingState(model: ModelOption, received = 0): DownloadState {
  return {
    kind: 'downloading',
    receivedBytes: received,
    totalBytes: model.sizeBytes,
    bytesPerSecond: 52_000_000,
    secondsLeft: (model.sizeBytes - received) / 52_000_000,
  };
}

/** The whole first run, clickable from Install Splash to Start chatting. */
export function FirstRunWalkthrough() {
  const [step, setStep] = useState<FirstRunStep>('install');
  const [sheet, setSheet] = useState<Sheet>('none');
  const [install, setInstall] = useState<InstallState>(INSTALL_RUNNING);
  const [modelId, setModelId] = useState(QWEN_27B.id);
  const model: ModelOption = DEMO_MODELS.find((option) => option.id === modelId) ?? QWEN_27B;
  const [download, setDownload] = useState<DownloadState>(downloadingState(model));
  const [starting, setStarting] = useState(false);

  // Install finishes 2 s after it starts.
  useEffect(() => {
    if (sheet !== 'install' || install.kind !== 'running') return;
    const timer = window.setTimeout(
      () => setInstall({ kind: 'succeeded', version: SPLASH_VERSION }),
      2000,
    );
    return () => window.clearTimeout(timer);
  }, [sheet, install]);

  // The download moves in steps and closes itself when done.
  useEffect(() => {
    if (sheet !== 'download' || download.kind !== 'downloading') return;
    const timer = window.setTimeout(() => {
      const next = download.receivedBytes + download.totalBytes / 5;
      if (next >= download.totalBytes) {
        setSheet('none');
        setStep('start');
      } else {
        setDownload(downloadingState(model, next));
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [sheet, download, model]);

  // Start takes 2.5 s, then Ready.
  useEffect(() => {
    if (!starting) return;
    const timer = window.setTimeout(() => {
      setStarting(false);
      setStep('done');
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [starting]);

  let sheetNode = null;
  if (sheet === 'install') {
    sheetNode = (
      <InstallSheet
        state={install}
        log={install.kind === 'succeeded' ? INSTALL_LOG_SUCCEEDED : INSTALL_LOG_RUNNING}
        onCancel={() => setSheet('none')}
        onContinue={() => {
          setSheet('none');
          setStep('download');
        }}
        onRetry={() => setInstall(INSTALL_RUNNING)}
      />
    );
  } else if (sheet === 'choose') {
    sheetNode = (
      <ModelChoice
        options={DEMO_MODELS}
        value={modelId}
        onChange={setModelId}
        memoryGb={DEMO_MAC.memoryGb}
        onCancel={() => setSheet('none')}
        onConfirm={() => {
          if (step !== 'install') {
            setDownload(downloadingState(model));
            setSheet('download');
          } else {
            setSheet('none');
          }
        }}
      />
    );
  } else if (sheet === 'download') {
    sheetNode = (
      <DownloadSheet
        model={model}
        state={download}
        log={DOWNLOAD_LOG}
        onCancel={() =>
          download.kind === 'downloading' &&
          setDownload({
            kind: 'paused',
            receivedBytes: download.receivedBytes,
            totalBytes: download.totalBytes,
          })
        }
        onResume={() =>
          download.kind === 'paused' && setDownload(downloadingState(model, download.receivedBytes))
        }
        onClose={() => setSheet('none')}
      />
    );
  }

  const partial =
    sheet !== 'download' && download.kind === 'paused'
      ? { receivedBytes: download.receivedBytes, totalBytes: download.totalBytes }
      : null;

  return (
    <Welcome
      step={step}
      model={model}
      mac={DEMO_MAC}
      splashVersion={SPLASH_VERSION}
      partialDownload={partial}
      starting={starting ? DEMO_START_PROGRESS : null}
      address={DEMO_ADDRESS}
      onInstall={() => {
        setInstall(INSTALL_RUNNING);
        setSheet('install');
      }}
      onChooseModel={() => setSheet('choose')}
      onDownload={() => {
        if (download.kind !== 'paused') setDownload(downloadingState(model));
        else setDownload(downloadingState(model, download.receivedBytes));
        setSheet('download');
      }}
      onStart={() => setStarting(true)}
      onOpenChat={() => {
        setStep('install');
        setDownload(downloadingState(model));
      }}
      sheet={sheetNode}
    />
  );
}
