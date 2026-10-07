import { describe, expect, it } from 'vitest';
import modelsJson from '../../../fixtures/splash-1.2.0/models.json';
import reqImageJson from '../../../fixtures/splash-1.2.0/req_chat_image.json';
import reqNoThinkingJson from '../../../fixtures/splash-1.2.0/req_chat_stream_no_thinking.json';
import reqThinkingJson from '../../../fixtures/splash-1.2.0/req_chat_stream_thinking.json';
import reqToolsJson from '../../../fixtures/splash-1.2.0/req_chat_tools_stream.json';
import statusIdleJson from '../../../fixtures/splash-1.2.0/status_idle.json';
import {
  AttachmentError,
  DEFAULT_MAX_TOKENS,
  base64DecodedBytes,
  buildChatRequest,
  capabilitiesFrom,
  compareVersions,
  encodeAttachment,
  inferServerVersion,
  parseDataUrl,
  reasoningProfile,
  type ChatSettings,
  type RequestNote,
  type ServerCapabilities,
} from './request';
import type {
  ChatCompletionRequest,
  ChatMessage,
  ModelsResponse,
  StatusResponse,
  ToolDefinition,
} from './types';

const MODEL = 'incoai/Qwen3.8-27B-Splash';
const models = modelsJson as ModelsResponse;
const status = structuredClone(statusIdleJson) as unknown as StatusResponse;
const caps: ServerCapabilities = capabilitiesFrom({ models, status });
const OLD: ServerCapabilities = { ...caps, version: '1.1.0' };
const USER: ChatMessage[] = [{ role: 'user', content: 'In one sentence: why is the sky blue?' }];

/** Fields this module always adds that the recorded requests did not send. */
function withoutExtras(request: ChatCompletionRequest) {
  const { return_progress: _progress, ...rest } = request;
  return rest;
}

function fields(notes: RequestNote[]): string[] {
  return notes.map((note) => `${note.level}:${note.field}`);
}

describe('capabilities', () => {
  it('reads /v1/models and /status (1.2.0 fixtures)', () => {
    expect(caps).toEqual({
      version: '1.2.0',
      contextLength: 262144,
      vision: true,
      inputModalities: ['text', 'image', 'pdf'],
      modelFamily: 'Qwen3.8-27B',
    });
  });

  it('infers older versions from what the server serves', () => {
    expect(inferServerVersion({ status: { schema_version: 5 }, model: models.data[0] })).toBe(
      '1.1.0',
    );
    expect(
      inferServerVersion({
        status: { schema_version: 5 },
        model: { id: 'm', object: 'model', created: 0, owned_by: 'splash' },
      }),
    ).toBe('1.0.0');
    expect(inferServerVersion({})).toBeUndefined();
  });

  it('compares versions numerically', () => {
    expect(compareVersions('1.0.2', '1.2.0')).toBe(-1);
    expect(compareVersions('1.10.0', '1.2.0')).toBe(1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });
});

describe('buildChatRequest: recorded requests', () => {
  it('matches req_chat_stream_thinking.json (default thinking)', () => {
    const { request, notes } = buildChatRequest(USER, { max_tokens: 1024 }, MODEL, caps);
    expect(withoutExtras(request)).toEqual(reqThinkingJson);
    expect(request.return_progress).toBe(true);
    expect(notes).toEqual([]);
  });

  it('matches req_chat_stream_no_thinking.json (thinking Off)', () => {
    const { request } = buildChatRequest(USER, { max_tokens: 1024, thinking: 'off' }, MODEL, caps);
    expect(withoutExtras(request)).toEqual(reqNoThinkingJson);
  });

  it('matches req_chat_tools_stream.json (tools, thinking Low)', () => {
    const recorded = reqToolsJson as ChatCompletionRequest;
    const { request, notes } = buildChatRequest(
      recorded.messages,
      {
        max_tokens: 512,
        thinking: 'low',
        tools: recorded.tools as ToolDefinition[],
        tool_choice: 'auto',
      },
      MODEL,
      caps,
    );
    expect(withoutExtras(request)).toEqual(recorded);
    expect(notes).toEqual([]);
  });

  it('keeps a data: URL image (req_chat_image.json)', () => {
    const recorded = reqImageJson as ChatCompletionRequest;
    const { request, notes } = buildChatRequest(recorded.messages, {}, MODEL, caps);
    expect(request.messages).toEqual(recorded.messages);
    expect(notes).toEqual([]);
  });
});

describe('buildChatRequest: always-on fields', () => {
  it('streams with usage and progress and always sets max_tokens', () => {
    const { request } = buildChatRequest(USER, {}, undefined, {});
    expect(request).toEqual({
      messages: USER,
      stream: true,
      stream_options: { include_usage: true },
      return_progress: true,
      max_tokens: DEFAULT_MAX_TOKENS,
    });
    expect('model' in request).toBe(false);
  });

  it('clamps max_tokens to the context left by the prompt', () => {
    const small = { ...caps, contextLength: 8192 };
    expect(buildChatRequest(USER, {}, MODEL, small).request.max_tokens).toBe(8192);
    const built = buildChatRequest(USER, { max_tokens: 4000 }, MODEL, small, {
      promptTokens: 6000,
    });
    expect(built.request.max_tokens).toBe(2192);
    expect(fields(built.notes)).toEqual(['info:max_tokens']);
    const full = buildChatRequest(USER, {}, MODEL, small, { promptTokens: 9000 });
    expect(full.request.max_tokens).toBe(1);
    expect(fields(full.notes)).toEqual(['error:max_tokens']);
  });

  it('replaces an invalid max_tokens with the default', () => {
    const built = buildChatRequest(USER, { max_tokens: 0 }, MODEL, caps);
    expect(built.request.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(fields(built.notes)).toEqual(['warning:max_tokens']);
  });

  it('prepends the system prompt once and requires a user message', () => {
    const built = buildChatRequest(USER, { system_prompt: 'Be brief.' }, MODEL, caps);
    expect(built.request.messages[0]).toEqual({ role: 'system', content: 'Be brief.' });
    const again = buildChatRequest(
      built.request.messages,
      { system_prompt: 'Be brief.' },
      MODEL,
      caps,
    );
    expect(again.request.messages).toHaveLength(2);
    const noUser = buildChatRequest([{ role: 'system', content: 'x' }], {}, MODEL, caps);
    expect(fields(noUser.notes)).toEqual(['error:messages']);
  });

  it('can turn prompt progress off', () => {
    expect(
      buildChatRequest(USER, { return_progress: false }, MODEL, caps).request,
    ).not.toHaveProperty('return_progress');
  });
});

describe('buildChatRequest: thinking', () => {
  const effort = (settings: ChatSettings, model = MODEL, capabilities = caps) =>
    buildChatRequest(USER, settings, model, capabilities).request;

  it('maps Off/Low/Medium/High to none/low/medium/xhigh for Qwen3.8-27B', () => {
    expect(effort({ thinking: 'off' }).reasoning_effort).toBe('none');
    expect(effort({ thinking: 'low' }).reasoning_effort).toBe('low');
    expect(effort({ thinking: 'medium' }).reasoning_effort).toBe('medium');
    expect(effort({ thinking: 'high' }).reasoning_effort).toBe('xhigh');
    expect(effort({}).reasoning_effort).toBeUndefined();
  });

  it('treats Qwen3.6-35B-A3B as an on/off switch', () => {
    const switchCaps: ServerCapabilities = { version: '1.2.0', modelFamily: 'Qwen3.6-35B-A3B' };
    expect(effort({ thinking: 'off' }, undefined, switchCaps).reasoning_effort).toBe('none');
    expect(effort({ thinking: 'on' }, undefined, switchCaps)).not.toHaveProperty(
      'reasoning_effort',
    );
    const built = buildChatRequest(USER, { thinking: 'medium' }, undefined, switchCaps);
    expect(built.request).not.toHaveProperty('reasoning_effort');
    expect(fields(built.notes)).toEqual(['info:reasoning_effort']);
    expect(reasoningProfile('mlx-community/Qwen3.6-35B-A3B-4bit').levels).toEqual(['off', 'on']);
  });

  it('sends high for High on an unknown model', () => {
    expect(effort({ thinking: 'high' }, 'other/model', { version: '1.2.0' }).reasoning_effort).toBe(
      'high',
    );
  });

  it('lets a raw reasoning_effort win over the dial', () => {
    expect(effort({ thinking: 'low', reasoning_effort: 'max' }).reasoning_effort).toBe('max');
  });

  it('never sends enable_thinking together with a reasoning_effort', () => {
    // Force off: reasoning_effort none expresses it on every version.
    const off = buildChatRequest(USER, { thinking: 'high', enable_thinking: false }, MODEL, caps);
    expect(off.request.reasoning_effort).toBe('none');
    expect(off.request).not.toHaveProperty('chat_template_kwargs');
    expect(fields(off.notes)).toEqual(['info:reasoning_effort']);
    // Force on with a level: the level alone turns thinking on.
    const onLow = buildChatRequest(USER, { thinking: 'low', enable_thinking: true }, MODEL, caps);
    expect(onLow.request.reasoning_effort).toBe('low');
    expect(onLow.request).not.toHaveProperty('chat_template_kwargs');
    // Force on against Off: the kwarg wins in Splash, so the effort is dropped.
    const onOff = buildChatRequest(USER, { thinking: 'off', enable_thinking: true }, MODEL, caps);
    expect(onOff.request).not.toHaveProperty('reasoning_effort');
    expect(onOff.request.chat_template_kwargs).toEqual({ enable_thinking: true });
    // Force on with no level.
    expect(effort({ enable_thinking: true }).chat_template_kwargs).toEqual({
      enable_thinking: true,
    });
  });

  it('reads enable_thinking from chat_template_kwargs and drops reserved keys', () => {
    const built = buildChatRequest(
      USER,
      { chat_template_kwargs: { enable_thinking: false, tools: [], custom: 1 } },
      MODEL,
      caps,
    );
    expect(built.request.reasoning_effort).toBe('none');
    expect(built.request.chat_template_kwargs).toEqual({ custom: 1 });
    expect(fields(built.notes)).toEqual(['error:chat_template_kwargs']);
  });

  it('falls back without chat_template_kwargs before 1.2.0', () => {
    const off = buildChatRequest(USER, { enable_thinking: false }, MODEL, OLD);
    expect(off.request.reasoning_effort).toBe('none');
    const on = buildChatRequest(USER, { enable_thinking: true }, MODEL, OLD);
    expect(on.request).not.toHaveProperty('chat_template_kwargs');
    expect(fields(on.notes)).toEqual(['warning:enable_thinking']);
  });
});

describe('buildChatRequest: sampling and version gates', () => {
  it('sends only the fields that are set', () => {
    const { request, notes } = buildChatRequest(
      USER,
      {
        temperature: 0.7,
        top_p: 0.8,
        top_k: 20,
        min_p: 0,
        presence_penalty: 1.5,
        repetition_penalty: 1,
        seed: 42,
        priority: 'background',
        timeout: 30,
      },
      MODEL,
      caps,
    );
    expect(request).toMatchObject({
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
      min_p: 0,
      presence_penalty: 1.5,
      repetition_penalty: 1,
      seed: 42,
      priority: 'background',
      timeout: 30,
    });
    expect(request).not.toHaveProperty('frequency_penalty');
    expect(notes).toEqual([]);
  });

  it('drops 1.2-only fields on older servers (silently when neutral)', () => {
    const { request, notes } = buildChatRequest(
      USER,
      { min_p: 0.05, presence_penalty: 0, repetition_penalty: 1.1, top_k: -1, ignore_eos: true },
      MODEL,
      OLD,
    );
    expect(request).not.toHaveProperty('min_p');
    expect(request).not.toHaveProperty('presence_penalty');
    expect(request).not.toHaveProperty('repetition_penalty');
    expect(request).not.toHaveProperty('top_k');
    expect(request).not.toHaveProperty('ignore_eos');
    expect(fields(notes).sort()).toEqual(
      ['warning:ignore_eos', 'warning:min_p', 'warning:repetition_penalty', 'warning:top_k'].sort(),
    );
  });

  it('drops priority before 1.0.2', () => {
    const built = buildChatRequest(USER, { priority: 'foreground' }, MODEL, { version: '1.0.1' });
    expect(built.request).not.toHaveProperty('priority');
    expect(fields(built.notes)).toEqual(['warning:priority']);
  });

  it('drops out-of-range values with an error note', () => {
    const { request, notes } = buildChatRequest(
      USER,
      {
        temperature: 5,
        top_p: 0,
        top_k: 1.5,
        min_p: 2,
        presence_penalty: -3,
        repetition_penalty: 0,
        seed: -1,
        timeout: 0,
        reasoning_effort: 'huge' as never,
      },
      MODEL,
      caps,
    );
    for (const field of [
      'temperature',
      'top_p',
      'top_k',
      'min_p',
      'presence_penalty',
      'repetition_penalty',
      'seed',
      'timeout',
      'reasoning_effort',
    ]) {
      expect(request).not.toHaveProperty(field);
    }
    expect(notes.every((note) => note.level === 'error')).toBe(true);
    expect(notes).toHaveLength(9);
  });
});

describe('buildChatRequest: mutual exclusions', () => {
  const tool: ToolDefinition = {
    type: 'function',
    function: { name: 'get_weather', parameters: { type: 'object' } },
  };

  it('drops stop when tools are callable or output is structured', () => {
    const withTools = buildChatRequest(USER, { stop: ['END'], tools: [tool] }, MODEL, caps);
    expect(withTools.request).not.toHaveProperty('stop');
    expect(fields(withTools.notes)).toEqual(['warning:stop']);
    const toolsOff = buildChatRequest(
      USER,
      { stop: ['END'], tools: [tool], tool_choice: 'none' },
      MODEL,
      caps,
    );
    expect(toolsOff.request.stop).toEqual(['END']);
    const json = buildChatRequest(
      USER,
      { stop: ['END'], response_format: { type: 'json_object' } },
      MODEL,
      caps,
    );
    expect(json.request).not.toHaveProperty('stop');
    expect(json.request.response_format).toEqual({ type: 'json_object' });
  });

  it('limits stop to four non-empty strings', () => {
    const built = buildChatRequest(USER, { stop: ['a', '', 'b', 'c', 'd', 'e'] }, MODEL, caps);
    expect(built.request.stop).toEqual(['a', 'b', 'c', 'd']);
    expect(fields(built.notes)).toEqual(['warning:stop']);
  });

  it('drops ignore_eos with tools or a schema', () => {
    const built = buildChatRequest(
      USER,
      {
        ignore_eos: true,
        response_format: { type: 'json_schema', json_schema: { schema: { type: 'object' } } },
      },
      MODEL,
      caps,
    );
    expect(built.request).not.toHaveProperty('ignore_eos');
    expect(fields(built.notes)).toEqual(['warning:ignore_eos']);
    expect(buildChatRequest(USER, { ignore_eos: true }, MODEL, caps).request.ignore_eos).toBe(true);
  });

  it('validates tools and tool_choice', () => {
    const bad: ToolDefinition = { type: 'function', function: { name: 'bad name' } };
    const built = buildChatRequest(
      USER,
      {
        tools: [tool, tool, bad],
        tool_choice: { type: 'function', function: { name: 'missing' } },
        parallel_tool_calls: false,
      },
      MODEL,
      caps,
    );
    expect(built.request.tools).toEqual([tool]);
    expect(built.request).not.toHaveProperty('tool_choice');
    expect(built.request.parallel_tool_calls).toBe(false);
    expect(fields(built.notes)).toEqual(['error:tools', 'error:tools', 'error:tool_choice']);
    const required = buildChatRequest(USER, { tool_choice: 'required' }, MODEL, caps);
    expect(fields(required.notes)).toEqual(['error:tool_choice']);
    const plain = buildChatRequest(
      USER,
      { tool_choice: 'auto', parallel_tool_calls: true },
      MODEL,
      caps,
    );
    expect(plain.request).not.toHaveProperty('tool_choice');
    expect(plain.request).not.toHaveProperty('parallel_tool_calls');
  });

  it('does not send a text response_format and checks json_schema', () => {
    expect(
      buildChatRequest(USER, { response_format: { type: 'text' } }, MODEL, caps).request,
    ).not.toHaveProperty('response_format');
    const missing = buildChatRequest(
      USER,
      { response_format: { type: 'json_schema' } as never },
      MODEL,
      caps,
    );
    expect(missing.request).not.toHaveProperty('response_format');
    expect(fields(missing.notes)).toEqual(['error:response_format']);
  });
});

describe('attachments', () => {
  const png = `data:image/png;base64,${btoa('x'.repeat(30))}`;
  const pdf = `data:application/pdf;base64,${btoa('%PDF-1.7')}`;
  const withParts = (...parts: Exclude<ChatMessage['content'], string | null>): ChatMessage[] => [
    { role: 'user', content: [{ type: 'text', text: 'look' }, ...parts] as never },
  ];

  it('parses data: URLs and decoded sizes', () => {
    expect(parseDataUrl(png)).toEqual({ mime: 'image/png', base64: true, bytes: 30 });
    expect(parseDataUrl('https://example.com/a.png')).toBeUndefined();
    expect(base64DecodedBytes('YQ==')).toBe(1);
    expect(base64DecodedBytes('YWI=')).toBe(2);
  });

  it('removes web image links and unsupported types', () => {
    const built = buildChatRequest(
      withParts(
        { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
        { type: 'image_url', image_url: 'data:image/bmp;base64,AAAA' },
        { type: 'image_url', image_url: { url: png } },
      ),
      {},
      MODEL,
      caps,
    );
    const parts = built.request.messages[0]?.content as unknown[];
    expect(parts).toHaveLength(2);
    expect(fields(built.notes)).toEqual(['error:messages', 'error:messages']);
  });

  it('caps images at 64 per request', () => {
    const images = Array.from({ length: 66 }, () => ({
      type: 'image_url' as const,
      image_url: { url: png },
    }));
    const built = buildChatRequest(withParts(...images), {}, MODEL, caps);
    expect((built.request.messages[0]?.content as unknown[]).length).toBe(1 + 64);
  });

  it('strips images and PDFs when the server has no vision', () => {
    const built = buildChatRequest(
      withParts(
        { type: 'image_url', image_url: { url: png } },
        { type: 'file', file: { file_data: pdf } },
      ),
      {},
      MODEL,
      { ...caps, vision: false, inputModalities: ['text'] },
    );
    expect(built.request.messages[0]?.content).toEqual([{ type: 'text', text: 'look' }]);
    expect(fields(built.notes)).toEqual(['error:messages', 'error:messages']);
  });

  it('allows PDFs only when the server lists the pdf modality', () => {
    const parts = withParts({ type: 'file', file: { file_data: pdf, filename: 'a.pdf' } });
    expect(buildChatRequest(parts, {}, MODEL, caps).notes).toEqual([]);
    // 1.0 servers report no modalities: images yes, PDFs no.
    const legacy = buildChatRequest(parts, {}, MODEL, { version: '1.0.2' });
    expect(fields(legacy.notes)).toEqual(['error:messages']);
  });

  it('encodes picked files as data: URL parts', async () => {
    const image = await encodeAttachment(
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    );
    expect(image).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } });
    const file = Object.assign(new Blob(['%PDF'], { type: 'application/pdf' }), { name: 'x.pdf' });
    expect(await encodeAttachment(file)).toEqual({
      type: 'file',
      file: { file_data: `data:application/pdf;base64,${btoa('%PDF')}`, filename: 'x.pdf' },
    });
    await expect(encodeAttachment(new Blob(['x'], { type: 'text/plain' }))).rejects.toThrow(
      AttachmentError,
    );
  });
});
