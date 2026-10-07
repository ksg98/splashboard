/**
 * Sample data for browser mode (`pnpm web`) and tests, shaped like a Mac
 * with Splash 1.2.0 installed through Homebrew. Not used in the desktop app.
 */
import type { BrewRunResult, InstallProgress, InstallStatus, LatestCheck } from './types';

export const SAMPLE_INSTALL_STATUS: InstallStatus = {
  homebrew: { found: true, path: '/opt/homebrew/bin/brew', prefix: '/opt/homebrew' },
  splash: {
    source: 'homebrew',
    libexec: '/opt/homebrew/opt/splash/libexec',
    version: '1.2.0',
    python: '/opt/homebrew/opt/splash/libexec/python/bin/python3',
    pythonOk: true,
    engine: '/opt/homebrew/opt/splash/libexec/engine/splash',
  },
  installed: true,
  version: '1.2.0',
  dataDir: '/Users/you/Library/Application Support/Splash',
  modelsDir: '/Users/you/Library/Application Support/Splash/models',
  runningServers: [],
};

export const SAMPLE_LATEST: LatestCheck = {
  installed: '1.2.0',
  tap: {
    formula: 'incoai/tap/splash',
    stable: '1.2.0',
    installed: ['1.2.0'],
    outdated: false,
    pinned: false,
    tap: 'incoai/tap',
  },
  tapError: null,
  github: {
    version: '1.2.0',
    name: 'Splash 1.2.0',
    url: 'https://github.com/incoai/splash/releases/tag/1.2.0',
    publishedAt: '2026-10-04T01:25:34Z',
    notes:
      'Splash 1.2.0 adds persistent conversation caching, OpenAI text completions, more sampling controls, and broader GGUF compatibility.',
  },
  githubError: null,
  latest: '1.2.0',
  upgradeAvailable: false,
  releaseNotInTap: false,
  checkedAtMs: 0,
};

/** A brew upgrade as `install://progress` lines (browser simulation). */
export const SAMPLE_UPGRADE_LINES: Array<Pick<InstallProgress, 'phase' | 'line' | 'stream'>> = [
  { phase: 'updating', line: '$ brew update', stream: 'system' },
  { phase: 'updating', line: 'Already up-to-date.', stream: 'stdout' },
  { phase: 'installing', line: '$ brew upgrade incoai/tap/splash', stream: 'system' },
  { phase: 'downloading', line: '==> Fetching downloads for: splash', stream: 'stdout' },
  { phase: 'installing', line: '==> Upgrading incoai/tap/splash', stream: 'stdout' },
  {
    phase: 'installing',
    line: '==> Pouring splash--1.2.0.arm64_tahoe.bottle.tar.gz',
    stream: 'stdout',
  },
  { phase: 'finishing', line: '==> Summary', stream: 'stdout' },
];

export function sampleRunResult(action: BrewRunResult['action'], jobId: string): BrewRunResult {
  return {
    jobId,
    action,
    ok: true,
    cancelled: false,
    exitCode: 0,
    phase: 'done',
    logTail: SAMPLE_UPGRADE_LINES.map((l) => l.line ?? ''),
    error: null,
  };
}
