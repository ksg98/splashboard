import { describe, expect, it } from 'vitest';
import vectorsJson from './__fixtures__/serve-vectors.json';
import {
  REDACTED,
  ServeRequestError,
  buildServeRequest,
  renderCommand,
  renderServe,
  secretsInValues,
  shellQuote,
  tryBuildServeRequest,
  type SecretEnvName,
  type ServeRequest,
} from './serve';
import { getCatalog } from './catalog';
import type { ServeValues } from './types';

interface Vector {
  name: string;
  version: string;
  values?: ServeValues;
  secrets: SecretEnvName[];
  request?: ServeRequest;
  argv?: string[];
  env?: Array<[string, string]>;
  env_keys?: string[];
  command?: string;
  error?: { key: string; code: string; min_version?: string };
}

const file = vectorsJson as unknown as { redacted: string; vectors: Vector[] };
const vectors = file.vectors;
const catalog = getCatalog();

function catchError(fn: () => unknown): ServeRequestError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ServeRequestError) return error;
    throw error;
  }
  throw new Error('expected a ServeRequestError');
}

describe('serve-vectors.json', () => {
  it('has at least 15 vectors with unique names and the agreed placeholder', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(15);
    expect(new Set(vectors.map((v) => v.name)).size).toBe(vectors.length);
    expect(file.redacted).toBe(REDACTED);
  });

  const ok = vectors.filter((v) => !v.error);
  const failing = vectors.filter((v) => v.error);

  it.each(ok.filter((v) => v.values).map((v) => [v.name, v] as const))(
    'buildServeRequest: %s',
    (_name, v) => {
      expect(buildServeRequest(v.values!, catalog, v.version)).toEqual(v.request);
    },
  );

  it.each(ok.map((v) => [v.name, v] as const))('renderServe: %s', (_name, v) => {
    const rendered = renderServe(v.request!, { version: v.version, secrets: v.secrets });
    expect(rendered.argv).toEqual(v.argv);
    expect(rendered.env.map((e) => [e.name, e.value])).toEqual(v.env);
    expect(rendered.env.map((e) => e.name)).toEqual(v.env_keys);
    expect(rendered.command).toBe(v.command);
    expect(renderCommand(v.request!, { version: v.version, secrets: v.secrets })).toBe(v.command);
  });

  it.each(failing.filter((v) => v.values).map((v) => [v.name, v] as const))(
    'buildServeRequest rejects: %s',
    (_name, v) => {
      const error = catchError(() => buildServeRequest(v.values!, catalog, v.version));
      const issue = error.issues.find((i) => i.key === v.error!.key);
      expect(issue, JSON.stringify(error.issues)).toBeDefined();
      expect(issue!.code).toBe(v.error!.code);
      if (v.error!.min_version) {
        expect(issue!.minVersion).toBe(v.error!.min_version);
        expect(issue!.message).toContain(v.error!.min_version);
      }
    },
  );

  it.each(failing.filter((v) => v.request).map((v) => [v.name, v] as const))(
    'renderServe rejects: %s',
    (_name, v) => {
      const error = catchError(() =>
        renderServe(v.request!, { version: v.version, secrets: v.secrets }),
      );
      expect(error.first?.key).toBe(v.error!.key);
      expect(error.first?.code).toBe(v.error!.code);
      if (v.error!.min_version) expect(error.message).toContain(v.error!.min_version);
    },
  );
});

describe('serve contract details', () => {
  it('never puts a secret on argv or in flags', () => {
    const request = buildServeRequest({ model: 'a/b', api_key: 'topsecret', hf_token: 'hf_x' });
    expect(JSON.stringify(request)).not.toContain('topsecret');
    const { argv, command } = renderServe(request, { secrets: ['SPLASH_API_KEY'] });
    expect(argv.join(' ')).not.toContain('topsecret');
    expect(command.startsWith(`SPLASH_API_KEY=${REDACTED} splash serve`)).toBe(true);
  });

  it('lists the secrets the values hold, in contract order', () => {
    expect(secretsInValues({ hf_token: 'hf_x', api_key: 'k' })).toEqual([
      'SPLASH_API_KEY',
      'HF_TOKEN',
    ]);
    expect(secretsInValues({ api_key: '  ' })).toEqual([]);
  });

  it('quotes for a POSIX shell', () => {
    expect(shellQuote('plain/path-1.0:x,y')).toBe('plain/path-1.0:x,y');
    expect(shellQuote('')).toBe("''");
    expect(shellQuote('a b')).toBe("'a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote('*')).toBe("'*'");
    expect(shellQuote('~/x')).toBe("'~/x'");
  });

  it('tryBuildServeRequest returns issues instead of throwing', () => {
    const result = tryBuildServeRequest({ model: '' });
    expect(result.request).toBeNull();
    expect(result.issues[0]?.code).toBe('required');
    expect(tryBuildServeRequest({ model: 'a/b' }).request?.model).toBe('a/b');
  });

  it('collects every blocking issue at once', () => {
    const error = catchError(() =>
      buildServeRequest(
        { model: 'a/b', kv_format: 'bf16', persistent_cache: true, max_cache_disk: '1G' },
        catalog,
        '1.0.2',
      ),
    );
    expect(error.issues.map((i) => i.key).sort()).toEqual([
      'kv_format',
      'max_cache_disk',
      'model',
      'persistent_cache',
    ]);
  });

  it('defaults the port to 8000', () => {
    expect(buildServeRequest({ model: 'a/b' }).port).toBe(8000);
    expect(buildServeRequest({ model: 'a/b', port: '9001' }).port).toBe(9001);
  });
});
