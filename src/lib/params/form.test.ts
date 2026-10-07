import { describe, expect, it } from 'vitest';
import { getCatalog } from './catalog';
import { toFormModel, toFormModels } from './form';
import { GiB } from './values';

const row = (model: ReturnType<typeof toFormModel>, key: string) =>
  model.groups.flatMap((g) => g.rows).find((r) => r.key === key);

describe('toFormModel (serve)', () => {
  it('groups rows by visibility in catalog order', () => {
    const model = toFormModel('memory_context');
    expect(model).toMatchObject({
      scope: 'serve',
      id: 'memory_context',
      label: 'Memory & context',
    });
    expect(model.groups.map((g) => [g.id, g.rows.map((r) => r.key)])).toEqual([
      ['basic', ['max_memory', 'max_context']],
      ['advanced', ['max_image_pixels']],
    ]);
  });

  it('carries everything a control needs', () => {
    const model = toFormModel('memory_context', {
      values: { model: 'a/b', max_memory: '32G' },
      ctx: { gpuBudgetBytes: 48 * GiB, contextMax: 200000 },
    });
    const memory = row(model, 'max_memory')!;
    expect(memory).toMatchObject({
      control: 'slider+auto',
      label: 'GPU memory limit',
      unit: 'GiB',
      value: '32G',
      numericValue: 32,
      display: '32 GiB',
      defaultValue: 'auto',
      isDefault: false,
      disabled: false,
      restartRequired: true,
      flag: '--max-memory',
      secret: false,
      issues: [],
    });
    expect(memory.bounds).toMatchObject({ min: 1, step: 1, dynamicMax: 47 });
    expect(memory.bounds.dynamicMaxNote).toContain('recommendedMaxWorkingSetSize');
    expect(memory.footnote).toContain("'auto' or a size");
    expect(row(model, 'max_context')).toMatchObject({
      value: 'auto',
      numericValue: null,
      display: 'Auto',
    });
    expect(row(model, 'max_context')?.bounds.dynamicMax).toBe(200000);
  });

  it('explains disabled and hidden rows', () => {
    const kv = toFormModel('kv_caches', { values: { model: 'a/b' }, ctx: { version: '1.1.0' } });
    expect(row(kv, 'persistent_cache')).toMatchObject({
      disabled: true,
      disabledReason: 'Needs Splash 1.2.0 or newer (installed: 1.1.0).',
    });
    const off = toFormModel('kv_caches', { values: { model: 'a/b' } });
    expect(row(off, 'persistent_cache')).toMatchObject({
      disabled: true,
      disabledReason: 'Set "SSD cache size" above 0 first.',
    });
    expect(row(off, 'cache_dir')).toMatchObject({ hidden: true });
    const on = toFormModel('kv_caches', {
      values: { model: 'a/b', max_cache_disk: '32G', persistent_cache: true },
    });
    expect(row(on, 'persistent_cache')?.disabled).toBe(false);
    expect(row(on, 'cache_dir')).toMatchObject({ hidden: false, disabled: false });
    const textOnly = toFormModel('memory_context', { values: { language_only: true } });
    expect(row(textOnly, 'max_image_pixels')?.hidden).toBe(true);
  });

  it('attaches field issues and marks secrets', () => {
    const security = toFormModel('security', {
      values: { model: 'a/b', api_key: 'x y', allowed_origin: ['*'] },
    });
    expect(row(security, 'api_key')).toMatchObject({
      secret: true,
      display: '••••',
      env: 'SPLASH_API_KEY',
    });
    expect(row(security, 'api_key')?.issues[0]?.level).toBe('error');
    expect(row(security, 'allowed_origin')?.issues).toEqual([]);
    const open = toFormModel('security', { values: { model: 'a/b', allowed_origin: ['*'] } });
    expect(row(open, 'allowed_origin')?.issues[0]?.code).toBe('security');
    expect(row(open, 'api_key')).toMatchObject({ display: 'Not set', value: null });
  });

  it('never shows internal entries and covers every section', () => {
    const models = toFormModels();
    expect(models.map((m) => m.id)).toEqual(getCatalog().sections.map((s) => s.id));
    const keys = models.flatMap((m) => m.groups.flatMap((g) => g.rows.map((r) => r.key)));
    expect(keys).not.toContain('hf_disable_progress_bars');
    expect(keys).toContain('hf_token');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('rejects unknown sections', () => {
    expect(() => toFormModel('nope')).toThrow(/unknown serve section/);
  });
});

describe('toFormModel (request)', () => {
  it('builds sampling rows with soft bounds and version reasons', () => {
    const model = toFormModel('sampling', {
      scope: 'request',
      values: { temperature: 0.7 },
      ctx: { version: '1.1.0' },
    });
    expect(model.groups).toHaveLength(1);
    const keys = model.groups[0]!.rows.map((r) => r.key);
    expect(keys).toEqual(['temperature', 'top_p', 'top_k', 'min_p', 'seed']);
    expect(row(model, 'temperature')).toMatchObject({
      value: 0.7,
      isDefault: false,
      display: '0.7',
    });
    expect(row(model, 'top_p')?.bounds).toMatchObject({ min: 0.01, exclusiveMin: 0, max: 1 });
    expect(row(model, 'top_k')?.bounds).toMatchObject({ min: 1, softMax: 200 });
    expect(row(model, 'min_p')).toMatchObject({ disabled: true });
  });

  it('hides internal request fields', () => {
    const delivery = toFormModel('delivery', { scope: 'request' });
    expect(delivery.groups[0]!.rows.map((r) => r.key)).toEqual(['priority', 'timeout']);
    expect(toFormModels({ scope: 'request' })).toHaveLength(getCatalog().request_sections.length);
  });
});
