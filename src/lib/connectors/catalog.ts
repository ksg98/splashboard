/**
 * The agent connectors (`splash claude|opencode|codex|hermes|pi`) and the
 * copy-config cards for other apps, read from docs/splash-params.json, the
 * single source of truth for Splash parameters.
 */
import params from '../../../docs/splash-params.json';

export const AGENT_IDS = ['claude', 'opencode', 'codex', 'hermes', 'pi'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** Splash's default port; other ports get a `splash-<port>` profile/provider. */
export const DEFAULT_PORT = 8000;

export interface EnvOption {
  env: string;
  /** 'number' | 'json-editor' | 'directory-picker' */
  control: string;
  unit: string | null;
  help: string;
}

export interface HeadlessLaunch {
  args: string[];
  promptVia: string;
  note: string;
}

export interface ConnectorDef {
  id: AgentId;
  label: string;
  /** As typed in a terminal, e.g. `splash claude [ARGS...]`. */
  command: string;
  binary: string;
  installUrl: string;
  /** What `splash <agent>` does before it execs the agent. */
  mechanism: string;
  needsTerminal: boolean;
  /** True for hermes and pi: they write config files (see `files`, `undo`). */
  writesFiles: boolean;
  /** Files written, with `[-<port>]` / `<port>` placeholders. */
  files: string[];
  minVersion: string;
  envInputs: string[];
  envOptions: EnvOption[];
  headless: HeadlessLaunch | null;
  /** How to undo what the connector wrote; null when it writes nothing. */
  undo: string | null;
  notes: string;
}

export interface ClientConfigDef {
  id: string;
  label: string;
  /** Templates with placeholders such as `<port>` and `<key or local>`. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** `splash serve` settings the app needs (host, api_key, allowed_origin...). */
  serveRequirements: Record<string, unknown>;
  notes: string | null;
  steps: string[];
  source: string[];
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(raw: Raw, key: string, where: string): string {
  const value = raw[key];
  if (typeof value !== 'string') throw new Error(`${where}: "${key}" must be a string`);
  return value;
}

function optStr(raw: Raw, key: string, where: string): string | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${where}: "${key}" must be a string or null`);
  return value;
}

function strList(raw: Raw, key: string, where: string): string[] {
  const value = raw[key] ?? [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new Error(`${where}: "${key}" must be a list of strings`);
  }
  return value as string[];
}

function bool(raw: Raw, key: string, where: string): boolean {
  const value = raw[key];
  if (typeof value !== 'boolean') throw new Error(`${where}: "${key}" must be a boolean`);
  return value;
}

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value);
}

export function parseConnector(raw: unknown): ConnectorDef {
  if (!isRecord(raw)) throw new Error('connector: not an object');
  const id = raw.id;
  if (!isAgentId(id)) throw new Error(`connector: unknown id ${JSON.stringify(id)}`);
  const where = `connector ${id}`;
  const envOptions = (Array.isArray(raw.env_options) ? raw.env_options : []).map((o, i) => {
    if (!isRecord(o)) throw new Error(`${where}: env_options[${i}] is not an object`);
    return {
      env: str(o, 'env', where),
      control: str(o, 'control', where),
      unit: optStr(o, 'unit', where),
      help: str(o, 'help', where),
    };
  });
  let headless: HeadlessLaunch | null = null;
  if (isRecord(raw.headless)) {
    headless = {
      args: strList(raw.headless, 'args', where),
      promptVia: str(raw.headless, 'prompt_via', where),
      note: optStr(raw.headless, 'note', where) ?? '',
    };
  }
  return {
    id,
    label: str(raw, 'label', where),
    command: str(raw, 'command', where),
    binary: str(raw, 'binary', where),
    installUrl: str(raw, 'install_url', where),
    mechanism: str(raw, 'mechanism', where),
    needsTerminal: bool(raw, 'needs_terminal', where),
    writesFiles: bool(raw, 'writes_files', where),
    files: strList(raw, 'files', where),
    minVersion: str(raw, 'min_version', where),
    envInputs: strList(raw, 'env_inputs', where),
    envOptions,
    headless,
    undo: optStr(raw, 'undo', where),
    notes: optStr(raw, 'notes', where) ?? '',
  };
}

export function parseClientConfig(raw: unknown): ClientConfigDef {
  if (!isRecord(raw)) throw new Error('client config: not an object');
  const where = `client config ${String(raw.id)}`;
  return {
    id: str(raw, 'id', where),
    label: str(raw, 'label', where),
    baseUrl: str(raw, 'base_url', where),
    apiKey: str(raw, 'api_key', where),
    model: str(raw, 'model', where),
    serveRequirements: isRecord(raw.serve_requirements) ? raw.serve_requirements : {},
    notes: optStr(raw, 'notes', where),
    steps: strList(raw, 'steps', where),
    source: strList(raw, 'source', where),
  };
}

function parseList<T>(raw: unknown, parse: (item: unknown) => T, what: string): T[] {
  if (!Array.isArray(raw)) throw new Error(`splash-params.json: ${what} must be a list`);
  return raw.map(parse);
}

// The JSON's inferred type is only a hint; the parsers above check the shape.
const rawParams: unknown = params;
const paramsRecord: Raw = isRecord(rawParams) ? rawParams : {};

/** The five agent connectors, in the order Splash documents them. */
export const CONNECTORS: readonly ConnectorDef[] = parseList(
  paramsRecord.connectors,
  parseConnector,
  'connectors',
);

/** Copy-config cards for apps that are not launched by Splash. */
export const CLIENT_CONFIGS: readonly ClientConfigDef[] = parseList(
  paramsRecord.client_configs,
  parseClientConfig,
  'client_configs',
);

export function getConnector(id: AgentId): ConnectorDef {
  const def = CONNECTORS.find((c) => c.id === id);
  if (!def) throw new Error(`unknown connector ${id}`);
  return def;
}

/**
 * The profile/provider name Splash uses for a port: `splash` on 8000,
 * `splash-<port>` otherwise (install/clients.py `_Server.name`).
 */
export function profileName(port: number): string {
  return port === DEFAULT_PORT ? 'splash' : `splash-${port}`;
}

/** Fills `splash[-<port>]` and `<port>` for a concrete port. */
export function fillPort(text: string, port: number): string {
  return text.replace(/splash\[-<port>\]/g, profileName(port)).replace(/<port>/g, String(port));
}

/** The files a connector writes for `port`; empty when it writes none. */
export function connectorFiles(def: ConnectorDef, port: number): string[] {
  return def.files.map((f) => fillPort(f, port));
}

/** How to undo what the connector wrote for `port`, or null. */
export function connectorUndo(def: ConnectorDef, port: number): string | null {
  return def.undo === null ? null : fillPort(def.undo, port);
}

/** The first version number in a min_version note ("1.0 (… 1.2.0)" -> "1.0"). */
export function minSplashVersion(def: ConnectorDef): string | null {
  return /\d+(?:\.\d+)+/.exec(def.minVersion)?.[0] ?? null;
}

/** Compares dotted versions numerically; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((p) => parseInt(p, 10) || 0);
  const pb = b.split('.').map((p) => parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** False when the installed Splash is older than the connector needs. */
export function isSupportedBy(def: ConnectorDef, splashVersion: string | null): boolean {
  const min = minSplashVersion(def);
  if (!min || !splashVersion) return true;
  return compareVersions(splashVersion, min) >= 0;
}

export interface ClientConfigValues {
  port: number;
  /** The server's API key; omitted when the server has none. */
  apiKey?: string | null;
  /** The model ID or alias the server reports. */
  model?: string | null;
  /** This Mac's LAN address, for apps on other machines. */
  lanIp?: string | null;
}

export interface RenderedClientConfig {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  steps: string[];
  notes: string | null;
  serveRequirements: Record<string, unknown>;
  /** Placeholders still unfilled (e.g. `<this Mac's LAN IP>`, `<key>`). */
  unresolved: string[];
}

const PLACEHOLDER = /<([^<>]+)>/g;

function fillTemplate(template: string, v: ClientConfigValues): string {
  return template.replace(PLACEHOLDER, (whole, inner: string) => {
    const key = inner.toLowerCase();
    if (key === 'port') return String(v.port);
    if (key.includes('lan ip')) return v.lanIp || whole;
    if (key.startsWith('key')) {
      if (v.apiKey) return v.apiKey;
      // "<key or local>": any text works when the server has no key.
      return key.includes('local') ? 'local' : whole;
    }
    if (key.startsWith('model')) return v.model || whole;
    return whole;
  });
}

/** A copy-config card with the running server's values filled in. */
export function renderClientConfig(
  def: ClientConfigDef,
  values: ClientConfigValues,
): RenderedClientConfig {
  const baseUrl = fillTemplate(def.baseUrl, values);
  const apiKey = fillTemplate(def.apiKey, values);
  const model = fillTemplate(def.model, values);
  const unresolved = [baseUrl, apiKey, model].flatMap((s) => s.match(PLACEHOLDER) ?? []);
  return {
    id: def.id,
    label: def.label,
    baseUrl,
    apiKey,
    model,
    steps: def.steps,
    notes: def.notes,
    serveRequirements: def.serveRequirements,
    unresolved: [...new Set(unresolved)],
  };
}
