/**
 * Props-level types for the first-run views. Everything here is plain data:
 * the views never fetch, spawn or store anything themselves.
 */

/** Which of the three steps is current. `done` means all three are finished. */
export type FirstRunStep = 'install' | 'download' | 'start' | 'done';

/** This Mac, as the compatibility line shows it. */
export interface MacInfo {
  /** "MacBook Pro" */
  model: string;
  /** "M3 Max" */
  chip: string;
  memoryGb: number;
  /** "26.4" */
  macos: string;
  /** False when Splash can't run here; `problem` then says why. */
  ready: boolean;
  /** "Splash needs macOS 26.4 or newer." */
  problem?: string;
}

/** Model formats Splashboard offers. Splash runs Splash packages and MLX 4-bit models. */
export type ModelFormat = 'Splash package' | 'MLX';

/** One model the user can download on first run. */
export interface ModelOption {
  /** Hugging Face repo id, passed to `splash serve --model`, e.g. "incoai/Qwen3.8-27B-Splash". */
  id: string;
  /** Unique display title, e.g. "Qwen3.8-27B" or "Qwen3.8-27B MLX 4-bit". */
  name: string;
  /** One line, plain English. */
  description: string;
  /** Download size in bytes (decimal units are used for display, as Hugging Face reports them). */
  sizeBytes: number;
  /** "4-bit" */
  quant: string;
  format: ModelFormat;
  /** Who publishes it: "Inco", "mlx-community", "LM Studio". */
  publisher: string;
  /** Recommended for this Mac's memory. */
  recommended?: boolean;
  /** Set when the model can't be chosen on this Mac, e.g. "Needs 48 GB of memory". */
  unavailableReason?: string;
}

/** Engine start progress, from Splash's startup phases. */
export interface StartProgress {
  /** "Preparing", "Loading weights", "Warming up" */
  phase: string;
  /** Seconds since Start was pressed. */
  seconds: number;
  /** 0..1, or null when the phase gives no measure. */
  progress: number | null;
}

/** A download that was cancelled part way; Splash resumes it next time. */
export interface PartialDownload {
  receivedBytes: number;
  totalBytes: number;
}

/** What `brew install incoai/tap/splash` is doing, as the install sheet shows it. */
export type InstallState =
  | {
      kind: 'running';
      /** "Tapping incoai/tap", "Downloading Splash 1.2.0", "Installing" */
      phase: string;
      /** 0..1, or null while the phase gives no measure (indeterminate bar). */
      progress: number | null;
      receivedBytes?: number;
      totalBytes?: number;
      secondsLeft?: number | null;
    }
  | { kind: 'succeeded'; version: string }
  | {
      kind: 'failed';
      /** The last error line, in plain English where known. */
      message: string;
    }
  /** `brew` was not found; Homebrew's installer needs a password, so it runs in the built-in terminal. */
  | { kind: 'no-homebrew' };

/** A model download, as the download sheet shows it. */
export type DownloadState =
  /** Indeterminate work before or after the bytes: "Checking what's already downloaded", "Setting up Qwen3.8-27B". */
  | { kind: 'working'; label: string }
  | {
      kind: 'downloading';
      receivedBytes: number;
      totalBytes: number;
      bytesPerSecond?: number | null;
      secondsLeft?: number | null;
    }
  /** Cancelled part way: the files stay, and Resume picks up from there. */
  | { kind: 'paused'; receivedBytes: number; totalBytes: number }
  | { kind: 'failed'; message: string; receivedBytes?: number; totalBytes?: number };
