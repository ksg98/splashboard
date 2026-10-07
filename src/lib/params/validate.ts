/**
 * Plain-English validation of `splash serve` form values against the
 * catalog's rules, the installed Splash version and this Mac's capacity.
 */
import { getCatalog, serveEntry } from './catalog';
import { parseModelId, resolveServeState, type FieldState } from './state';
import type { Catalog, ServeEntry, ServeValues } from './types';
import { GiB, MiB, formatBytes, isUnset, parseTokens, sizeBytes } from './values';
import { versionAtLeast } from './version';

export type IssueLevel = 'error' | 'warning';

export type IssueCode =
  | 'required'
  | 'invalid'
  | 'range'
  | 'version'
  | 'unknown_key'
  | 'secret_in_flags'
  | 'duplicate'
  | 'legacy_package'
  | 'requires'
  | 'capacity'
  | 'security'
  | 'privacy'
  | 'conflict'
  | 'hint';

export interface Issue {
  key: string;
  level: IssueLevel;
  code: IssueCode;
  message: string;
  /** For code 'version': the Splash release needed. */
  minVersion?: string;
}

export interface ValidationContext {
  /** Detected Splash version; null/undefined = unknown (no version gating). */
  version?: string | null;
  /** Physical RAM. */
  ramBytes?: number | null;
  /**
   * MTLDevice.recommendedMaxWorkingSetSize as read from Metal. The
   * --max-memory ceiling is this minus max(1 GiB, 2%) (see gpuMemoryCapBytes).
   */
  gpuBudgetBytes?: number | null;
  /** maximum_context_tokens last measured with Auto for the same model/memory tuple. */
  contextMax?: number | null;
  /** Free space on the volume that holds the SSD cache. */
  freeDiskBytes?: number | null;
  /** An API key is stored on the Rust side (values.api_key also counts). */
  apiKeySet?: boolean;
  /** false = the model is known not to be installed (offline start would fail). */
  modelInstalled?: boolean;
  /** A coding agent is configured (warn when context is under 100K). */
  hasCodingAgent?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  issues: Issue[];
  errors: Partial<Record<string, string[]>>;
  warnings: Partial<Record<string, string[]>>;
}

/** Splash's automatic GPU budget: recommendedMaxWorkingSetSize - max(1 GiB, 2%) (MemoryPlan.hpp). */
export function gpuMemoryCapBytes(recommendedWorkingSetBytes: number): number {
  const rec = Math.max(0, Math.floor(recommendedWorkingSetBytes));
  const proportional = Math.floor(rec / 100) * 2 + Math.floor(((rec % 100) * 2) / 100);
  const margin = Math.max(GiB, proportional);
  return Math.max(0, rec - margin);
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME_RE =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;

function regex(pattern: string | undefined): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function isPathLike(value: string): boolean {
  return value.startsWith('/') || value === '~' || value.startsWith('~/');
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

class Collector {
  issues: Issue[] = [];
  error(key: string, code: IssueCode, message: string, minVersion?: string) {
    this.issues.push({ key, level: 'error', code, message, ...(minVersion ? { minVersion } : {}) });
  }
  warn(key: string, code: IssueCode, message: string) {
    this.issues.push({ key, level: 'warning', code, message });
  }
}

function invalidMessage(entry: ServeEntry): string {
  const parseError = entry.validation.parse_error;
  if (typeof parseError === 'string' && !parseError.startsWith('--')) {
    return `${entry.label} ${parseError}.`;
  }
  switch (entry.type) {
    case 'integer':
      return `${entry.label} must be a whole number.`;
    case 'number':
      return `${entry.label} must be a number.`;
    case 'boolean':
      return `${entry.label} must be on or off.`;
    case 'size':
      return `${entry.label} must be a size such as 32G (K, M and G are 1024-based).`;
    default:
      return `${entry.label} is not valid.`;
  }
}

function checkModel(field: FieldState, version: string | null | undefined, out: Collector) {
  const value = field.given;
  if (typeof value !== 'string' || value === '') {
    out.error('model', 'required', 'Choose a model to serve.');
    return;
  }
  const v = field.entry.validation;
  const id = parseModelId(value);
  if (id.kind === 'directory') return;
  if (value.startsWith('~') || value.startsWith('.')) {
    out.error(
      'model',
      'invalid',
      'Use the full path of the model folder (starting with /), or OWNER/REPO.',
    );
    return;
  }
  const pattern = regex(v.pattern);
  const badSubstring = (v.forbid_substrings ?? []).some((s) => value.includes(s));
  const repo = value.split(':')[0] ?? '';
  const endsGit = v.repo_must_not_end_with ? repo.endsWith(v.repo_must_not_end_with) : false;
  if (id.kind === 'invalid' || (pattern && !pattern.test(value)) || badSubstring || endsGit) {
    out.error(
      'model',
      'invalid',
      'Enter the model as OWNER/REPO or OWNER/REPO:VARIANT, for example unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M (repo name up to 96 characters, no "--", ".." or ".git").',
    );
    return;
  }
  if (id.legacy && id.variant) {
    out.error(
      'model',
      'legacy_package',
      'Inco Splash packages (incoai/…-Splash) have no variants: remove the part after the colon.',
    );
    return;
  }
  if ((!id.legacy || id.variant) && !versionAtLeast(version, '1.1.0')) {
    out.error(
      'model',
      'version',
      `Upstream models and :VARIANT need Splash 1.1.0 or newer (installed: ${version}). Pick an incoai/…-Splash package or update Splash.`,
      '1.1.0',
    );
  }
}

function checkNumber(entry: ServeEntry, n: number, out: Collector) {
  const v = entry.validation;
  const min = v.min ?? entry.min;
  const max = v.max ?? entry.max;
  if (v.exclusive_min !== undefined && n <= v.exclusive_min) {
    out.error(entry.key, 'range', `${entry.label} must be more than ${fmt(v.exclusive_min)}.`);
  } else if (min !== null && min !== undefined && n < min) {
    out.error(
      entry.key,
      'range',
      max !== null && max !== undefined
        ? `${entry.label} must be from ${fmt(min)} to ${fmt(max)}.`
        : `${entry.label} must be at least ${fmt(min)}.`,
    );
  } else if (max !== null && max !== undefined && n > max) {
    out.error(
      entry.key,
      'range',
      min !== null && min !== undefined
        ? `${entry.label} must be from ${fmt(min)} to ${fmt(max)}.`
        : `${entry.label} must be at most ${fmt(max)}.`,
    );
  }
}

function checkString(entry: ServeEntry, value: string, out: Collector) {
  const v = entry.validation;
  if (entry.type === 'path') {
    if (!isPathLike(value)) {
      out.error(
        entry.key,
        'invalid',
        `${entry.label} must be a full folder path such as /Volumes/Models (a relative path depends on where Splash starts).`,
      );
    }
    return;
  }
  if (entry.type === 'repo_id_or_path') {
    const repo = regex(v.repo_pattern);
    if (!value.startsWith('/') && !(repo?.test(value) ?? true)) {
      out.error(
        entry.key,
        'invalid',
        `${entry.label} must be OWNER/REPO or the full path of a folder (starting with /).`,
      );
    }
    return;
  }
  if (entry.type === 'url') {
    let ok: boolean;
    try {
      const url = new URL(value);
      ok = url.protocol === 'http:' || url.protocol === 'https:' || entry.key.endsWith('proxy');
    } catch {
      ok = false;
    }
    if (!ok)
      out.error(entry.key, 'invalid', `${entry.label} must be a URL such as https://example.com.`);
    return;
  }
  if (entry.type === 'ipv4') {
    if (!IPV4_RE.test(value)) {
      out.error(
        entry.key,
        'invalid',
        `${entry.label} must be an IPv4 address such as 127.0.0.1 or 0.0.0.0.`,
      );
    }
    return;
  }
  if (entry.type === 'enum') {
    const allowed =
      v.choices ?? (entry.choices ?? []).map((c) => c.value).filter((c) => c !== null);
    if (!allowed.includes(value)) {
      out.error(entry.key, 'invalid', `${entry.label} must be one of: ${allowed.join(', ')}.`);
    }
    return;
  }
  const pattern = regex(v.pattern);
  if (pattern && !pattern.test(value)) {
    if (v.pattern_is_hint_only) {
      out.warn(
        entry.key,
        'hint',
        `${entry.label} does not look right; check it was copied in full.`,
      );
    } else {
      const parseError = typeof v.parse_error === 'string' ? v.parse_error : null;
      out.error(
        entry.key,
        'invalid',
        parseError ? `${parseError}.` : `${entry.label} is not valid.`,
      );
    }
  }
}

function checkList(entry: ServeEntry, items: string[], out: Collector) {
  const v = entry.validation;
  const pattern = regex(v.item_pattern);
  for (const item of items) {
    if (entry.type === 'hostname' && !HOSTNAME_RE.test(item)) {
      out.error(
        entry.key,
        'invalid',
        `"${item}" is not a host name (letters, digits, dots and dashes).`,
      );
    } else if (pattern && !pattern.test(item)) {
      out.error(
        entry.key,
        'invalid',
        entry.type === 'origin'
          ? `"${item}" must be an exact origin such as https://app.example.com:8443, or a bare *. Wildcards inside an origin are refused.`
          : `"${item}" is not allowed: no spaces, control characters, \\ % ? or #.`,
      );
    } else if (
      entry.key === 'served_model_name' &&
      item.split('/').some((s) => s === '' || s === '.' || s === '..')
    ) {
      out.error(entry.key, 'invalid', `"${item}" has an empty, "." or ".." path segment.`);
    }
  }
  if (v.unique && new Set(items).size !== items.length) {
    out.error(entry.key, 'invalid', `${entry.label} must not repeat a name.`);
  }
}

function checkCapacity(field: FieldState, ctx: ValidationContext, out: Collector) {
  const { entry } = field;
  if (entry.key === 'max_memory') {
    const bytes = sizeBytes(entry, field.value);
    if (bytes === null) return;
    if (bytes < (entry.validation.min_bytes ?? 1)) {
      out.error(entry.key, 'range', `${entry.label} must be more than 0.`);
      return;
    }
    if (ctx.gpuBudgetBytes) {
      const cap = gpuMemoryCapBytes(ctx.gpuBudgetBytes);
      if (bytes > cap) {
        out.warn(
          entry.key,
          'capacity',
          `This Mac's GPU budget is ${formatBytes(cap)}; Splash will use ${formatBytes(cap)}, so anything above it has no effect.`,
        );
      }
    } else if (ctx.ramBytes && bytes > ctx.ramBytes * 0.75) {
      out.warn(
        entry.key,
        'capacity',
        `That is more than 75% of this Mac's ${formatBytes(ctx.ramBytes)} of memory; macOS and other apps may run short.`,
      );
    }
  } else if (entry.key === 'max_context') {
    const parsed = parseTokens(field.value);
    if (parsed.kind !== 'tokens') return;
    const max = entry.validation.max_tokens ?? entry.max ?? 262144;
    if (parsed.tokens < 1 || parsed.tokens > max) {
      out.error(
        entry.key,
        'range',
        `${entry.label} must be Auto or 1 to ${fmt(max)} tokens (256K).`,
      );
      return;
    }
    if (ctx.contextMax && parsed.tokens > ctx.contextMax) {
      out.error(
        entry.key,
        'capacity',
        `This model and memory setting allow at most ${fmt(ctx.contextMax)} tokens; a larger value stops the server at startup. Use Auto or ${fmt(ctx.contextMax)} or less.`,
      );
    }
    const agentMin = entry.validation.warn_below_for_agents;
    if (ctx.hasCodingAgent && agentMin && parsed.tokens < agentMin) {
      out.warn(
        entry.key,
        'capacity',
        `Coding agents need about ${fmt(agentMin)} tokens of context.`,
      );
    }
  } else if (entry.key === 'max_cache_disk') {
    const bytes = sizeBytes(entry, field.value);
    if (!bytes) return;
    const minMib = Math.min(...Object.values(entry.validation.min_effective_mib ?? { any: 0 }));
    if (minMib > 0 && bytes < minMib * MiB) {
      out.warn(
        entry.key,
        'capacity',
        `Below about ${minMib} MiB (one cache state) the SSD cache silently does nothing; use at least 1G.`,
      );
    }
    if (
      ctx.freeDiskBytes !== undefined &&
      ctx.freeDiskBytes !== null &&
      bytes > ctx.freeDiskBytes
    ) {
      out.warn(
        entry.key,
        'capacity',
        `Only ${formatBytes(ctx.freeDiskBytes)} is free on the cache disk.`,
      );
    }
  } else if (entry.key === 'max_request_size') {
    const bytes = sizeBytes(entry, field.value);
    if (bytes !== null && bytes < 1)
      out.error(entry.key, 'range', `${entry.label} must be more than 0.`);
  }
}

/**
 * Validates serve form values. Errors block a start; warnings are shown
 * next to the field. Every message is a complete plain-English sentence.
 */
export function validateServeValues(
  values: ServeValues,
  catalog: Catalog = getCatalog(),
  ctx: ValidationContext = {},
): ValidationResult {
  const version = ctx.version === undefined ? catalog.version : ctx.version;
  const out = new Collector();

  for (const key of Object.keys(values)) {
    if (!serveEntry(key, catalog)) {
      out.error(key, 'unknown_key', `"${key}" is not a setting this version of Splashboard knows.`);
    }
  }

  const state = resolveServeState(values, catalog, version);
  const apiKey = values.api_key;
  const hasApiKey = Boolean(ctx.apiKeySet) || (typeof apiKey === 'string' && apiKey.trim() !== '');

  for (const field of state.values()) {
    const { entry } = field;
    if (entry.visibility === 'internal' || !entry.applies_to.includes('serve')) continue;
    if (entry.key === 'model') {
      checkModel(field, version, out);
      continue;
    }
    if (entry.key === 'port' && !versionAtLeast(version, entry.min_version)) {
      out.error(
        'port',
        'version',
        `Splashboard needs Splash ${entry.min_version} or newer to choose the port (installed: ${version}). Update Splash.`,
        entry.min_version,
      );
    }
    if (isUnset(field.raw)) continue;
    if (!field.valid) {
      out.error(entry.key, 'invalid', invalidMessage(entry));
      continue;
    }
    if (field.isDefault) continue;
    if (field.versionBlocked) {
      out.error(
        entry.key,
        'version',
        `${entry.label} needs Splash ${entry.min_version} or newer (installed: ${version}). Update Splash or reset it to the default.`,
        entry.min_version,
      );
      continue;
    }
    if (field.dropped) {
      if (!field.hidden) {
        out.warn(
          entry.key,
          'requires',
          `${entry.label} is ignored for now. ${field.disabledReason ?? ''}`.trim(),
        );
      }
      continue;
    }

    const value = field.value;
    if (typeof value === 'number') checkNumber(entry, value, out);
    else if (Array.isArray(value)) checkList(entry, value, out);
    else if (typeof value === 'string' && entry.type !== 'size' && entry.type !== 'tokens') {
      checkString(entry, value, out);
    }
    checkCapacity(field, ctx, out);
  }

  // Cross-field rules (terminal-parity 3.9).
  const host = state.get('host')?.value;
  if (typeof host === 'string' && !LOOPBACK.has(host) && IPV4_RE.test(host)) {
    const v = serveEntry('host', catalog)?.validation ?? {};
    if (!hasApiKey) {
      out.warn(
        'host',
        'security',
        typeof v.warn_if_non_loopback_without_api_key === 'string'
          ? v.warn_if_non_loopback_without_api_key
          : 'Anyone on your network could use this server. Set an API key.',
      );
    }
    if (host !== '0.0.0.0') {
      out.warn(
        'host',
        'hint',
        typeof v.warn_if_specific_non_loopback_ip === 'string'
          ? v.warn_if_specific_non_loopback_ip
          : 'Agents connect to 127.0.0.1 and will not reach a server bound only to this address.',
      );
    }
  }
  const origins = state.get('allowed_origin')?.value;
  if (Array.isArray(origins) && origins.includes('*') && !hasApiKey) {
    out.warn(
      'allowed_origin',
      'security',
      'Allowing every web origin (*) without an API key lets any web page you open use this server. Set an API key.',
    );
  }
  if (state.get('crash_trace')?.value === true) {
    const note = serveEntry('crash_trace', catalog)?.validation.confirm_on_enable;
    out.warn(
      'crash_trace',
      'privacy',
      typeof note === 'string' ? note : 'Crash traces may contain private data.',
    );
  }
  if (state.get('offline')?.value === true && ctx.modelInstalled === false) {
    out.error(
      'offline',
      'requires',
      'Offline start needs the model to be installed already. Download it first.',
    );
  }

  return summarize(out.issues);
}

export function summarize(issues: Issue[]): ValidationResult {
  const errors: Partial<Record<string, string[]>> = {};
  const warnings: Partial<Record<string, string[]>> = {};
  for (const issue of issues) {
    const bucket = issue.level === 'error' ? errors : warnings;
    (bucket[issue.key] ??= []).push(issue.message);
  }
  return { valid: !issues.some((i) => i.level === 'error'), issues, errors, warnings };
}

/** Issues for one field, for the form model. */
export function issuesFor(result: ValidationResult, key: string): Issue[] {
  return result.issues.filter((i) => i.key === key);
}
