/**
 * Builds `POST /v1/chat/completions` bodies from the chat settings, the
 * conversation and what the server supports (docs/splash-api.md section 5,
 * docs/splash-params.json `request[]`, docs/terminal-parity.md section 5).
 *
 * Rules applied by `buildChatRequest`:
 * - Always `stream: true`, `stream_options.include_usage: true`,
 *   `return_progress: true` and an explicit `max_tokens` (Splash 1.2 would
 *   otherwise allow the rest of the context).
 * - Only fields the user set are sent (Splash's defaults are Qwen's).
 * - Fields newer than the server's version are dropped (`min_p`, penalties,
 *   `ignore_eos`, `chat_template_kwargs` need 1.2.0; `priority` 1.0.2; a
 *   disabled `top_k` of 0/-1 needs 1.2.0).
 * - Out-of-range values are dropped; mutually exclusive fields are resolved
 *   (stop vs callable tools / structured output, ignore_eos vs tools /
 *   structured output).
 * - Thinking: the UI level maps to `reasoning_effort` per model
 *   (`reasoningProfile`). A forced `enable_thinking` (template kwarg, 1.2+)
 *   always wins in Splash, so a contradicting effort is dropped rather than
 *   sent alongside it.
 * - Images must be base64 `data:` URLs (JPEG/PNG/WEBP/GIF, 32 MiB each, 64
 *   per request); PDFs 64 MiB in total; both need a vision model.
 *
 * Every adjustment is reported in `notes` so the UI can explain it. A note
 * with `level: 'error'` means Splash would reject the request as built.
 */
import type {
  ChatCompletionRequest,
  ChatMessage,
  FilePart,
  ImageUrlPart,
  ModelInfo,
  ModelsResponse,
  ReasoningEffort,
  RequestPriority,
  ResponseFormat,
  StatusResponse,
  ToolChoice,
  ToolDefinition,
  UserContentPart,
} from './types';

// ---------------------------------------------------------------------------
// Settings and capabilities
// ---------------------------------------------------------------------------

/** The UI's thinking control: a dial (Off/Low/Medium/High) or a switch (Off/On). */
export type ThinkingLevel = 'off' | 'on' | 'low' | 'medium' | 'high';

/**
 * Per-chat settings. Keys follow `docs/splash-params.json` `request[].key`
 * so a form generated from that file maps 1:1. `undefined`/`null` = not set
 * (server default), except `return_progress`, which defaults to true.
 */
export interface ChatSettings {
  system_prompt?: string | null;
  /** UI thinking control, mapped per model by `reasoningProfile`. */
  thinking?: ThinkingLevel | null;
  /** Raw override (advanced); wins over `thinking`. */
  reasoning_effort?: ReasoningEffort | null;
  /** Tri-state "Force thinking on/off" (`chat_template_kwargs.enable_thinking`, 1.2+). */
  enable_thinking?: boolean | null;
  chat_template_kwargs?: Record<string, unknown> | null;
  preserve_thinking?: boolean | null;
  temperature?: number | null;
  top_p?: number | null;
  top_k?: number | null;
  min_p?: number | null;
  seed?: number | null;
  presence_penalty?: number | null;
  frequency_penalty?: number | null;
  repetition_penalty?: number | null;
  /** Max reply tokens, thinking included. Unset = `DEFAULT_MAX_TOKENS` (clamped to the context). */
  max_tokens?: number | null;
  stop?: string[] | null;
  ignore_eos?: boolean | null;
  response_format?: ResponseFormat | null;
  tools?: ToolDefinition[] | null;
  tool_choice?: ToolChoice | null;
  parallel_tool_calls?: boolean | null;
  priority?: RequestPriority | null;
  /** Seconds. */
  timeout?: number | null;
  /** Default true. */
  return_progress?: boolean | null;
}

/** What the connected server supports. Unknown fields mean "assume Splash 1.2.0". */
export interface ServerCapabilities {
  /** Splash version, e.g. `1.2.0` (`splash --version`, or `inferServerVersion`). */
  version?: string;
  /** `/v1/models` context_length, or `/status.maximum_context_tokens`. */
  contextLength?: number;
  /** `/v1/models` `vision`. Unset (1.0): images allowed, PDFs not. */
  vision?: boolean;
  /** `/v1/models` `input_modalities`. */
  inputModalities?: string[];
  /** Model family for the thinking control, e.g. `/status.memory_plan.model.model_name` ("Qwen3.8-27B"). */
  modelFamily?: string;
}

export interface BuildOptions {
  /**
   * Prompt tokens of this request, if known (previous turn's
   * `usage.prompt_tokens` plus an estimate, or `/tokenize`). Used to clamp
   * `max_tokens` so prompt + max_tokens fits the context.
   */
  promptTokens?: number;
}

export interface RequestNote {
  /** Request field (or `messages`) the note is about. */
  field: string;
  /** `error`: Splash would reject the request; `warning`: a setting was dropped; `info`: adjusted. */
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface BuiltChatRequest {
  request: ChatCompletionRequest;
  notes: RequestNote[];
}

/** The version this app targets; used when the server's version is unknown. */
export const TARGET_SPLASH_VERSION = '1.2.0';
/** Default reply budget when the user sets none (Splash's pre-1.2 implicit cap). */
export const DEFAULT_MAX_TOKENS = 32_768;

export const IMAGE_LIMITS = {
  /** Decoded bytes per image. */
  maxBytes: 32 * 1024 * 1024,
  maxPerRequest: 64,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as readonly string[],
} as const;

export const PDF_LIMITS = {
  /** Decoded bytes of all PDFs in one request. */
  maxTotalBytes: 64 * 1024 * 1024,
  /** Pages of all PDFs in one request (checked by Splash, not here). */
  maxTotalPages: 64,
  mimeType: 'application/pdf',
} as const;

/** `chat_template_kwargs` keys Splash refuses (400). */
export const RESERVED_TEMPLATE_KWARGS: readonly string[] = [
  'add_generation_prompt',
  'chat_template',
  'continue_final_message',
  'conversation',
  'documents',
  'messages',
  'return_dict',
  'tokenize',
  'tools',
];

const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

const TOOL_NAME = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_SEED = Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------------------
// Versions and capabilities
// ---------------------------------------------------------------------------

/** Compares dotted versions numerically (`1.0.2` < `1.2.0`); a missing part counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** True when the server is at least `minVersion` (unknown version = target 1.2.0). */
export function supports(capabilities: ServerCapabilities, minVersion: string): boolean {
  return compareVersions(capabilities.version ?? TARGET_SPLASH_VERSION, minVersion) >= 0;
}

/**
 * Best guess of the server version from what it serves (docs 13): schema 6
 * is 1.2.0; schema 5 with `/v1/models` context fields is 1.1.0; schema 5
 * without them is treated as 1.0.0 (the most conservative).
 */
export function inferServerVersion(input: {
  status?: Pick<StatusResponse, 'schema_version'>;
  model?: ModelInfo;
}): string | undefined {
  const schema = input.status?.schema_version;
  if (schema !== undefined && schema >= 6) return '1.2.0';
  const has11Fields =
    input.model?.context_length !== undefined || input.model?.vision !== undefined;
  if (schema === 5) return has11Fields ? '1.1.0' : '1.0.0';
  if (has11Fields) return '1.1.0';
  return undefined;
}

/** Capabilities from `/v1/models`, `/status` and an optional known version. */
export function capabilitiesFrom(input: {
  models?: ModelsResponse;
  status?: StatusResponse;
  /** Known version (e.g. `splash --version`); otherwise inferred. */
  version?: string;
  /** Which `/v1/models` entry is used; default the first. */
  modelId?: string;
}): ServerCapabilities {
  const model =
    input.models?.data.find((entry) => entry.id === input.modelId) ?? input.models?.data[0];
  const capabilities: ServerCapabilities = {};
  const version = input.version ?? inferServerVersion({ status: input.status, model });
  if (version !== undefined) capabilities.version = version;
  const context =
    model?.context_length ?? model?.max_model_len ?? input.status?.maximum_context_tokens;
  if (context !== undefined) capabilities.contextLength = context;
  const vision = model?.vision ?? input.status?.vision;
  if (vision !== undefined) capabilities.vision = vision;
  const modalities = model?.input_modalities ?? input.status?.input_modalities;
  if (modalities !== undefined) capabilities.inputModalities = [...modalities];
  const family = input.status?.memory_plan?.model?.model_name ?? model?.root ?? model?.id;
  if (family !== undefined) capabilities.modelFamily = family;
  return capabilities;
}

// ---------------------------------------------------------------------------
// Reasoning profile
// ---------------------------------------------------------------------------

export interface ReasoningProfile {
  /** `dial`: Off/Low/Medium/High. `switch`: Off/On. */
  kind: 'dial' | 'switch';
  /** Levels to offer, in order. */
  levels: readonly ThinkingLevel[];
  /** What each level sends; `null` = omit `reasoning_effort` (template default). */
  effort: (level: ThinkingLevel) => ReasoningEffort | null;
  /** The model's own default when nothing is sent. */
  defaultLevel: ThinkingLevel;
}

const QWEN_27B: ReasoningProfile = {
  kind: 'dial',
  levels: ['off', 'low', 'medium', 'high'],
  // The template accepts low, medium, xhigh; Splash aliases high/max -> xhigh.
  effort: (level) =>
    level === 'off'
      ? 'none'
      : level === 'low'
        ? 'low'
        : level === 'medium'
          ? 'medium'
          : level === 'high'
            ? 'xhigh'
            : null,
  defaultLevel: 'high',
};

const QWEN_35B_A3B: ReasoningProfile = {
  kind: 'switch',
  levels: ['off', 'on'],
  effort: (level) => (level === 'off' ? 'none' : null),
  defaultLevel: 'on',
};

const GENERIC: ReasoningProfile = {
  kind: 'dial',
  levels: ['off', 'low', 'medium', 'high'],
  effort: (level) =>
    level === 'off'
      ? 'none'
      : level === 'low'
        ? 'low'
        : level === 'medium'
          ? 'medium'
          : level === 'high'
            ? 'high'
            : null,
  defaultLevel: 'high',
};

/**
 * The thinking control for a model id or family name: Qwen3.8-27B is a dial
 * (none/low/medium/xhigh), Qwen3.6-35B-A3B a switch (Off sends `none`, On
 * sends nothing). Unknown models get a dial that sends `high` for High.
 */
export function reasoningProfile(model: string | undefined): ReasoningProfile {
  const name = (model ?? '').toLowerCase();
  if (/qwen3\.6-35b-a3b/.test(name)) return QWEN_35B_A3B;
  if (/qwen3\.8-27b/.test(name)) return QWEN_27B;
  return GENERIC;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/** Decoded byte length of a base64 payload. */
export function base64DecodedBytes(base64: string): number {
  const clean = base64.replace(/\s/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export interface DataUrlInfo {
  mime: string;
  base64: boolean;
  /** Decoded payload size. */
  bytes: number;
}

/** Parses a `data:` URL header; undefined if `url` is not one. */
export function parseDataUrl(url: string): DataUrlInfo | undefined {
  const match = /^data:([^;,]*)((?:;[^;,]*)*),/i.exec(url);
  if (!match) return undefined;
  const mime = (match[1] ?? '').toLowerCase();
  const base64 = /;base64/i.test(match[2] ?? '');
  const payload = url.slice(match[0].length);
  const bytes = base64 ? base64DecodedBytes(payload) : decodeURIComponent(payload).length;
  return { mime, base64, bytes };
}

/** Base64 of raw bytes (chunked, safe for large files). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export class AttachmentError extends Error {
  override readonly name = 'AttachmentError';
}

/**
 * Encodes a picked file as a content part: an image as an `image_url` data
 * URL, a PDF as a `file` part. Throws `AttachmentError` for other types or
 * files over the per-item limit.
 */
export async function encodeAttachment(
  file: Blob & { name?: string },
): Promise<ImageUrlPart | FilePart> {
  const mime = (file.type || '').toLowerCase();
  if (IMAGE_LIMITS.mimeTypes.includes(mime)) {
    if (file.size > IMAGE_LIMITS.maxBytes) {
      throw new AttachmentError(`${file.name ?? 'Image'} is larger than 32 MiB`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { type: 'image_url', image_url: { url: toDataUrl(bytes, mime) } };
  }
  if (mime === PDF_LIMITS.mimeType) {
    if (file.size > PDF_LIMITS.maxTotalBytes) {
      throw new AttachmentError(`${file.name ?? 'PDF'} is larger than 64 MiB`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const part: FilePart = { type: 'file', file: { file_data: toDataUrl(bytes, mime) } };
    if (file.name) part.file.filename = file.name;
    return part;
  }
  throw new AttachmentError(
    `Unsupported attachment type ${mime || 'unknown'}: use JPEG, PNG, WEBP, GIF or PDF`,
  );
}

function imageUrlOf(part: ImageUrlPart): string {
  return typeof part.image_url === 'string' ? part.image_url : part.image_url.url;
}

function fileDataOf(part: FilePart): string | undefined {
  const data = part.file.file_data;
  return typeof data === 'string' ? data : undefined;
}

/** Validates and filters attachments in place of the messages; returns new messages. */
function checkAttachments(
  messages: ChatMessage[],
  capabilities: ServerCapabilities,
  notes: RequestNote[],
): ChatMessage[] {
  const visionOff = capabilities.vision === false;
  const pdfAllowed =
    !visionOff &&
    (capabilities.inputModalities
      ? capabilities.inputModalities.includes('pdf')
      : capabilities.vision === true);
  let images = 0;
  let pdfBytes = 0;
  let droppedImages = 0;
  let droppedPdfs = 0;

  const keepImage = (part: ImageUrlPart): boolean => {
    const url = imageUrlOf(part);
    const info = parseDataUrl(url);
    if (visionOff) {
      droppedImages++;
      return false;
    }
    if (!info || !info.base64) {
      notes.push({
        field: 'messages',
        level: 'error',
        message: 'Images must be base64 data: URLs; web links are not fetched. Image removed.',
      });
      return false;
    }
    if (!IMAGE_LIMITS.mimeTypes.includes(info.mime)) {
      notes.push({
        field: 'messages',
        level: 'error',
        message: `Image type ${info.mime || 'unknown'} is not supported (JPEG, PNG, WEBP, GIF). Image removed.`,
      });
      return false;
    }
    if (info.bytes > IMAGE_LIMITS.maxBytes) {
      notes.push({
        field: 'messages',
        level: 'error',
        message: 'An image is larger than 32 MiB. Image removed.',
      });
      return false;
    }
    images++;
    if (images > IMAGE_LIMITS.maxPerRequest) {
      notes.push({
        field: 'messages',
        level: 'error',
        message: `More than ${IMAGE_LIMITS.maxPerRequest} images in one request. Extra images removed.`,
      });
      return false;
    }
    return true;
  };

  const keepPdf = (part: FilePart): boolean => {
    if (!pdfAllowed) {
      droppedPdfs++;
      return false;
    }
    const data = fileDataOf(part);
    const info = data === undefined ? undefined : parseDataUrl(data);
    const bytes = info ? info.bytes : data !== undefined ? base64DecodedBytes(data) : 0;
    if (info && info.mime !== PDF_LIMITS.mimeType) {
      notes.push({ field: 'messages', level: 'error', message: 'Only PDF files can be attached.' });
      return false;
    }
    pdfBytes += bytes;
    if (pdfBytes > PDF_LIMITS.maxTotalBytes) {
      notes.push({
        field: 'messages',
        level: 'error',
        message: 'PDFs in one request exceed 64 MiB in total. PDF removed.',
      });
      return false;
    }
    return true;
  };

  const filterParts = <P extends { type: string }>(parts: P[]): P[] =>
    parts.filter((part) => {
      if (part.type === 'image_url') return keepImage(part as unknown as ImageUrlPart);
      if (part.type === 'file') return keepPdf(part as unknown as FilePart);
      return true;
    });

  const out = messages.map((message): ChatMessage => {
    if (message.role === 'user' && Array.isArray(message.content)) {
      return { ...message, content: filterParts<UserContentPart>(message.content) };
    }
    if (message.role === 'tool' && Array.isArray(message.content)) {
      return { ...message, content: filterParts(message.content) };
    }
    return message;
  });

  if (droppedImages > 0) {
    notes.push({
      field: 'messages',
      level: 'error',
      message: `This server has no vision (--language-only); ${droppedImages} image(s) removed.`,
    });
  }
  if (droppedPdfs > 0) {
    notes.push({
      field: 'messages',
      level: 'error',
      message: `This server does not accept PDFs; ${droppedPdfs} PDF(s) removed.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function isSet<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function inRange(value: number, min: number, max: number, exclusiveMin = false): boolean {
  return Number.isFinite(value) && (exclusiveMin ? value > min : value >= min) && value <= max;
}

/**
 * Builds the streaming chat request.
 *
 * @param messages the conversation (user/assistant/tool turns; images as content parts)
 * @param settings the chat's settings (only set fields are sent)
 * @param model a `/v1/models` id to send as `model`, or undefined for the loaded model
 * @param capabilities what the server supports (`capabilitiesFrom`)
 */
export function buildChatRequest(
  messages: ChatMessage[],
  settings: ChatSettings,
  model: string | undefined,
  capabilities: ServerCapabilities = {},
  options: BuildOptions = {},
): BuiltChatRequest {
  const notes: RequestNote[] = [];
  const v12 = supports(capabilities, '1.2.0');
  const versionLabel = capabilities.version ?? TARGET_SPLASH_VERSION;
  const tooOld = (field: string, minVersion: string) =>
    notes.push({
      field,
      level: 'warning',
      message: `${field} needs Splash ${minVersion} or later (server is ${versionLabel}); not sent.`,
    });
  const invalid = (field: string, message: string) =>
    notes.push({ field, level: 'error', message: `${message}; not sent.` });

  // Messages ------------------------------------------------------------------
  let conversation = checkAttachments(messages, capabilities, notes);
  const system = settings.system_prompt?.trim();
  if (system) {
    const first = conversation[0];
    const already =
      first !== undefined &&
      (first.role === 'system' || first.role === 'developer') &&
      first.content === settings.system_prompt;
    if (!already) {
      conversation = [
        { role: 'system', content: settings.system_prompt ?? system },
        ...conversation,
      ];
    }
  }
  if (!conversation.some((message) => message.role === 'user')) {
    notes.push({
      field: 'messages',
      level: 'error',
      message: 'The conversation must include a user message.',
    });
  }

  const request: ChatCompletionRequest = {
    messages: conversation,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (model) request.model = model;

  // Length --------------------------------------------------------------------
  let maxTokens = DEFAULT_MAX_TOKENS;
  if (isSet(settings.max_tokens)) {
    if (Number.isInteger(settings.max_tokens) && settings.max_tokens >= 1) {
      maxTokens = settings.max_tokens;
    } else {
      notes.push({
        field: 'max_tokens',
        level: 'warning',
        message: `max_tokens must be an integer >= 1; using ${DEFAULT_MAX_TOKENS}.`,
      });
    }
  }
  if (isSet(capabilities.contextLength)) {
    const remaining = capabilities.contextLength - (options.promptTokens ?? 0);
    if (remaining < 1) {
      notes.push({
        field: 'max_tokens',
        level: 'error',
        message: `The prompt (${options.promptTokens} tokens) fills the ${capabilities.contextLength}-token context.`,
      });
      maxTokens = 1;
    } else if (maxTokens > remaining) {
      if (isSet(settings.max_tokens)) {
        notes.push({
          field: 'max_tokens',
          level: 'info',
          message: `max_tokens lowered from ${maxTokens} to ${remaining} to fit the context.`,
        });
      }
      maxTokens = remaining;
    }
  }
  request.max_tokens = maxTokens;

  // Structured output and tools (decided first: other fields conflict with them)
  const tools = (settings.tools ?? []).filter((tool, index, all) => {
    const name = tool.function?.name ?? '';
    if (tool.type !== 'function' || !TOOL_NAME.test(name)) {
      invalid('tools', `Tool name "${name}" must match [A-Za-z0-9_-]{1,128}`);
      return false;
    }
    if (all.findIndex((other) => other.function?.name === name) !== index) {
      invalid('tools', `Tool name "${name}" is used twice`);
      return false;
    }
    return true;
  });
  if (tools.length > 0) request.tools = tools;

  let responseFormat = settings.response_format ?? undefined;
  if (responseFormat?.type === 'json_schema') {
    const schema = responseFormat.json_schema?.schema;
    if (!schema || typeof schema !== 'object') {
      invalid('response_format', 'json_schema needs json_schema.schema');
      responseFormat = undefined;
    }
  }
  const structured = responseFormat !== undefined && responseFormat.type !== 'text';
  if (responseFormat !== undefined && responseFormat.type !== 'text') {
    request.response_format = responseFormat;
  }

  const toolChoice = settings.tool_choice ?? undefined;
  if (toolChoice !== undefined) {
    if (typeof toolChoice === 'object') {
      const name = toolChoice.function?.name;
      if (!tools.some((tool) => tool.function.name === name)) {
        invalid('tool_choice', `tool_choice names "${name ?? ''}", which is not in tools`);
      } else {
        request.tool_choice = toolChoice;
      }
    } else if (toolChoice === 'required' && tools.length === 0) {
      invalid('tool_choice', 'tool_choice "required" needs at least one tool');
    } else if (tools.length > 0) {
      request.tool_choice = toolChoice;
    }
  }
  if (isSet(settings.parallel_tool_calls) && tools.length > 0) {
    request.parallel_tool_calls = settings.parallel_tool_calls;
  }
  const callableTools = tools.length > 0 && request.tool_choice !== 'none';

  // Stop / ignore_eos ---------------------------------------------------------
  const stop = (settings.stop ?? []).filter((item) => typeof item === 'string' && item !== '');
  if (stop.length > 0) {
    if (callableTools || structured) {
      notes.push({
        field: 'stop',
        level: 'warning',
        message: 'Stop sequences cannot be combined with tools or structured output; not sent.',
      });
    } else {
      if (stop.length > 4) {
        notes.push({
          field: 'stop',
          level: 'warning',
          message: 'At most 4 stop sequences; extra ones not sent.',
        });
      }
      request.stop = stop.slice(0, 4);
    }
  }
  if (settings.ignore_eos === true) {
    if (!v12) tooOld('ignore_eos', '1.2.0');
    else if (tools.length > 0 || structured) {
      notes.push({
        field: 'ignore_eos',
        level: 'warning',
        message: 'ignore_eos cannot be combined with tools or structured output; not sent.',
      });
    } else request.ignore_eos = true;
  }

  // Sampling ------------------------------------------------------------------
  if (isSet(settings.temperature)) {
    if (inRange(settings.temperature, 0, 2)) request.temperature = settings.temperature;
    else invalid('temperature', 'temperature must be a number in [0, 2]');
  }
  if (isSet(settings.top_p)) {
    if (inRange(settings.top_p, 0, 1, true)) request.top_p = settings.top_p;
    else invalid('top_p', 'top_p must be a number in (0, 1]');
  }
  if (isSet(settings.top_k)) {
    const k = settings.top_k;
    if (!Number.isInteger(k) || k < -1) {
      invalid('top_k', 'top_k must be 0 or -1 (disabled) or a positive integer');
    } else if (k <= 0 && !v12) {
      notes.push({
        field: 'top_k',
        level: 'warning',
        message: `Disabling top_k (0/-1) needs Splash 1.2.0 (server is ${versionLabel}); the server default applies.`,
      });
    } else {
      request.top_k = k;
    }
  }
  if (isSet(settings.seed)) {
    if (Number.isInteger(settings.seed) && settings.seed >= 0 && settings.seed <= MAX_SEED) {
      request.seed = settings.seed;
    } else {
      invalid('seed', `seed must be an integer from 0 to ${MAX_SEED}`);
    }
  }
  const gated12 = (
    field: 'min_p' | 'presence_penalty' | 'frequency_penalty' | 'repetition_penalty',
    value: number | null | undefined,
    neutral: number,
    valid: (value: number) => boolean,
    rule: string,
  ) => {
    if (!isSet(value)) return;
    if (!valid(value)) return invalid(field, rule);
    if (!v12) {
      // Older servers reject non-neutral values (400) and ignore neutral ones.
      if (value !== neutral) tooOld(field, '1.2.0');
      return;
    }
    request[field] = value;
  };
  gated12('min_p', settings.min_p, 0, (x) => inRange(x, 0, 1), 'min_p must be a number in [0, 1]');
  gated12(
    'presence_penalty',
    settings.presence_penalty,
    0,
    (x) => inRange(x, -2, 2),
    'presence_penalty must be a number in [-2, 2]',
  );
  gated12(
    'frequency_penalty',
    settings.frequency_penalty,
    0,
    (x) => inRange(x, -2, 2),
    'frequency_penalty must be a number in [-2, 2]',
  );
  gated12(
    'repetition_penalty',
    settings.repetition_penalty,
    1,
    (x) => Number.isFinite(x) && x > 0,
    'repetition_penalty must be a positive number',
  );

  // Reasoning -----------------------------------------------------------------
  let effort: ReasoningEffort | undefined;
  if (isSet(settings.reasoning_effort)) {
    if (REASONING_EFFORTS.includes(settings.reasoning_effort)) effort = settings.reasoning_effort;
    else
      invalid(
        'reasoning_effort',
        `reasoning_effort must be one of ${REASONING_EFFORTS.join(', ')}`,
      );
  } else if (isSet(settings.thinking)) {
    const profile = reasoningProfile(capabilities.modelFamily ?? model);
    let level = settings.thinking;
    if (profile.kind === 'switch' && level !== 'off' && level !== 'on') {
      notes.push({
        field: 'reasoning_effort',
        level: 'info',
        message: 'This model only switches thinking on or off; using On.',
      });
      level = 'on';
    }
    effort = profile.effort(level) ?? undefined;
  }

  let kwargs: Record<string, unknown> | undefined;
  if (isSet(settings.chat_template_kwargs)) {
    kwargs = {};
    for (const [key, value] of Object.entries(settings.chat_template_kwargs)) {
      if (RESERVED_TEMPLATE_KWARGS.includes(key)) {
        invalid('chat_template_kwargs', `chat_template_kwargs cannot set ${key}`);
      } else {
        kwargs[key] = value;
      }
    }
  }
  let enableThinking: boolean | undefined = isSet(settings.enable_thinking)
    ? settings.enable_thinking
    : undefined;
  if (kwargs && typeof kwargs.enable_thinking === 'boolean') {
    enableThinking ??= kwargs.enable_thinking;
    delete kwargs.enable_thinking;
  }

  // Splash renders enable_thinking = (effort != "none") unless the kwarg is
  // sent, and the kwarg silently wins. So express the override with at most
  // one of the two: Off is `reasoning_effort: "none"` (any version); On keeps
  // a thinking level, and needs the kwarg only when no level is sent.
  if (enableThinking === false) {
    if (effort !== undefined && effort !== 'none') {
      notes.push({
        field: 'reasoning_effort',
        level: 'info',
        message: 'Force thinking off overrides the thinking level.',
      });
    }
    effort = 'none';
  } else if (enableThinking === true) {
    if (effort === 'none') {
      notes.push({
        field: 'reasoning_effort',
        level: 'info',
        message: 'Force thinking on overrides thinking Off; reasoning_effort not sent.',
      });
      effort = undefined;
    }
    if (effort === undefined) {
      if (v12) kwargs = { ...kwargs, enable_thinking: true };
      else tooOld('enable_thinking', '1.2.0');
    }
  }
  if (effort !== undefined) request.reasoning_effort = effort;
  if (kwargs && Object.keys(kwargs).length > 0) {
    if (v12) request.chat_template_kwargs = kwargs;
    else tooOld('chat_template_kwargs', '1.2.0');
  }
  if (isSet(settings.preserve_thinking)) request.preserve_thinking = settings.preserve_thinking;

  // Delivery ------------------------------------------------------------------
  if (settings.return_progress !== false) request.return_progress = true;
  if (isSet(settings.priority)) {
    if (supports(capabilities, '1.0.2')) request.priority = settings.priority;
    else tooOld('priority', '1.0.2');
  }
  if (isSet(settings.timeout)) {
    if (Number.isFinite(settings.timeout) && settings.timeout > 0) {
      request.timeout = settings.timeout;
    } else {
      invalid('timeout', 'timeout must be a positive number of seconds');
    }
  }

  return { request, notes };
}
