/**
 * Splash HTTP API types, per docs/splash-api.md (recorded from a live 1.2.0
 * server; fixtures in fixtures/splash-1.2.0/).
 *
 * Conventions:
 * - Fields the server always sends on 1.2.0 are required; fields added in a
 *   later release, or absent from partial responses, are optional.
 * - `/status` sections are all optional: when the engine has no snapshot yet
 *   the body is only `{schema_version, ready, transport}`, and schema 5
 *   (Splash 1.0 to 1.1) lacks or renames some fields.
 * - String unions that the server may extend end with `(string & {})` so a
 *   newer server never breaks parsing while editors still autocomplete.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** An open string union: known values autocomplete, unknown ones still type-check. */
export type OpenString<Known extends string> = Known | (string & {});

/** Error body of a non-2xx response (OpenAI dialect, every non-`/v1/messages` route). */
export interface SplashErrorBody {
  error: {
    message: string;
    /** `server_error` when status >= 500, else `invalid_request_error`. */
    type: OpenString<'invalid_request_error' | 'server_error'>;
    code?: SplashErrorCode | null;
  };
}

/** `error.code` values from docs/splash-api.md section 11. */
export type SplashErrorCode = OpenString<
  | 'invalid_request_error'
  | 'context_length_exceeded'
  | 'capacity_exhausted'
  | 'invalid_thinking_signature'
  | 'authentication_error'
  | 'forbidden'
  | 'not_found'
  | 'model_not_found'
  | 'not_found_error'
  | 'previous_response_not_found'
  | 'request_timeout'
  | 'request_too_large'
  | 'engine_failed'
  | 'internal_server_error'
  | 'invalid_model_output'
  | 'scoring_unsupported'
  | 'engine_recovering'
  | 'server_shutdown'
  | 'frontend_overloaded'
  | 'mask_timeout'
  | 'resource_timeout'
>;

// ---------------------------------------------------------------------------
// /health, /ready
// ---------------------------------------------------------------------------

/** GET /health: always 200 once the socket listens. */
export interface HealthResponse {
  status: 'ok';
}

/** GET /ready: 200 `ready` while the engine is ready, else 503 `unavailable`. */
export interface ReadyResponse {
  status: 'ready' | 'unavailable';
}

// ---------------------------------------------------------------------------
// /v1/models
// ---------------------------------------------------------------------------

export type InputModality = OpenString<'text' | 'image' | 'pdf'>;

/** An entry of GET /v1/models `data` (and GET /v1/models/{id}). */
export interface ModelInfo {
  id: string;
  object: 'model';
  created: number;
  /** `"splash"` identifies a Splash server. */
  owned_by: string;
  /** 1.1+. */
  max_model_len?: number;
  /** 1.1+. */
  context_length?: number;
  /** 1.1+. Absent on 1.0: assume text + image, no PDF. */
  vision?: boolean;
  /** 1.1+. */
  input_modalities?: InputModality[];
  /** Set on `--served-model-name` aliases: the loaded model id. */
  root?: string;
  [key: string]: unknown;
}

/** GET /v1/models */
export interface ModelsResponse {
  object: 'list';
  data: ModelInfo[];
  /** TypeSafe-style list, `[{name, description, release_date}]`. */
  models?: { name: string; description?: string; release_date?: string }[];
}

// ---------------------------------------------------------------------------
// /status (schema_version 6; 5 tolerated)
// ---------------------------------------------------------------------------

export type MemoryPressure = OpenString<'normal' | 'warning' | 'critical'>;

export interface StatusAdmission {
  waiting: number;
  waiting_memory: number;
  waiting_concurrency: number;
  held_behind_refusal: number;
  /** Waiting for a disk restore. */
  restoring: number;
  suspended: number;
  draining: boolean;
  oldest_wait_ms: number;
}

export interface StatusDevice {
  device_name: string;
  macos_version: string;
  apple_gpu_family: number;
  gpu_core_count: number;
  physical_memory_bytes: number;
  recommended_max_working_set_bytes: number;
  max_buffer_length_bytes?: number;
  max_threadgroup_memory_bytes?: number;
  max_threadgroup_width?: number;
  has_unified_memory?: boolean;
  [key: string]: unknown;
}

export interface StatusModelMemory {
  target_weights_bytes: number;
  draft_weights_bytes: number;
  vision_weights_bytes: number;
  lane_state_bytes?: number;
  shared_prefill_bytes?: number;
  shared_decode_bytes?: number;
  pipeline_reserve_bytes?: number;
  runtime_overhead_reserve_bytes?: number;
  state_staging_bytes?: number;
  [key: string]: unknown;
}

export interface StatusPlanModel {
  model_name: string;
  maximum_context_tokens?: number;
  attention_layers?: number;
  kv_heads?: number;
  head_dimension?: number;
  kv_page_tokens?: number;
  kv_format?: string;
  kv_elements_per_scale?: number;
  kv_page_bytes?: number;
  memory?: StatusModelMemory;
  [key: string]: unknown;
}

export interface StatusBudget {
  physical_memory_bytes?: number;
  recommended_working_set_bytes?: number;
  /** 0 = auto. */
  configured_memory_limit_bytes?: number;
  working_set_margin_bytes?: number;
  hard_budget_bytes?: number;
  target_weights_bytes?: number;
  draft_weights_bytes?: number;
  vision_weights_bytes?: number;
  maximum_batch_width?: number;
  fixed_runtime_bytes?: number;
  dynamic_budget_bytes?: number;
  kv_page_tokens?: number;
  kv_page_bytes?: number;
  kv_extent_pages?: number;
  kv_extent_bytes?: number;
  kv_capacity_pages?: number;
  kv_capacity_bytes?: number;
  kv_capacity_tokens?: number;
  minimum_dynamic_bytes?: number;
  minimum_required_bytes?: number;
  deficit_bytes?: number;
  [key: string]: unknown;
}

export interface StatusMemoryPlan {
  valid?: boolean;
  maximum_context_tokens?: number;
  device?: StatusDevice;
  model?: StatusPlanModel;
  budget?: StatusBudget;
  [key: string]: unknown;
}

export interface StatusMemoryActual {
  /** Metal allocations (not RSS). */
  allocated_bytes: number;
  current_bytes: number;
  /** Lifetime peak. */
  peak_bytes: number;
}

export interface StatusMemoryGovernor {
  limit_bytes: number;
  charged_bytes: number;
  headroom_bytes: number;
  growth_allowed?: boolean;
  /** Counter. */
  denied_reservations?: number;
  system_pressure?: MemoryPressure;
  host_measurement_valid?: boolean;
  host_available_bytes?: number;
  host_reserve_bytes?: number;
  host_headroom_bytes?: number;
}

export interface StatusKv {
  /** 32. */
  block_tokens: number;
  pages_allocated: number;
  /** Held by running requests. */
  pages_active: number;
  /** Held by the prefix cache. */
  pages_cache: number;
  /** Free pages of allocated extents, not remaining capacity. */
  pages_free: number;
  allocated_bytes: number;
  reclaimable_bytes?: number;
  extent_allocations?: number;
  extent_releases?: number;
  extent_compactions?: number;
  pages_moved?: number;
  [key: string]: unknown;
}

/** Recurrent (GDN) state cache. */
export interface StatusState {
  entries: number;
  pinned?: number;
  in_use?: number;
  bytes: number;
  allocated_bytes?: number;
  active_lanes?: number;
  checkpoint_entries?: number;
  checkpoint_bytes?: number;
  disk_bytes?: number;
  [key: string]: unknown;
}

export interface StatusDisk {
  /** `--max-cache-disk`; 0 = off. */
  capacity_bytes: number;
  persistent?: boolean;
  used_bytes: number;
  file_bytes?: number;
  read_bytes?: number;
  written_bytes?: number;
  kv_blocks?: number;
  kv_bytes?: number;
  kv_pending_pages?: number;
  kv_demotions?: number;
  kv_restores?: number;
  taken_back?: { states: number; kv_blocks: number; bytes: number; left_behind: number };
  write_behind?: { waiting: number; durable: number; unneeded: number; refused: number };
  [key: string]: unknown;
}

/** Prefix-cache activity (counters unless noted). */
export interface StatusCache {
  hits: number;
  cold_misses: number;
  /** Lifetime ratio hits / (hits + cold_misses). Not live. */
  hit_rate: number;
  kv_hit_tokens: number;
  kv_disk_hit_tokens?: number;
  reused_tokens?: number;
  lost_state_misses?: number;
  resource_suspensions?: number;
  priority_suspensions?: number;
  resource_resumptions?: number;
  resource_replay_tokens?: number;
  [key: string]: unknown;
}

export interface StatusTimingPair {
  last_gpu_ms: number;
  last_wall_ms: number;
  /** Includes warmup. */
  total_gpu_ms: number;
  total_wall_ms: number;
}

export interface StatusModelTiming {
  scope?: string;
  prefill?: StatusTimingPair;
  decode?: StatusTimingPair;
}

export interface StatusImages {
  encodes: number;
  embedding_reuses: number;
  arena_bytes: number;
  cached_bytes: number;
  state_held_bytes?: number;
  rows_bytes?: number;
}

export interface StatusScheduler {
  queued: number;
  waiting_resources: number;
  waiting_prefix: number;
  prefilling: number;
  decoding: number;
  waiting_mask: number;
  terminal: number;
  /** Counters. */
  prefill_batches: number;
  prefill_rows: number;
  decode_batches: number;
  /** Counters per batch width (`b1`..`b4`). */
  decode_batches_by_width?: Record<string, number>;
}

/** Native requests since engine start (reset on engine restart). */
export interface StatusRequests {
  submitted: number;
  completed: number;
  cancelled: number;
  failed: number;
}

export interface StatusPercentiles {
  p50: number;
  p95: number;
  samples: number;
}

/** `metrics.current_prefill_batch` / `current_decode_batch`: the last completed batch. */
export interface StatusBatch {
  valid: boolean;
  width: number;
  input_tokens: number;
  output_tokens: number;
  drafted_tokens: number;
  accepted_draft_tokens: number;
  wall_ms: number;
  tokens_per_second: number;
}

export interface StatusMetrics {
  /** Lifetime percentiles over the last 4096 samples. */
  ttft_ms?: StatusPercentiles;
  itl_ms?: StatusPercentiles;
  /** Counters (exclude warmup). */
  prefill_input_tokens: number;
  prefill_wall_ms: number;
  decode_output_tokens: number;
  /** GPU command time. */
  decode_wall_ms: number;
  /** 1.2+: GPU plus host time between commands. */
  decode_cycle_ms?: number;
  drafted_tokens: number;
  accepted_draft_tokens: number;
  capacity_failures?: number;
  metal_failures?: number;
  /** Lifetime ratios; never show as "current". */
  prefill_tokens_per_second?: number;
  decode_tokens_per_second?: number;
  draft_acceptance_rate?: number;
  current_prefill_batch?: StatusBatch;
  current_decode_batch?: StatusBatch;
}

export interface StatusWarmup {
  prefill_2048?: boolean;
  decode_b1?: boolean;
  decode_b2?: boolean;
  decode_b3?: boolean;
  decode_b4?: boolean;
  composite_state_restore?: boolean;
  memory_limited_steps?: unknown[];
  detail?: string;
  [key: string]: unknown;
}

export interface StatusMetal {
  healthy: boolean;
  failure_reason: string;
}

/** Python-side engine supervision. */
export interface StatusTransport {
  ready: boolean;
  recovering: boolean;
  stopped: boolean;
  pending: number;
  /** = `--queue-size`. */
  pending_limit: number;
  /** Engine relaunches in this server process. */
  restarts: number;
  last_crash_trace: string | null;
  status_stale: boolean;
  status_age_ms: number;
  /** Last failure, present while recovering or stopped. */
  error?: string | null;
}

export interface StatusFrontend {
  preparation_capacity: number;
  active: number;
  waiting: number;
}

export interface StatusCacheStore {
  entries: number;
  bytes?: number;
  budget_bytes?: number;
  capacity?: number;
  hits?: number;
  misses?: number;
  evictions?: number;
  [key: string]: unknown;
}

/** A cumulative histogram in seconds (`buckets` keys "0.001".."1800", "+Inf"). */
export interface StatusHistogram {
  buckets: Record<string, number>;
  count: number;
  sum: number;
}

export type LatencyStage = OpenString<
  | 'http_request'
  | 'upload'
  | 'preparation_queue'
  | 'preparation'
  | 'template'
  | 'tokenization'
  | 'grammar'
  | 'images'
  | 'native_queue'
  /** 1.2; `ttft` before. */
  | 'http_ttft'
  | 'ttft'
  | 'output_interval'
>;

export interface StatusInstance {
  /** Random per server process; changes on server restart. */
  id: string;
  pid: number;
  /** Always the loaded model id. */
  model: string;
  host: string;
  port: number;
  /** Unix seconds (bind time). */
  started_at: number;
}

export interface StatusActiveCapacity {
  active: number;
  capacity: number;
}

export interface StatusHttp {
  requests: StatusActiveCapacity;
  request_body_bytes?: StatusActiveCapacity;
  max_request_bytes?: number;
  token_counts?: StatusActiveCapacity;
  /** `active` includes your own poll. */
  connections?: StatusActiveCapacity;
}

/** GET /status: the engine telemetry snapshot. */
export interface StatusResponse {
  /** 6 in 1.2.0, 5 in 1.0 to 1.1. */
  schema_version: number;
  ready: boolean;
  maximum_context_tokens?: number;
  memory_pressure?: MemoryPressure;
  admission?: StatusAdmission;
  loop?: { max_tick_ms: number };
  identity?: { cache?: Record<string, unknown>; kv?: Record<string, unknown> };
  memory_plan?: StatusMemoryPlan;
  memory_actual?: StatusMemoryActual;
  memory_governor?: StatusMemoryGovernor;
  memory_audit?: Record<string, unknown>;
  kv?: StatusKv;
  state?: StatusState;
  disk?: StatusDisk;
  cache?: StatusCache;
  draft_context?: Record<string, number>;
  model_timing?: StatusModelTiming;
  constraint_masks?: Record<string, number>;
  images?: StatusImages;
  scheduler?: StatusScheduler;
  requests?: StatusRequests;
  metrics?: StatusMetrics;
  warmup?: StatusWarmup;
  metal?: StatusMetal;
  transport?: StatusTransport;
  vision?: boolean;
  input_modalities?: InputModality[];
  chat_template?: { later_system: OpenString<'native' | 'patched' | 'unsupported'> };
  frontend?: StatusFrontend;
  grammar_cache?: StatusCacheStore;
  response_store?: StatusCacheStore;
  image_cache?: StatusCacheStore;
  tokenizer_cache?: StatusCacheStore;
  latency?: Partial<Record<LatencyStage, StatusHistogram>>;
  instance?: StatusInstance;
  http?: StatusHttp;
  [section: string]: unknown;
}

// ---------------------------------------------------------------------------
// Chat completion request
// ---------------------------------------------------------------------------

export type ChatRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

/** Every value Splash accepts (400 `invalid reasoning_effort` otherwise). */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface TextPart {
  type: 'text' | 'input_text';
  text: string;
}

/** Images must be base64 `data:` URLs; https URLs give 400. */
export interface ImageUrlPart {
  type: 'image_url';
  image_url: { url: string; detail?: string } | string;
}

/** Inline PDF (base64). Needs vision. */
export interface FilePart {
  type: 'file';
  file: { file_data?: string; filename?: string; [key: string]: unknown };
}

export type UserContentPart = TextPart | ImageUrlPart | FilePart;

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON text. */
    arguments: string;
  };
}

export interface SystemMessage {
  role: 'system' | 'developer';
  content: string | TextPart[];
}

export interface UserMessage {
  role: 'user';
  content: string | UserContentPart[];
}

export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
}

export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string | (TextPart | ImageUrlPart)[];
}

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export interface ToolDefinition {
  type: 'function';
  function: {
    /** `[A-Za-z0-9_-]{1,128}`, unique. */
    name: string;
    description?: string;
    /** JSON Schema; no remote `$ref`. */
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export type ToolChoice =
  'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };

export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      json_schema: { name?: string; schema: Record<string, unknown>; strict?: boolean };
    };

export type RequestPriority = 'foreground' | 'normal' | 'background';

/**
 * POST /v1/chat/completions body: every field of docs/splash-params.json
 * `request[]`. `null` for a sampling field means "server default".
 */
export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  /** Always send one (1.2 default is the rest of the context). */
  max_tokens?: number | null;
  max_completion_tokens?: number | null;
  /** [0, 2]; default 1.0. */
  temperature?: number | null;
  /** (0, 1]; default 0.95. */
  top_p?: number | null;
  /** Integer >= -1; 0/-1 disable (1.2+); default 20. */
  top_k?: number | null;
  /** [0, 1]; 1.2+. */
  min_p?: number | null;
  /** [-2, 2]; 1.2+. */
  presence_penalty?: number | null;
  /** [-2, 2]; 1.2+. */
  frequency_penalty?: number | null;
  /** > 0; 1.2+. */
  repetition_penalty?: number | null;
  /** Unsigned 64-bit integer. */
  seed?: number | null;
  /** 1 to 4 non-empty strings; not with tools or response_format. */
  stop?: string | string[] | null;
  /** 1.2+; not with tools or response_format. */
  ignore_eos?: boolean;
  reasoning_effort?: ReasoningEffort | null;
  /** 1.2+; outranks reasoning_effort. Reserved keys give 400. */
  chat_template_kwargs?: { enable_thinking?: boolean; [key: string]: unknown };
  preserve_thinking?: boolean | null;
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
  parallel_tool_calls?: boolean | null;
  response_format?: ResponseFormat;
  /** Stream only: emit `prompt_progress` chunks during prefill. */
  return_progress?: boolean;
  /** 1.0.2+. */
  priority?: RequestPriority;
  /** Seconds > 0; can only shorten the server's timeout. */
  timeout?: number | null;
  /** Must be 1 or null. */
  n?: 1 | null;
  /** Must be false or null. */
  logprobs?: false | null;
  /** Must be null or {}. */
  logit_bias?: Record<string, never> | null;
}

// ---------------------------------------------------------------------------
// Chat completion responses
// ---------------------------------------------------------------------------

export type FinishReason = OpenString<'stop' | 'length' | 'tool_calls'>;

/** llama-server compatible timings (1.1+); intervals exclude the admission queue. */
export interface Timings {
  prompt_n: number;
  /** Native start to first emission. */
  prompt_ms: number;
  /** Uncached tokens only. */
  prompt_per_second: number;
  predicted_n: number;
  predicted_ms: number;
  /** Excludes the first emission; 0 when the whole output came in one emission. */
  predicted_per_second: number;
  cache_n: number;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens: number };
  completion_tokens_details?: { reasoning_tokens: number };
}

/** Engine-measured intervals in ms. */
export interface RequestLatency {
  /** Native start to first emission (prefill time). */
  start_to_first_token_ms: number;
  first_token_to_done_ms: number;
  /** Engine receipt to done. */
  wall_ms: number;
  ttft_ms: number;
  queue_to_start_ms: number;
  /** decode.tokens / first_token_to_done_ms. */
  stream_tokens_per_second: number;
}

/** Splash-specific per-request metrics. */
export interface RequestMetrics {
  /** Uncached prompt tokens computed. */
  prefill?: { tokens: number };
  /** completion_tokens minus the first emission's tokens. */
  decode?: { tokens: number };
  request_latency?: RequestLatency;
  cache?: { status: OpenString<'hit' | 'miss'>; matched_tokens: number; lane: number | null };
}

/** Non-streaming chat completion. */
export interface ChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: {
    index: number;
    message: AssistantMessage & { role: 'assistant' };
    finish_reason: FinishReason;
  }[];
  usage: Usage;
  metrics?: RequestMetrics;
  timings?: Timings;
}

/** `delta.tool_calls[]`: a header delta (id, type, name) then argument fragments. */
export interface ToolCallChunk {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

export interface ChunkDelta {
  role?: 'assistant';
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: ToolCallChunk[];
}

export interface ChunkChoice {
  index: number;
  delta: ChunkDelta;
  finish_reason: FinishReason | null;
}

/** `prompt_progress` during prefill (with `return_progress: true`). */
export interface PromptProgress {
  /** Prompt tokens. */
  total: number;
  /** Cached tokens at the start. */
  cache: number;
  /** Completed tokens, cache included; monotonic. */
  processed: number;
  /** Ms since prefill admission (not an ETA). */
  time_ms: number;
}

/**
 * One `data:` frame of a streaming chat completion. Kinds, in order:
 * start (`delta:{role,content:""}`), `prompt_progress`, empty-delta
 * keepalives, reasoning / content / tool-call deltas, the finish chunk (with
 * `timings`), then the usage chunk (`choices: []`, with `include_usage`).
 */
export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChunkChoice[];
  prompt_progress?: PromptProgress;
  timings?: Timings;
  usage?: Usage | null;
  metrics?: RequestMetrics;
}

/** A mid-stream failure: `data: {"error":{...}}` then `data: [DONE]`. */
export type StreamErrorFrame = SplashErrorBody;

/** Anything a chat stream `data:` frame can hold. */
export type ChatStreamFrame = ChatCompletionChunk | StreamErrorFrame;

// ---------------------------------------------------------------------------
// Other endpoints
// ---------------------------------------------------------------------------

/** POST /v1/completions (1.2+). `max_tokens` defaults to 16. */
export interface TextCompletionRequest {
  model?: string;
  prompt: string | number[];
  max_tokens?: number | null;
  temperature?: number | null;
  top_p?: number | null;
  top_k?: number | null;
  min_p?: number | null;
  presence_penalty?: number | null;
  frequency_penalty?: number | null;
  repetition_penalty?: number | null;
  seed?: number | null;
  stop?: string | string[] | null;
  ignore_eos?: boolean;
  priority?: RequestPriority;
  timeout?: number | null;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
}

export interface TextCompletion {
  id: string;
  object: 'text_completion';
  created: number;
  model: string;
  choices: { index: number; text: string; logprobs: null; finish_reason: FinishReason }[];
  usage: Usage;
  metrics?: RequestMetrics;
  timings?: Timings;
}

/** POST /tokenize */
export interface TokenizeRequest {
  content: string;
  add_special?: boolean;
}

export interface TokenizeResponse {
  tokens: number[];
}

/** POST /apply-template: chat messages, tools and reasoning options. */
export interface ApplyTemplateRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  reasoning_effort?: ReasoningEffort | null;
  chat_template_kwargs?: Record<string, unknown>;
  preserve_thinking?: boolean | null;
}

export interface ApplyTemplateResponse {
  /** The exact rendered prompt. */
  prompt: string;
}
