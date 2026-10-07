import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServe } from '../params/serve';
import {
  DEFAULT_SUPERVISOR_SETTINGS,
  ENGINE_PHASES,
  canStart,
  engine,
  initialEngineState,
  isAppError,
  isLaunching,
  isServing,
  serveOptionsToRequest,
  toAppError,
  type EngineState,
  type LogLine,
} from './engine';

const ipc = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  listen:
    vi.fn<(event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: ipc.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: ipc.listen }));

function setTauri(on: boolean): void {
  const w = window as unknown as Record<string, unknown>;
  if (on) w.__TAURI_INTERNALS__ = {};
  else delete w.__TAURI_INTERNALS__;
}

/** What Rust serializes for a failed engine (see events.rs tests). */
const FAILED: EngineState = {
  phase: 'failed',
  status: 'failed',
  reason: 'Splash is already serving (PID 75278, model incoai/Qwen3.8-27B-Splash, port 8011)',
  exitCode: 1,
  signal: null,
  lastLogLines: ['error: Splash is already serving (PID 75278 …)'],
  owner: 'none',
  pid: null,
  port: 8011,
  model: 'incoai/Qwen3.8-27B-Splash',
  sinceMs: 2,
  startedAtMs: 1,
  readyAtMs: null,
  readyInfo: null,
  command: {
    argv: ['serve', '--model=incoai/Qwen3.8-27B-Splash', '--port=8011'],
    env: [{ name: 'SPLASH_API_KEY', value: '••••', secret: true }],
    command: 'SPLASH_API_KEY=•••• splash serve --model=incoai/Qwen3.8-27B-Splash --port=8011',
  },
  restarts: 0,
  lastExit: { code: 1, signal: null, requested: false, atMs: 2 },
};

beforeEach(() => {
  ipc.invoke.mockReset();
  ipc.listen.mockReset();
});

afterEach(() => setTauri(false));

describe('browser mode', () => {
  it('is unavailable and returns neutral reads', async () => {
    setTauri(false);
    expect(engine.available).toBe(false);
    expect((await engine.detect()).found).toBe(false);
    expect((await engine.state()).phase).toBe('stopped');
    expect(await engine.logs()).toEqual([]);
    expect(await engine.discover()).toEqual([]);
    expect(await engine.configure()).toEqual(DEFAULT_SUPERVISOR_SETTINGS);
    const unlisten = await engine.onState(() => undefined);
    unlisten();
    expect(ipc.invoke).not.toHaveBeenCalled();
    expect(ipc.listen).not.toHaveBeenCalled();
  });

  it('rejects every action with kind "unavailable"', async () => {
    setTauri(false);
    const request = { model: 'a/b', port: 8000, flags: [] };
    for (const action of [
      () => engine.start(request),
      () => engine.stop(),
      () => engine.restart(),
      () => engine.render(request),
      () => engine.adopt(),
      () => engine.stopExternal(8011),
      () => engine.saveLog(),
      () => engine.configure({ autoRestart: true }),
      () => engine.setConfig({ port: 8001 }),
    ]) {
      await expect(action()).rejects.toMatchObject({ kind: 'unavailable' });
    }
  });
});

describe('desktop mode', () => {
  beforeEach(() => setTauri(true));

  it('invokes the engine commands with the documented arguments', async () => {
    ipc.invoke.mockResolvedValue(FAILED);
    const request = {
      model: 'incoai/Qwen3.8-27B-Splash',
      port: 8012,
      flags: [{ key: 'offline', value: true }],
    };
    await engine.start(request);
    await engine.restart();
    await engine.restart(request);
    await engine.render(request);
    await engine.stop();
    await engine.adopt();
    await engine.adopt(8011);
    await engine.stopExternal(8011);
    await engine.saveLog('/tmp/x.log');
    await engine.saveLog();
    await engine.discover();
    await engine.configure({ stopGraceSecs: 5 });
    await engine.configure();
    await engine.detect('/opt/homebrew/bin/splash');
    await engine.state();
    await engine.logs();
    expect(ipc.invoke.mock.calls).toEqual([
      ['engine_start', { options: request }],
      ['engine_restart', { options: null }],
      ['engine_restart', { options: request }],
      ['engine_render', { options: request }],
      ['engine_stop'],
      ['engine_adopt', { port: null }],
      ['engine_adopt', { port: 8011 }],
      ['engine_stop_external', { port: 8011 }],
      ['engine_save_log', { path: '/tmp/x.log' }],
      ['engine_save_log', { path: null }],
      ['engine_discover'],
      ['engine_configure', { patch: { stopGraceSecs: 5 } }],
      ['engine_configure', { patch: null }],
      ['engine_detect', { binary: '/opt/homebrew/bin/splash' }],
      ['engine_state'],
      ['engine_logs'],
    ]);
  });

  it('forwards event payloads', async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    ipc.listen.mockImplementation((name, handler) => {
      handlers.set(name, handler);
      return Promise.resolve(() => undefined);
    });
    const states: EngineState[] = [];
    const lines: LogLine[] = [];
    await engine.onState((s) => states.push(s));
    await engine.onLog((l) => lines.push(l));
    handlers.get('engine://state')?.({ payload: FAILED });
    const line: LogLine = {
      seq: 3,
      stream: 'stdout',
      line: '00:18:39 Ready · incoai/Qwen3.8-27B-Splash · context 256K · http://127.0.0.1:8011',
      tsMs: 4,
      phase: 'ready',
    };
    handlers.get('engine://log')?.({ payload: line });
    expect(states).toEqual([FAILED]);
    expect(lines).toEqual([line]);
  });
});

describe('helpers', () => {
  it('classifies every phase', () => {
    const serving = ENGINE_PHASES.filter((phase) => isServing({ phase }));
    const launching = ENGINE_PHASES.filter((phase) => isLaunching({ phase }));
    const startable = ENGINE_PHASES.filter((phase) => canStart({ phase }));
    expect(serving).toEqual(['ready', 'busy', 'idle_released', 'restoring', 'recovering']);
    expect(launching).toEqual(['starting', 'downloading', 'loading_weights', 'warming']);
    expect(startable).toEqual(['stopped', 'failed', 'external']);
    expect(initialEngineState('not_installed')).toMatchObject({
      phase: 'not_installed',
      status: 'not_installed',
      owner: 'none',
    });
  });

  it('normalizes errors', () => {
    expect(isAppError({ kind: 'portInUse', message: 'x' })).toBe(true);
    expect(isAppError('nope')).toBe(false);
    expect(toAppError(new Error('boom'))).toEqual({ kind: 'other', message: 'boom' });
    expect(toAppError({ kind: 'versionTooOld', message: 'm' }).kind).toBe('versionTooOld');
  });

  it('converts the deprecated ServeOptions to a catalog request', () => {
    const request = serveOptionsToRequest({
      model: ' unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M ',
      port: 8123,
      offline: true,
      languageOnly: false,
      maxContext: '128K',
      allowedOrigins: ['tauri://localhost'],
      servedModelNames: [],
      apiKey: 'secret',
    });
    expect(request).toEqual({
      model: 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M',
      port: 8123,
      flags: [
        { key: 'offline', value: true },
        { key: 'max_context', value: '128K' },
        { key: 'allowed_origin', value: ['tauri://localhost'] },
      ],
    });
    // The request renders with the shared contract (and no secret leaks).
    const rendered = renderServe(request, { version: '1.2.0' });
    expect(rendered.argv).toEqual([
      'serve',
      '--model=unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M',
      '--port=8123',
      '--offline',
      '--max-context=128K',
      '--allowed-origin=tauri://localhost',
    ]);
    expect(rendered.command).not.toContain('secret');
  });
});
