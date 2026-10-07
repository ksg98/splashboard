/**
 * The engine_start contract (shared with the Rust supervisor):
 *
 *   buildServeRequest(values, catalog, version) -> ServeRequest
 *   renderServe(request, { version, secrets })  -> { argv, env, command }
 *
 * The Rust side renders the same argv/env/command from the same ServeRequest;
 * both are checked against __fixtures__/serve-vectors.json, whose `rules`
 * block is the normative description of the format.
 */
import { SECRET_ENV, getCatalog, isSecretEntry, serveEntry } from './catalog';
import { resolveServeState } from './state';
import type { Catalog, ServeValues } from './types';
import { splitCommaList } from './values';
import { validateServeValues, type Issue, type IssueCode } from './validate';
import { isAvailable } from './version';

export type FlagValue = string | number | boolean | string[] | null;

export interface ServeFlag {
  /** A serve[].key from docs/splash-params.json. */
  key: string;
  value: FlagValue;
}

/** What TS sends to Rust `engine_start` as `{ options: ServeRequest }`. */
export interface ServeRequest {
  /** OWNER/REPO[:VARIANT] or an absolute directory. */
  model: string;
  port: number;
  /** In catalog order; never contains model, port or secrets. */
  flags: ServeFlag[];
  /** Explicit splash binary; Rust finds one when omitted. */
  binary?: string;
}

export type SecretEnvName = 'SPLASH_API_KEY' | 'HF_TOKEN';

/** Secrets are always listed in this order, after flag-derived env. */
export const SECRET_ENV_ORDER: readonly SecretEnvName[] = ['SPLASH_API_KEY', 'HF_TOKEN'];

/** Shown instead of a secret value. */
export const REDACTED = '••••';

export const DEFAULT_PORT = 8000;

export class ServeRequestError extends Error {
  override name = 'ServeRequestError';
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(issues.map((i) => i.message).join(' '));
    this.issues = issues;
  }
  /** The first issue (most callers show one message). */
  get first(): Issue | undefined {
    return this.issues[0];
  }
}

function fail(key: string, code: IssueCode, message: string, minVersion?: string): never {
  throw new ServeRequestError([
    { key, level: 'error', code, message, ...(minVersion ? { minVersion } : {}) },
  ]);
}

/**
 * Turns form values (keyed by serve[].key) into the ServeRequest Rust
 * launches. Throws ServeRequestError with every blocking issue (unknown key,
 * too-old Splash, invalid value, missing model). Values equal to their
 * default, disabled controls and secrets are left out.
 */
export function buildServeRequest(
  values: ServeValues,
  catalog: Catalog = getCatalog(),
  version: string | null = catalog.version,
): ServeRequest {
  const result = validateServeValues(values, catalog, { version });
  if (!result.valid) {
    throw new ServeRequestError(result.issues.filter((i) => i.level === 'error'));
  }
  const state = resolveServeState(values, catalog, version);
  const model = state.get('model')?.value;
  const port = state.get('port')?.value;
  if (typeof model !== 'string' || model === '')
    fail('model', 'required', 'Choose a model to serve.');

  // validation.implies: a set field forces another (https_proxy -> no_proxy).
  const implied = new Set<string>();
  for (const field of state.values()) {
    if (field.isDefault || field.dropped) continue;
    for (const key of Object.keys(field.entry.validation.implies ?? {})) implied.add(key);
  }

  const flags: ServeFlag[] = [];
  for (const field of state.values()) {
    const { entry } = field;
    if (entry.key === 'model' || entry.key === 'port') continue;
    if (isSecretEntry(entry) || entry.visibility === 'internal') continue;
    if (!entry.applies_to.includes('serve') || field.dropped) continue;
    const mustInclude = entry.validation.must_include;
    if (mustInclude && (implied.has(entry.key) || !field.isDefault)) {
      const items = typeof field.value === 'string' ? splitCommaList(field.value) : [];
      for (const item of mustInclude) if (!items.includes(item)) items.push(item);
      flags.push({ key: entry.key, value: items.join(',') });
      continue;
    }
    if (field.isDefault) continue;
    flags.push({ key: entry.key, value: field.value });
  }
  return { model, port: typeof port === 'number' ? port : DEFAULT_PORT, flags };
}

export interface RenderOptions {
  catalog?: Catalog;
  /** Detected Splash version (default: the catalog's). */
  version?: string | null;
  /** Secrets Rust has stored; shown redacted. */
  secrets?: readonly SecretEnvName[];
}

export interface EnvVar {
  name: string;
  /** Redacted for secrets. */
  value: string;
  secret: boolean;
}

export interface RenderedServe {
  /** After the program: ["serve", "--model=…", "--port=…", …]. */
  argv: string[];
  env: EnvVar[];
  command: string;
}

const SAFE_RE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** POSIX shell quoting: bare when safe, else single quotes with ' as '\''. */
export function shellQuote(value: string): string {
  if (value === '') return "''";
  if (SAFE_RE.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function quoteArg(token: string): string {
  const eq = token.indexOf('=');
  if (token.startsWith('--') && eq > 0)
    return `${token.slice(0, eq + 1)}${shellQuote(token.slice(eq + 1))}`;
  return token.startsWith('--') || token === 'serve' ? token : shellQuote(token);
}

/**
 * The argv, env (secrets redacted) and copy-pasteable `splash serve` command
 * for a ServeRequest — exactly what the Rust supervisor reports.
 */
export function renderServe(request: ServeRequest, options: RenderOptions = {}): RenderedServe {
  const catalog = options.catalog ?? getCatalog();
  const version = options.version === undefined ? catalog.version : options.version;
  const portEntry = serveEntry('port', catalog);
  if (portEntry && !isAvailable(portEntry, version)) {
    fail(
      'port',
      'version',
      `--port needs Splash ${portEntry.min_version} or newer (installed: ${version}).`,
      portEntry.min_version,
    );
  }
  const argv = ['serve', `--model=${request.model}`, `--port=${request.port}`];
  const env: EnvVar[] = [];

  for (const { key, value } of request.flags) {
    const entry = serveEntry(key, catalog);
    if (!entry || !entry.applies_to.includes('serve') || entry.visibility === 'internal') {
      fail(key, 'unknown_key', `"${key}" is not a splash serve setting.`);
    }
    if (key === 'model' || key === 'port') {
      fail(key, 'duplicate', `${key} is a top-level field of the request, not a flag.`);
    }
    if (isSecretEntry(entry)) {
      fail(key, 'secret_in_flags', `${entry.label} is a secret and is never passed as a flag.`);
    }
    if (!isAvailable(entry, version)) {
      fail(
        key,
        'version',
        `${entry.flag ?? entry.env} needs Splash ${entry.min_version} or newer (installed: ${version}).`,
        entry.min_version,
      );
    }
    if (value === null || value === false || (Array.isArray(value) && value.length === 0)) continue;
    if (entry.pass_as === 'env') {
      const name = entry.env;
      if (!name || Array.isArray(value))
        fail(key, 'invalid', `${entry.label} cannot be passed this way.`);
      const text = value === true ? (entry.validation.env_value_when_on ?? '1') : String(value);
      env.push({ name, value: text, secret: false });
      continue;
    }
    const flag = entry.flag;
    if (!flag) fail(key, 'invalid', `${entry.label} has no command-line flag.`);
    if (value === true) argv.push(flag);
    else if (Array.isArray(value)) for (const item of value) argv.push(`${flag}=${item}`);
    else argv.push(`${flag}=${String(value)}`);
  }

  const secrets = new Set(options.secrets ?? []);
  for (const name of SECRET_ENV_ORDER) {
    if (secrets.has(name)) env.push({ name, value: REDACTED, secret: true });
  }

  const command = [
    ...env.map((e) => `${e.name}=${e.secret ? REDACTED : shellQuote(e.value)}`),
    'splash',
    ...argv.map(quoteArg),
  ].join(' ');
  return { argv, env, command };
}

/** The `splash serve …` command (secrets as redacted env placeholders). */
export function renderCommand(request: ServeRequest, options: RenderOptions = {}): string {
  return renderServe(request, options).command;
}

/** Secrets the values hold, as env names (for a preview before Rust has stored them). */
export function secretsInValues(values: ServeValues): SecretEnvName[] {
  return SECRET_ENV_ORDER.filter((name) => {
    const key = Object.keys(SECRET_ENV).find((k) => SECRET_ENV[k] === name);
    const v = key ? values[key] : undefined;
    return typeof v === 'string' && v.trim() !== '';
  });
}

/** Validation issues for a request, without throwing (for live previews). */
export function tryBuildServeRequest(
  values: ServeValues,
  catalog: Catalog = getCatalog(),
  version: string | null = catalog.version,
): { request: ServeRequest; issues: Issue[] } | { request: null; issues: Issue[] } {
  try {
    return { request: buildServeRequest(values, catalog, version), issues: [] };
  } catch (error) {
    if (error instanceof ServeRequestError) return { request: null, issues: error.issues };
    throw error;
  }
}
