import { describe, expect, it, vi } from 'vitest';
import type { PtyLaunch, TerminalController } from '../terminal';
import {
  ConnectorLaunchError,
  LOCAL_NO_PROXY,
  buildConnectorLaunch,
  connectorCommandLine,
  launchConnector,
} from './launch';

describe('buildConnectorLaunch', () => {
  it('runs splash <agent> with the server port and loopback proxy bypass', () => {
    expect(buildConnectorLaunch('claude', { port: 8000 })).toEqual({
      kind: 'splash',
      args: ['claude'],
      env: { SPLASH_PORT: '8000', NO_PROXY: LOCAL_NO_PROXY, no_proxy: LOCAL_NO_PROXY },
    });
  });

  it('adds the API key, agent args, cwd and env options', () => {
    const launch = buildConnectorLaunch('opencode', {
      port: 8123,
      apiKey: 'secret',
      args: ['--continue'],
      cwd: '/Users/me/project',
      envOptions: {
        OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: ' 64000 ',
        OPENCODE_CONFIG_CONTENT: '',
      },
    });
    expect(launch).toEqual({
      kind: 'splash',
      args: ['opencode', '--continue'],
      cwd: '/Users/me/project',
      env: {
        SPLASH_PORT: '8123',
        NO_PROXY: LOCAL_NO_PROXY,
        no_proxy: LOCAL_NO_PROXY,
        SPLASH_API_KEY: 'secret',
        OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '64000',
      },
    });
  });

  it('validates the port and options', () => {
    const kind = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof ConnectorLaunchError ? e.kind : 'other';
      }
      return 'none';
    };
    expect(kind(() => buildConnectorLaunch('codex', { port: 0 }))).toBe('invalidPort');
    expect(kind(() => buildConnectorLaunch('codex', { port: 8000.5 }))).toBe('invalidPort');
    expect(
      kind(() => buildConnectorLaunch('codex', { port: 8000, envOptions: { HERMES_HOME: '/x' } })),
    ).toBe('unknownOption');
    expect(
      kind(() =>
        buildConnectorLaunch('claude', {
          port: 8000,
          envOptions: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: 'lots' },
        }),
      ),
    ).toBe('invalidOption');
    expect(
      kind(() =>
        buildConnectorLaunch('opencode', {
          port: 8000,
          envOptions: { OPENCODE_CONFIG_CONTENT: '[1]' },
        }),
      ),
    ).toBe('invalidOption');
    expect(
      kind(() =>
        buildConnectorLaunch('opencode', {
          port: 8000,
          envOptions: { OPENCODE_CONFIG_CONTENT: '{"theme":"x"}' },
        }),
      ),
    ).toBe('none');
    expect(
      kind(() =>
        buildConnectorLaunch('pi', { port: 8000, envOptions: { PI_CODING_AGENT_DIR: '/p' } }),
      ),
    ).toBe('none');
  });
});

describe('connectorCommandLine', () => {
  it('shows the equivalent terminal command without the key', () => {
    expect(
      connectorCommandLine('hermes', {
        port: 8001,
        apiKey: 'secret',
        args: ['chat', '-q', 'hi there'],
      }),
    ).toBe("SPLASH_PORT=8001 NO_PROXY=127.0.0.1,localhost splash hermes chat -q 'hi there'");
  });
});

describe('launchConnector', () => {
  function fakeController(available = true) {
    const start = vi.fn(async (_launch: PtyLaunch) => 4);
    return { controller: { available, start } as unknown as TerminalController, start };
  }

  it('starts splash <agent> when the server is running', async () => {
    const { controller, start } = fakeController();
    const id = await launchConnector(controller, 'codex', { port: 8000, serverRunning: true });
    expect(id).toBe(4);
    expect(start.mock.calls[0]?.[0]).toMatchObject({ kind: 'splash', args: ['codex'] });
  });

  it('refuses when no server is running', async () => {
    const { controller, start } = fakeController();
    await expect(
      launchConnector(controller, 'claude', { port: 8000, serverRunning: false }),
    ).rejects.toMatchObject({ kind: 'serverNotRunning' });
    expect(start).not.toHaveBeenCalled();
  });

  it('lets an unavailable controller report the browser fallback', async () => {
    const { controller, start } = fakeController(false);
    start.mockResolvedValueOnce(null as unknown as number);
    expect(await launchConnector(controller, 'pi', { port: 8000, serverRunning: false })).toBe(
      null,
    );
    expect(start).toHaveBeenCalledOnce();
  });
});

describe('buildConnectorLaunch on Splash 1.3.0+', () => {
  it('also passes --port, and puts the agent arguments after --', () => {
    const launch = buildConnectorLaunch('claude', {
      port: 8123,
      splashVersion: '1.3.0',
      args: ['--continue'],
    });
    expect(launch.args).toEqual(['claude', '--port', '8123', '--', '--continue']);
    expect(launch.env?.SPLASH_PORT).toBe('8123');
  });

  it('keeps the old form for 1.2.x', () => {
    const launch = buildConnectorLaunch('codex', { port: 8123, splashVersion: '1.2.1' });
    expect(launch.args).toEqual(['codex']);
  });
});
