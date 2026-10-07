import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, desktop } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  desktop: { value: true },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('../env', () => ({ isTauri: () => desktop.value }));

import { parseDetection } from './detect';
import { connectorEntries, resetConnectorsStore, useConnectorsStore } from './store';

const WIRE = {
  agents: [
    {
      id: 'claude',
      found: true,
      path: '/Users/me/.local/bin/claude',
      version: '2.0.14',
      versionOutput: '2.0.14 (Claude Code)',
    },
    { id: 'opencode', found: false, path: null, version: null, versionOutput: null },
    {
      id: 'codex',
      found: true,
      path: '/opt/homebrew/bin/codex',
      version: null,
      versionOutput: 'x',
    },
    { id: 'mystery', found: true },
  ],
  splashPath: '/opt/homebrew/bin/splash',
  searchPath: '/opt/homebrew/bin:/usr/bin',
};

beforeEach(() => {
  desktop.value = true;
  invokeMock.mockReset();
  resetConnectorsStore();
});
afterEach(() => resetConnectorsStore());

describe('parseDetection', () => {
  it('keeps known agents and normalises fields', () => {
    const parsed = parseDetection(WIRE);
    expect(parsed.agents.map((a) => a.id)).toEqual(['claude', 'opencode', 'codex']);
    expect(parsed.splashPath).toBe('/opt/homebrew/bin/splash');
    expect(parseDetection(null)).toEqual({ agents: [], splashPath: null, searchPath: '' });
  });
});

describe('useConnectorsStore', () => {
  it('detects installed agents through connectors_detect', async () => {
    invokeMock.mockResolvedValue(WIRE);
    const done = useConnectorsStore.getState().detect();
    expect(useConnectorsStore.getState().status).toBe('detecting');
    await done;
    const state = useConnectorsStore.getState();
    expect(invokeMock).toHaveBeenCalledWith('connectors_detect');
    expect(state.status).toBe('ready');
    expect(state.agents.claude?.version).toBe('2.0.14');
    expect(state.agents.opencode?.found).toBe(false);
    expect(state.splashPath).toBe('/opt/homebrew/bin/splash');
    expect(state.detectedAt).toEqual(expect.any(Number));
  });

  it('shares one run between concurrent calls', async () => {
    invokeMock.mockResolvedValue(WIRE);
    const { detect } = useConnectorsStore.getState();
    await Promise.all([detect(), detect(), detect()]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await detect();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('records errors from Rust', async () => {
    invokeMock.mockRejectedValue({ kind: 'io', message: 'I/O error: denied' });
    await useConnectorsStore.getState().detect();
    expect(useConnectorsStore.getState()).toMatchObject({
      status: 'error',
      error: 'I/O error: denied',
    });
  });

  it('is unavailable in the browser', async () => {
    desktop.value = false;
    await useConnectorsStore.getState().detect();
    expect(useConnectorsStore.getState().status).toBe('unavailable');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('connectorEntries', () => {
  it('joins the catalog with detection', () => {
    const entries = connectorEntries({
      claude: {
        id: 'claude',
        found: true,
        path: '/c',
        version: '2.0.14',
        versionOutput: null,
      },
    });
    expect(entries.map((e) => [e.def.id, e.installed])).toEqual([
      ['claude', true],
      ['opencode', false],
      ['codex', false],
      ['hermes', false],
      ['pi', false],
    ]);
    expect(entries[0]?.detection?.path).toBe('/c');
    expect(entries[1]?.detection).toBeNull();
  });
});
