/**
 * Demo props for the first-run views (gallery and tests). The values match
 * the reference: a MacBook Pro M3 Max with 64 GB, Splash 1.2.0, Qwen3.8-27B.
 * Splash runs Splash packages and MLX 4-bit models only.
 */
import type {
  DownloadState,
  InstallState,
  MacInfo,
  ModelOption,
  PartialDownload,
  StartProgress,
} from './types';

export const DEMO_MAC: MacInfo = {
  model: 'MacBook Pro',
  chip: 'M3 Max',
  memoryGb: 64,
  macos: '26.4',
  ready: true,
};

export const DEMO_MAC_TOO_OLD: MacInfo = {
  ...DEMO_MAC,
  macos: '26.1',
  ready: false,
  problem: 'Splash needs macOS 26.4 or newer. This Mac has macOS 26.1.',
};

export const SPLASH_VERSION = '1.2.0';
export const INSTALL_COMMAND = 'brew install incoai/tap/splash';
export const HOMEBREW_INSTALL_COMMAND =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
export const DOWNLOAD_FOLDER = '~/.cache/huggingface/hub';

export const QWEN_27B: ModelOption = {
  id: 'incoai/Qwen3.8-27B-Splash',
  name: 'Qwen3.8-27B',
  description: 'Inco’s package, with vision and the speed-up model built in.',
  sizeBytes: 17_600_000_000,
  quant: '4-bit',
  format: 'Splash package',
  publisher: 'Inco',
  recommended: true,
};

export const QWEN_35B: ModelOption = {
  id: 'incoai/Qwen3.6-35B-A3B-Splash',
  name: 'Qwen3.6-35B-A3B',
  description: 'Mixture of experts with 3B active. The fastest replies on this Mac.',
  sizeBytes: 20_400_000_000,
  quant: '4-bit',
  format: 'Splash package',
  publisher: 'Inco',
};

export const QWEN_27B_MLX: ModelOption = {
  id: 'mlx-community/Qwen3.8-27B-4bit',
  name: 'Qwen3.8-27B MLX 4-bit',
  description: 'A plain 4-bit conversion. Splash adds its speed-up model.',
  sizeBytes: 15_600_000_000,
  quant: '4-bit',
  format: 'MLX',
  publisher: 'mlx-community',
};

export const QWEN_27B_MLX_LMSTUDIO: ModelOption = {
  id: 'lmstudio-community/Qwen3.8-27B-MLX-4bit',
  name: 'Qwen3.8-27B MLX 4-bit (LM Studio)',
  description: 'LM Studio’s 4-bit conversion. Splash adds its speed-up model.',
  sizeBytes: 15_600_000_000,
  quant: '4-bit',
  format: 'MLX',
  publisher: 'LM Studio',
};

/** Everything first run offers, Splash packages first. */
export const DEMO_MODELS: ModelOption[] = [QWEN_27B, QWEN_35B, QWEN_27B_MLX, QWEN_27B_MLX_LMSTUDIO];

export const DEMO_START_PROGRESS: StartProgress = {
  phase: 'Loading weights',
  seconds: 12,
  progress: 0.42,
};

export const DEMO_PARTIAL_DOWNLOAD: PartialDownload = {
  receivedBytes: 8_600_000_000,
  totalBytes: 17_600_000_000,
};

export const DEMO_ADDRESS = '127.0.0.1:8000';

/* ------------------------------------------------------------- install */

export const INSTALL_RUNNING: InstallState = {
  kind: 'running',
  phase: `Downloading Splash ${SPLASH_VERSION}`,
  progress: 0.512,
  receivedBytes: 214_000_000,
  totalBytes: 418_000_000,
  secondsLeft: 28,
};

export const INSTALL_POURING: InstallState = {
  kind: 'running',
  phase: 'Installing',
  progress: null,
};

export const INSTALL_SUCCEEDED: InstallState = { kind: 'succeeded', version: SPLASH_VERSION };

export const INSTALL_FAILED: InstallState = {
  kind: 'failed',
  message:
    'The download from GitHub was interrupted. Check your internet connection and try again.',
};

export const INSTALL_NO_HOMEBREW: InstallState = { kind: 'no-homebrew' };

export const INSTALL_LOG_RUNNING: string[] = [
  '==> Tapping incoai/tap',
  "Cloning into '/opt/homebrew/Library/Taps/incoai/homebrew-tap'...",
  'Tapped 1 formula (14 files, 32.1KB).',
  '==> Fetching incoai/tap/splash',
  '==> Downloading splash-1.2.0.arm64_tahoe.bottle.tar.gz',
  '##########################################                 51.2%',
];

export const INSTALL_LOG_SUCCEEDED: string[] = [
  ...INSTALL_LOG_RUNNING.slice(0, -1),
  '######################################################################## 100.0%',
  '==> Pouring splash-1.2.0.arm64_tahoe.bottle.tar.gz',
  '==> Caveats',
  'Start a model with: splash serve --model incoai/Qwen3.8-27B-Splash',
  '==> Summary',
  '/opt/homebrew/Cellar/splash/1.2.0: 1,284 files, 418.6MB',
];

export const INSTALL_LOG_FAILED: string[] = [
  ...INSTALL_LOG_RUNNING.slice(0, -1),
  '##########################                                         37.9%',
  'curl: (56) Recv failure: Connection reset by peer',
  'Error: incoai/tap/splash: Failed to download resource "splash (1.2.0)"',
  'Download failed: https://github.com/incoai/homebrew-tap/releases/download/splash-1.2.0/splash-1.2.0.arm64_tahoe.bottle.tar.gz',
];

/* ------------------------------------------------------------ download */

export const DOWNLOAD_RUNNING: DownloadState = {
  kind: 'downloading',
  receivedBytes: 8_600_000_000,
  totalBytes: 17_600_000_000,
  bytesPerSecond: 52_000_000,
  secondsLeft: 173,
};

export const DOWNLOAD_CHECKING: DownloadState = {
  kind: 'working',
  label: 'Checking what’s already downloaded',
};

export const DOWNLOAD_PAUSED: DownloadState = {
  kind: 'paused',
  receivedBytes: 8_600_000_000,
  totalBytes: 17_600_000_000,
};

export const DOWNLOAD_FAILED: DownloadState = {
  kind: 'failed',
  message: 'Not enough space on this Mac: the rest needs 9.0 GB and 6.2 GB is free.',
  receivedBytes: 8_600_000_000,
  totalBytes: 17_600_000_000,
};

export const DOWNLOAD_LOG: string[] = [
  'Fetching 14 file(s), 17.60 GB, from incoai/Qwen3.8-27B-Splash@3f9c2a71e0b4; cached files are reused.',
];

export const DOWNLOAD_LOG_FAILED: string[] = [
  ...DOWNLOAD_LOG,
  'OSError: [Errno 28] No space left on device',
  'error: model download or verification failed',
];
