import { describe, expect, it } from 'vitest';
import { parseModelId, resolveServeState } from './state';
import { GiB, MiB } from './values';
import { gpuMemoryCapBytes, validateServeValues, type Issue } from './validate';

const M = 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M';
const codes = (issues: Issue[], key: string) =>
  issues.filter((i) => i.key === key).map((i) => `${i.level}:${i.code}`);

describe('model ids', () => {
  it('parses repo, variant, directory and legacy packages', () => {
    expect(parseModelId(M)).toMatchObject({
      kind: 'repo',
      owner: 'unsloth',
      variant: 'UD-Q4_K_M',
      legacy: false,
    });
    expect(parseModelId('incoai/Qwen3.8-27B-Splash')).toMatchObject({ kind: 'repo', legacy: true });
    expect(parseModelId('/Users/me/model')).toMatchObject({ kind: 'directory' });
    expect(parseModelId('nonsense')).toMatchObject({ kind: 'invalid' });
  });

  it('validates the model field', () => {
    expect(validateServeValues({}).errors.model).toEqual(['Choose a model to serve.']);
    expect(codes(validateServeValues({ model: 'a/b--c' }).issues, 'model')).toEqual([
      'error:invalid',
    ]);
    expect(codes(validateServeValues({ model: 'a/b.git' }).issues, 'model')).toEqual([
      'error:invalid',
    ]);
    expect(codes(validateServeValues({ model: '~/models/x' }).issues, 'model')).toEqual([
      'error:invalid',
    ]);
    expect(
      codes(validateServeValues({ model: 'incoai/Qwen3.8-27B-Splash:Q4' }).issues, 'model'),
    ).toEqual(['error:legacy_package']);
    expect(validateServeValues({ model: M }).valid).toBe(true);
    expect(validateServeValues({ model: '/Volumes/x/My Model' }).valid).toBe(true);
    expect(
      validateServeValues({ model: 'incoai/Qwen3.8-27B-Splash' }, undefined, { version: '1.0.2' })
        .valid,
    ).toBe(true);
  });
});

describe('field rules', () => {
  it('checks bounds in plain English', () => {
    const r = validateServeValues({
      model: M,
      port: 70000,
      queue_size: 0,
      request_timeout: 0,
      max_image_pixels: 1000,
    });
    expect(r.errors.port).toEqual(['Port must be from 1 to 65,535.']);
    expect(r.errors.queue_size).toEqual(['Request queue size must be at least 1.']);
    expect(r.errors.request_timeout).toEqual(['Request time limit must be more than 0.']);
    expect(r.errors.max_image_pixels).toEqual(['Max image size must be from 65,536 to 4,194,304.']);
  });

  it('reports unparseable values with Splash wording', () => {
    const r = validateServeValues({
      model: M,
      max_context: '12.5K',
      max_memory: 'lots',
      queue_size: 'x',
    });
    expect(r.errors.max_context?.[0]).toMatch(
      /^Context length must be 'auto' or a token count up to 256K/,
    );
    expect(r.errors.max_memory?.[0]).toMatch(/GPU memory limit must be a size such as 32G/);
    expect(r.errors.queue_size?.[0]).toMatch(/positive number of requests/);
  });

  it('checks strings, lists and paths', () => {
    const r = validateServeValues({
      model: M,
      host: '10.0.0',
      api_key: 'has space',
      hf_token: 'abc',
      hf_hub_cache: 'relative/dir',
      hf_endpoint: 'ftp://x',
      allowed_origin: ['http://*.example.com', 'tauri://*'],
      served_model_name: ['a', 'a', 'x/../y'],
      allowed_host: ['bad host'],
      kv_format: 'fp8',
    });
    expect(codes(r.issues, 'host')).toEqual(['error:invalid']);
    expect(r.errors.api_key).toEqual(['API key must contain only visible ASCII characters.']);
    expect(codes(r.issues, 'hf_token')).toEqual(['warning:hint']);
    expect(codes(r.issues, 'hf_hub_cache')).toEqual(['error:invalid']);
    expect(codes(r.issues, 'hf_endpoint')).toEqual(['error:invalid']);
    expect(r.errors.allowed_origin).toHaveLength(2);
    expect(r.errors.served_model_name).toHaveLength(2);
    expect(codes(r.issues, 'allowed_host')).toEqual(['error:invalid']);
    expect(r.errors.kv_format).toEqual(['KV cache precision must be one of: int8, bf16.']);
  });

  it('flags unknown keys', () => {
    expect(codes(validateServeValues({ model: M, warp: 9 }).issues, 'warp')).toEqual([
      'error:unknown_key',
    ]);
  });
});

describe('version gating', () => {
  it('errors on a non-default value Splash is too old for, naming the version', () => {
    const r = validateServeValues({ model: M, decode_share: 1, queue_size: 32 }, undefined, {
      version: '1.1.0',
    });
    expect(r.issues).toEqual([
      expect.objectContaining({ key: 'decode_share', code: 'version', minVersion: '1.2.0' }),
    ]);
    expect(r.errors.decode_share?.[0]).toContain('1.2.0');
  });

  it('gates upstream models and the port', () => {
    expect(
      codes(validateServeValues({ model: M }, undefined, { version: '1.0.2' }).issues, 'model'),
    ).toEqual(['error:version']);
    expect(
      codes(
        validateServeValues({ model: 'incoai/X-Splash' }, undefined, { version: '1.0' }).issues,
        'port',
      ),
    ).toEqual(['error:version']);
  });
});

describe('cross-field rules', () => {
  it('warns that unmet requires drop the value', () => {
    const r = validateServeValues({ model: M, persistent_cache: true, announce_served_name: true });
    expect(codes(r.issues, 'persistent_cache')).toEqual(['warning:requires']);
    expect(r.warnings.persistent_cache?.[0]).toContain('"SSD cache size" above 0');
    expect(codes(r.issues, 'announce_served_name')).toEqual(['warning:requires']);
    expect(r.valid).toBe(true);
  });

  it('chains requires and hides disabled_when fields', () => {
    const state = resolveServeState({
      model: M,
      max_cache_disk: '0',
      persistent_cache: true,
      cache_dir: '/x',
      language_only: true,
    });
    expect(state.get('persistent_cache')).toMatchObject({ dropped: true, value: false });
    expect(state.get('cache_dir')).toMatchObject({ dropped: true, hidden: true });
    expect(state.get('max_image_pixels')).toMatchObject({ dropped: true, hidden: true });
    const r = validateServeValues({ model: M, language_only: true, max_image_pixels: 65536 });
    expect(r.issues.filter((i) => i.key === 'max_image_pixels')).toEqual([]);
  });

  it('disables source options for legacy packages', () => {
    const state = resolveServeState({
      model: 'incoai/Qwen3.8-27B-Splash',
      revision: 'main',
      language_only: true,
    });
    expect(state.get('revision')?.disabledReason).toMatch(/Inco Splash packages/);
    expect(state.get('language_only')?.dropped).toBe(true);
    expect(
      codes(
        validateServeValues({ model: 'incoai/Qwen3.8-27B-Splash', revision: 'main' }).issues,
        'revision',
      ),
    ).toEqual(['warning:requires']);
  });

  it('warns about exposing the server without an API key', () => {
    const open = validateServeValues({ model: M, host: '0.0.0.0', allowed_origin: ['*'] });
    expect(codes(open.issues, 'host')).toEqual(['warning:security']);
    expect(codes(open.issues, 'allowed_origin')).toEqual(['warning:security']);
    const keyed = validateServeValues(
      { model: M, host: '0.0.0.0', allowed_origin: ['*'] },
      undefined,
      { apiKeySet: true },
    );
    expect(keyed.issues).toEqual([]);
    const specific = validateServeValues({ model: M, host: '192.168.1.5', api_key: 'k' });
    expect(codes(specific.issues, 'host')).toEqual(['warning:hint']);
  });

  it('notes crash-trace privacy and offline without the model', () => {
    expect(
      codes(validateServeValues({ model: M, crash_trace: true }).issues, 'crash_trace'),
    ).toEqual(['warning:privacy']);
    expect(
      codes(
        validateServeValues({ model: M, offline: true }, undefined, { modelInstalled: false })
          .issues,
        'offline',
      ),
    ).toEqual(['error:requires']);
  });
});

describe('capacity', () => {
  it("caps --max-memory at Splash's own GPU budget", () => {
    // 2% of 48 GiB is under 1 GiB, so the 1 GiB floor applies; at 128 GiB the 2% wins.
    expect(gpuMemoryCapBytes(48 * GiB)).toBe(47 * GiB);
    expect(gpuMemoryCapBytes(128 * GiB)).toBe(134690174403);
    expect(gpuMemoryCapBytes(20 * GiB)).toBe(19 * GiB);
    const r = validateServeValues({ model: M, max_memory: '48G' }, undefined, {
      gpuBudgetBytes: 48 * GiB,
    });
    expect(codes(r.issues, 'max_memory')).toEqual(['warning:capacity']);
    expect(
      validateServeValues({ model: M, max_memory: '40G' }, undefined, { gpuBudgetBytes: 48 * GiB })
        .issues,
    ).toEqual([]);
    expect(
      codes(
        validateServeValues({ model: M, max_memory: '60G' }, undefined, { ramBytes: 64 * GiB })
          .issues,
        'max_memory',
      ),
    ).toEqual(['warning:capacity']);
    expect(codes(validateServeValues({ model: M, max_memory: 0 }).issues, 'max_memory')).toEqual([
      'error:range',
    ]);
  });

  it('caps context at the measured maximum', () => {
    const r = validateServeValues({ model: M, max_context: '256K' }, undefined, {
      contextMax: 180000,
    });
    expect(r.errors.max_context?.[0]).toContain('180,000 tokens');
    expect(
      validateServeValues({ model: M, max_context: '300K' }).errors.max_context?.[0],
    ).toContain('262,144');
    expect(
      codes(
        validateServeValues({ model: M, max_context: '64K' }, undefined, { hasCodingAgent: true })
          .issues,
        'max_context',
      ),
    ).toEqual(['warning:capacity']);
  });

  it('warns about tiny or oversized SSD caches', () => {
    expect(
      codes(validateServeValues({ model: M, max_cache_disk: '100M' }).issues, 'max_cache_disk'),
    ).toEqual(['warning:capacity']);
    expect(
      codes(
        validateServeValues({ model: M, max_cache_disk: '64G' }, undefined, {
          freeDiskBytes: 10 * GiB,
        }).issues,
        'max_cache_disk',
      ),
    ).toEqual(['warning:capacity']);
    expect(validateServeValues({ model: M, max_cache_disk: (512 * MiB) / GiB }).issues).toEqual([]);
  });
});
