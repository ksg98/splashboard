import { describe, expect, it } from 'vitest';
import { getCatalog } from './catalog';
import {
  applyPreset,
  applyRequestPreset,
  diffRequestValues,
  diffServeValues,
  generateApiKey,
  listPresets,
  placeholderResolver,
  presetMinVersion,
  presetsForMac,
  previewPreset,
  ramTierFor,
} from './presets';
import { GiB } from './values';

const catalog = getCatalog();
const preset = (id: string) => catalog.presets.find((p) => p.id === id)!;

describe('RAM tiers', () => {
  it('picks the nearest tier at or below this Mac', () => {
    expect(ramTierFor(24)).toEqual({ tierGb: 24, belowMinimum: false });
    expect(ramTierFor(18)).toEqual({ tierGb: 24, belowMinimum: true });
    expect(ramTierFor(40)).toEqual({ tierGb: 36, belowMinimum: false });
    expect(ramTierFor(192)).toEqual({ tierGb: 128, belowMinimum: false });
  });

  it('lists presets for a 64 GB Mac', () => {
    const mac = presetsForMac(64 * GiB, '1.2.0');
    expect(mac).toMatchObject({ ramGb: 64, tierGb: 64, belowMinimum: false });
    expect(mac.ram.map((o) => o.preset.id)).toEqual(['ram64-agent']);
    expect(mac.recipes.length).toBeGreaterThan(3);
    expect(mac.sampling.every((o) => o.available)).toBe(true);
  });

  it('marks presets the installed Splash cannot apply', () => {
    expect(presetMinVersion(preset('ram64-agent'))).toBe('1.2.0');
    expect(presetMinVersion(preset('ram96-quality'))).toBe('1.1.0');
    expect(presetMinVersion(preset('recipe-lan-share'))).toBe('1.0.2');
    const old = listPresets(catalog, { kind: 'ram', ramBytes: 64 * GiB, version: '1.1.0' });
    expect(old[0]).toMatchObject({
      available: false,
      disabledReason: 'Needs Splash 1.2.0 or newer (installed: 1.1.0).',
    });
    const sampling = listPresets(catalog, { kind: 'sampling', version: '1.1.0' });
    expect(sampling.find((o) => o.preset.id === 'sampling-instruct')?.available).toBe(false);
    expect(sampling.find((o) => o.preset.id === 'sampling-greedy')?.available).toBe(true);
  });
});

describe('applying presets', () => {
  it('resets the RAM profile before applying a RAM preset', () => {
    const from24 = applyPreset({ port: 9000 }, preset('ram24-agent-27b')).values;
    expect(from24).toEqual({
      port: 9000,
      model: 'unsloth/Qwen3.8-27B-GGUF:UD-IQ3_XXS',
      language_only: true,
    });
    const to128 = applyPreset({ ...from24, revision: 'abc' }, preset('ram128-longctx'));
    expect(to128.values).toEqual({
      port: 9000,
      model: 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL',
      max_memory: '64G',
      max_context: '256K',
    });
    expect(to128.pending).toEqual([]);
  });

  it('adds recipe keys and reports unresolved placeholders', () => {
    const result = applyPreset({ model: 'a/b' }, preset('recipe-lan-share'));
    expect(result.values).toEqual({ model: 'a/b', host: '0.0.0.0' });
    expect(result.pending.map((p) => [p.key, p.placeholder])).toEqual([
      ['api_key', '<generate>'],
      ['allowed_host', '<LocalHostName>.local'],
    ]);
  });

  it('fills placeholders from what the app knows', () => {
    const resolve = placeholderResolver({ localHostName: 'Studio', generateApiKey: () => 'KEY' });
    const result = applyPreset({}, preset('recipe-lan-share'), catalog, { resolve });
    expect(result.values).toEqual({
      host: '0.0.0.0',
      api_key: 'KEY',
      allowed_host: ['Studio.local'],
    });
    expect(result.pending).toEqual([]);
    const folder = applyPreset({}, preset('recipe-external-disk'), catalog, {
      resolve: placeholderResolver({ chosenFolder: '/Volumes/T7/hf' }),
    });
    expect(folder.values).toEqual({ hf_hub_cache: '/Volumes/T7/hf' });
  });

  it('generates base64url API keys of 32 bytes', () => {
    const key = generateApiKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateApiKey()).not.toBe(key);
  });

  it('applies sampling presets over the request values', () => {
    const instruct = applyRequestPreset(
      { temperature: 0.3, seed: 7, stop: ['x'] },
      preset('sampling-instruct'),
    ).values;
    expect(instruct).toMatchObject({
      temperature: 0.7,
      presence_penalty: 1.5,
      reasoning_effort: 'none',
      stop: ['x'],
    });
    const greedy = applyRequestPreset(instruct, preset('sampling-greedy')).values;
    expect(greedy).toEqual({ temperature: 0, seed: 1, stop: ['x'] });
  });
});

describe('change lists', () => {
  it('lists old -> new with restart flags, ignoring spelling differences', () => {
    const set = diffServeValues(
      { model: 'a/b', max_memory: 32, hf_endpoint: undefined },
      {
        model: 'a/b',
        max_memory: '32G',
        max_context: '128K',
        hf_endpoint: 'https://mirror.example.com',
      },
    );
    expect(set.changes.map((c) => [c.key, c.fromText, c.toText, c.restartRequired])).toEqual([
      ['max_context', 'Auto', '131,072 tokens', true],
      ['hf_endpoint', 'https://huggingface.co', 'https://mirror.example.com', false],
    ]);
    expect(set.restartRequired).toBe(true);
    const envOnly = diffServeValues({}, { hf_download_timeout: 30 });
    expect(envOnly.restartRequired).toBe(false);
  });

  it('never shows secret values', () => {
    const set = diffServeValues({ api_key: 'old' }, { api_key: 'new' });
    expect(set.changes).toEqual([
      expect.objectContaining({
        key: 'api_key',
        fromText: '••••',
        toText: 'Changed',
        from: null,
        to: null,
      }),
    ]);
    expect(diffServeValues({}, { api_key: 'k' }).changes[0]?.toText).toBe('Set');
  });

  it('diffs request values against catalog defaults', () => {
    const set = diffRequestValues({}, { temperature: 0.7, top_p: 0.95, priority: 'background' });
    expect(set.changes.map((c) => [c.key, c.fromText, c.toText])).toEqual([
      ['temperature', '1', '0.7'],
      ['priority', 'Normal', 'Background'],
    ]);
    expect(set.restartRequired).toBe(false);
  });

  it('previews a preset across serve and request values', () => {
    const preview = previewPreset({ model: 'a/b' }, {}, preset('ram64-agent'));
    expect(preview.changes.changes.map((c) => c.key)).toEqual([
      'model',
      'max_cache_disk',
      'persistent_cache',
    ]);
    expect(preview.changes.restartRequired).toBe(true);
    const sampling = previewPreset({}, {}, preset('sampling-benchmark'));
    expect(sampling.changes.changes.map((c) => c.key)).toEqual([
      'temperature',
      'max_tokens',
      'ignore_eos',
      'reasoning_effort',
    ]);
    expect(sampling.changes.restartRequired).toBe(false);
  });
});
