/**
 * Launching an agent the faithful way: `splash <agent> [ARGS...]` in a
 * terminal, which does Splash's own setup (env, argv, config files) and then
 * execs the agent. Splash reads the server from SPLASH_PORT and refuses to
 * start when nothing answers there, so callers say whether it is running.
 */
import type { PtyLaunch, TerminalController } from '../terminal';
import { getConnector, type AgentId } from './catalog';

/** Keeps loopback traffic away from any system proxy. */
export const LOCAL_NO_PROXY = '127.0.0.1,localhost';

export type ConnectorLaunchErrorKind =
  'invalidPort' | 'unknownOption' | 'invalidOption' | 'serverNotRunning';

export class ConnectorLaunchError extends Error {
  readonly kind: ConnectorLaunchErrorKind;
  constructor(kind: ConnectorLaunchErrorKind, message: string) {
    super(message);
    this.name = 'ConnectorLaunchError';
    this.kind = kind;
  }
}

export interface ConnectorLaunchOptions {
  /** The running server's port. */
  port: number;
  /** The server's --api-key, if it has one (passed as SPLASH_API_KEY). */
  apiKey?: string | null;
  /** Extra arguments for the agent, after `splash <agent>`. */
  args?: string[];
  /** The project folder the agent works in; the home folder when omitted. */
  cwd?: string | null;
  /** Values for the connector's env_options (empty values are skipped). */
  envOptions?: Record<string, string>;
}

function checkOption(env: string, control: string, value: string): void {
  if (control === 'number' && !/^[1-9]\d*$/.test(value.trim())) {
    throw new ConnectorLaunchError('invalidOption', `${env} must be a positive whole number`);
  }
  if (control === 'json-editor') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ConnectorLaunchError('invalidOption', `${env} must be valid JSON`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ConnectorLaunchError('invalidOption', `${env} must be a JSON object`);
    }
  }
}

/** The PTY launch for `splash <agent>` against the server on `port`. */
export function buildConnectorLaunch(id: AgentId, options: ConnectorLaunchOptions): PtyLaunch {
  const { port } = options;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConnectorLaunchError('invalidPort', `invalid port ${String(port)}`);
  }
  const def = getConnector(id);
  const env: Record<string, string> = {
    SPLASH_PORT: String(port),
    NO_PROXY: LOCAL_NO_PROXY,
    no_proxy: LOCAL_NO_PROXY,
  };
  if (options.apiKey) env.SPLASH_API_KEY = options.apiKey;
  for (const [key, value] of Object.entries(options.envOptions ?? {})) {
    const option = def.envOptions.find((o) => o.env === key);
    if (!option) {
      throw new ConnectorLaunchError('unknownOption', `${def.label} has no option ${key}`);
    }
    if (value.trim() === '') continue;
    checkOption(key, option.control, value);
    env[key] = option.control === 'number' ? value.trim() : value;
  }
  const launch: PtyLaunch = { kind: 'splash', args: [id, ...(options.args ?? [])], env };
  if (options.cwd) launch.cwd = options.cwd;
  return launch;
}

/** The command as a user would type it, for display and copy. */
export function connectorCommandLine(id: AgentId, options: ConnectorLaunchOptions): string {
  const launch = buildConnectorLaunch(id, options);
  const quote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  const env = Object.entries(launch.env ?? {})
    .filter(([k]) => k !== 'no_proxy' && k !== 'SPLASH_API_KEY')
    .map(([k, v]) => `${k}=${quote(v)}`);
  return [...env, 'splash', ...(launch.args ?? []).map(quote)].join(' ');
}

/**
 * Starts `splash <agent>` in `controller`. Rejects with `serverNotRunning`
 * instead of opening a terminal that would only print Splash's error.
 */
export async function launchConnector(
  controller: TerminalController,
  id: AgentId,
  options: ConnectorLaunchOptions & { serverRunning: boolean },
): Promise<number | null> {
  const launch = buildConnectorLaunch(id, options);
  if (!controller.available) {
    // The controller reports this through its onUnavailable callback.
    return controller.start(launch);
  }
  if (!options.serverRunning) {
    throw new ConnectorLaunchError(
      'serverNotRunning',
      `Start the Splash server first: splash ${id} connects to the server on port ${options.port}.`,
    );
  }
  return controller.start(launch);
}
