import { describe, expect, it } from 'vitest';
import {
  defaultsFromCatalog,
  requestDefaultsFor,
  requestFieldsFor,
  validateRequestValues,
} from './request-fields';

const field = (key: string, version = '1.2.0', caps = {}) =>
  requestFieldsFor(version, caps).find((f) => f.key === key)!;

describe('requestFieldsFor', () => {
  it('gates fields by version with a reason', () => {
    expect(field('min_p')).toMatchObject({ available: true, disabledReason: null });
    expect(field('min_p', '1.1.0')).toMatchObject({
      available: false,
      disabledReason: 'Needs Splash 1.2.0 or newer (installed: 1.1.0).',
    });
    expect(field('priority', '1.0.1').available).toBe(false);
  });

  it('raises the top_k floor before 1.2.0', () => {
    expect(field('top_k').min).toBe(-1);
    expect(field('top_k', '1.1.0').min).toBe(1);
  });

  it('disables attachments on a text-only server', () => {
    expect(field('images', '1.2.0', { vision: false })).toMatchObject({ available: false });
    expect(field('pdf_files', '1.2.0', { vision: true }).available).toBe(true);
  });

  it('narrows reasoning choices per model', () => {
    const r27 = field('reasoning_effort', '1.2.0', {
      modelId: 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M',
    });
    expect(r27.choices?.map((c) => c.value)).toEqual(['none', 'low', 'medium', 'xhigh']);
    const r35 = field('reasoning_effort', '1.2.0', {
      modelId: 'mlx-community/Qwen3.6-35B-A3B-4bit',
    });
    expect(r35.choices).toEqual([
      { value: 'none', label: 'Off' },
      { value: null, label: 'On' },
    ]);
    expect(field('reasoning_effort', '1.2.0', { modelId: 'other/model' }).choices).toHaveLength(8);
  });

  it('marks internal fields with their UI value', () => {
    expect(field('stream')).toMatchObject({ internal: true, uiValue: true });
  });
});

describe('defaults', () => {
  it('collects catalog defaults without placeholders or nulls', () => {
    const d = defaultsFromCatalog();
    expect(d).toMatchObject({
      temperature: 1,
      top_p: 0.95,
      top_k: 20,
      stream: true,
      include_usage: true,
      return_progress: true,
      priority: 'normal',
      tool_choice: 'auto',
      response_format: { type: 'text' },
    });
    expect('model' in d).toBe(false);
    expect('seed' in d).toBe(false);
  });

  it('drops fields the installed Splash does not accept', () => {
    const d = requestDefaultsFor('1.1.0');
    expect('min_p' in d).toBe(false);
    expect('repetition_penalty' in d).toBe(false);
    expect(d.temperature).toBe(1);
  });

  it('returns fresh copies', () => {
    const a = defaultsFromCatalog();
    (a.response_format as { type: string }).type = 'json_object';
    expect(defaultsFromCatalog().response_format).toEqual({ type: 'text' });
  });
});

describe('validateRequestValues', () => {
  it('accepts the defaults', () => {
    expect(validateRequestValues(defaultsFromCatalog()).valid).toBe(true);
  });

  it('checks bounds and integers', () => {
    const r = validateRequestValues({ temperature: 3, top_p: 0, top_k: 1.5, seed: -1 });
    expect(r.errors.temperature).toEqual(['Temperature must be from 0 to 2.']);
    expect(r.errors.top_p).toEqual(['Top P must be more than 0.']);
    expect(r.errors.top_k).toEqual(['Top K must be a whole number.']);
    expect(r.errors.seed).toHaveLength(1);
  });

  it('gates top_k off and newer fields by version', () => {
    expect(
      validateRequestValues({ top_k: 0 }, undefined, { version: '1.1.0' }).issues[0],
    ).toMatchObject({
      code: 'version',
      minVersion: '1.2.0',
    });
    expect(validateRequestValues({ top_k: 0 }).valid).toBe(true);
    expect(
      validateRequestValues({ min_p: 0.1 }, undefined, { version: '1.1.0' }).issues[0]?.code,
    ).toBe('version');
    expect(validateRequestValues({ min_p: 0 }, undefined, { version: '1.1.0' }).valid).toBe(true);
    expect(
      validateRequestValues({ images: ['data:'] }, undefined, { vision: false }).issues[0]?.code,
    ).toBe('requires');
  });

  it('enforces conflicts and tool choice', () => {
    const tools = [{ type: 'function', function: { name: 'get_time' } }];
    expect(validateRequestValues({ stop: ['x'], tools }).errors.stop?.[0]).toBe(
      'Stop sequences cannot be combined with tools.',
    );
    expect(
      validateRequestValues({ ignore_eos: true, response_format: { type: 'json_object' } })
        .issues[0]?.code,
    ).toBe('conflict');
    expect(validateRequestValues({ stop: ['x'], response_format: { type: 'text' } }).valid).toBe(
      true,
    );
    expect(validateRequestValues({ stop: ['a', 'b', 'c', 'd', 'e'] }).errors.stop).toEqual([
      'Use at most 4 stop sequences.',
    ]);
    expect(validateRequestValues({ tool_choice: 'required' }).errors.tool_choice).toEqual([
      'Add a tool before requiring one.',
    ]);
    expect(
      validateRequestValues({
        tools,
        tool_choice: { type: 'function', function: { name: 'get_time' } },
      }).valid,
    ).toBe(true);
    expect(
      validateRequestValues({
        tools,
        tool_choice: { type: 'function', function: { name: 'nope' } },
      }).valid,
    ).toBe(false);
  });

  it('refuses reserved template variables and unknown keys', () => {
    expect(
      validateRequestValues({ chat_template_kwargs: { tools: [] } }).errors.chat_template_kwargs,
    ).toEqual(['Template variables cannot set tools.']);
    expect(validateRequestValues({ warp: 1 }).issues[0]?.code).toBe('unknown_key');
  });
});
