import type { GalleryEntry } from '@/app/gallery/types';
import { DownloadSheet } from './DownloadSheet';
import {
  DEMO_ADDRESS,
  DEMO_MAC,
  DEMO_MAC_TOO_OLD,
  DEMO_PARTIAL_DOWNLOAD,
  DEMO_START_PROGRESS,
  DOWNLOAD_CHECKING,
  DOWNLOAD_FAILED,
  DOWNLOAD_LOG,
  DOWNLOAD_LOG_FAILED,
  DOWNLOAD_PAUSED,
  DOWNLOAD_RUNNING,
  INSTALL_FAILED,
  INSTALL_LOG_FAILED,
  INSTALL_LOG_RUNNING,
  INSTALL_LOG_SUCCEEDED,
  INSTALL_NO_HOMEBREW,
  INSTALL_RUNNING,
  INSTALL_SUCCEEDED,
  QWEN_27B,
  SPLASH_VERSION,
} from './fixtures';
import { InstallSheet } from './InstallSheet';
import { FirstRunWalkthrough, ModelChoiceDemo } from './onboarding.demos';
import { Welcome, type WelcomeProps } from './Welcome';

const noop = () => undefined;
const GROUP = 'Onboarding';

const base: WelcomeProps = {
  step: 'install',
  model: QWEN_27B,
  mac: DEMO_MAC,
  splashVersion: SPLASH_VERSION,
  address: DEMO_ADDRESS,
  onInstall: noop,
  onDownload: noop,
  onChooseModel: noop,
  onStart: noop,
  onOpenChat: noop,
};

const installSheet = (props: Partial<Parameters<typeof InstallSheet>[0]>) => (
  <InstallSheet
    state={INSTALL_RUNNING}
    log={INSTALL_LOG_RUNNING}
    onCancel={noop}
    onRetry={noop}
    onContinue={noop}
    onOpenTerminal={noop}
    onOpenHomebrewSite={noop}
    {...props}
  />
);

const downloadSheet = (props: Partial<Parameters<typeof DownloadSheet>[0]>) => (
  <DownloadSheet
    model={QWEN_27B}
    state={DOWNLOAD_RUNNING}
    log={DOWNLOAD_LOG}
    onCancel={noop}
    onResume={noop}
    onRetry={noop}
    onClose={noop}
    {...props}
  />
);

export const gallery: GalleryEntry[] = [
  {
    id: 'first-run',
    title: 'First run · 1 Install Splash',
    group: GROUP,
    frame: 'window',
    render: () => <Welcome {...base} />,
  },
  {
    id: 'first-run-install',
    title: 'First run · Install sheet, downloading',
    group: GROUP,
    frame: 'window',
    render: () => <Welcome {...base} sheet={installSheet({})} />,
  },
  {
    id: 'first-run-install-details',
    title: 'First run · Install sheet, details open (live log)',
    group: GROUP,
    frame: 'window',
    render: () => <Welcome {...base} sheet={installSheet({ logOpen: true })} />,
  },
  {
    id: 'first-run-install-done',
    title: 'First run · Install sheet, installed',
    group: GROUP,
    frame: 'window',
    render: () => (
      <Welcome
        {...base}
        sheet={installSheet({ state: INSTALL_SUCCEEDED, log: INSTALL_LOG_SUCCEEDED })}
      />
    ),
  },
  {
    id: 'first-run-install-failed',
    title: 'First run · Install sheet, failed (log open, Copy log)',
    group: GROUP,
    frame: 'window',
    render: () => (
      <Welcome {...base} sheet={installSheet({ state: INSTALL_FAILED, log: INSTALL_LOG_FAILED })} />
    ),
  },
  {
    id: 'first-run-install-no-homebrew',
    title: 'First run · Homebrew isn’t installed',
    group: GROUP,
    frame: 'window',
    render: () => (
      <Welcome {...base} sheet={installSheet({ state: INSTALL_NO_HOMEBREW, log: [] })} />
    ),
  },
  {
    id: 'first-run-download',
    title: 'First run · 2 Download a model',
    group: GROUP,
    frame: 'window',
    render: () => <Welcome {...base} step="download" />,
  },
  {
    id: 'first-run-model-choice',
    title: 'First run · Choose a model',
    group: GROUP,
    frame: 'window',
    render: () => <ModelChoiceDemo />,
  },
  {
    id: 'first-run-download-sheet',
    title: 'First run · Download sheet',
    group: GROUP,
    frame: 'window',
    render: () => <Welcome {...base} step="download" sheet={downloadSheet({})} />,
  },
  {
    id: 'first-run-download-checking',
    title: 'First run · Download sheet, checking files',
    group: GROUP,
    frame: 'window',
    render: () => (
      <Welcome {...base} step="download" sheet={downloadSheet({ state: DOWNLOAD_CHECKING })} />
    ),
  },
  {
    id: 'first-run-download-paused',
    title: 'First run · Download sheet, paused (Resume)',
    group: GROUP,
    frame: 'window',
    render: () => (
      <Welcome {...base} step="download" sheet={downloadSheet({ state: DOWNLOAD_PAUSED })} />
    ),
  },
  {
    id: 'first-run-download-failed',
    title: 'First run · Download sheet, failed',
    group: GROUP,
    frame: 'window',
    render: () => (
      <Welcome
        {...base}
        step="download"
        sheet={downloadSheet({ state: DOWNLOAD_FAILED, log: DOWNLOAD_LOG_FAILED })}
      />
    ),
  },
  {
    id: 'first-run-download-resume',
    title: 'First run · 2 Download paused, Resume download',
    group: GROUP,
    frame: 'window',
    render: () => <Welcome {...base} step="download" partialDownload={DEMO_PARTIAL_DOWNLOAD} />,
  },
  {
    id: 'first-run-start',
    title: 'First run · 3 Start',
    group: GROUP,
    frame: 'window',
    render: () => <Welcome {...base} step="start" />,
  },
  {
    id: 'first-run-starting',
    title: 'First run · 3 Starting (Loading weights · 12 s)',
    group: GROUP,
    frame: 'window',
    render: () => <Welcome {...base} step="start" starting={DEMO_START_PROGRESS} />,
  },
  {
    id: 'first-run-ready',
    title: 'First run · Ready, hands off to chat',
    group: GROUP,
    frame: 'window',
    render: () => <Welcome {...base} step="done" />,
  },
  {
    id: 'first-run-unsupported',
    title: 'First run · This Mac can’t run Splash',
    group: GROUP,
    frame: 'window',
    render: () => <Welcome {...base} mac={DEMO_MAC_TOO_OLD} />,
  },
  {
    id: 'first-run-walkthrough',
    title: 'First run · Walkthrough (clickable)',
    group: GROUP,
    frame: 'window',
    render: () => <FirstRunWalkthrough />,
  },
];
