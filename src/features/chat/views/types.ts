/**
 * View models for the chat views. These are presentational shapes: the page
 * (wiring phase) maps the chat store and the Splash stream onto them.
 */

/** Maps to the request's `reasoning_effort`: none, low, medium, xhigh. */
export type ThinkingEffort = 'none' | 'low' | 'medium' | 'high';

/** An image the user attached (in the composer) or sent (in the thread). */
export interface ChatImage {
  id: string;
  /** File name, e.g. "ttft-chart.png". */
  name: string;
  /** Object URL or data URL. */
  src: string;
  /** Size of the file in bytes, shown on the composer chip. */
  sizeBytes?: number;
  /** What the image shows, for VoiceOver. Defaults to the file name. */
  alt?: string;
}

/** Why a reply ended. `stop` is a normal finish. */
export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'cancelled' | 'error';

/**
 * Per-turn numbers from the finish chunk (splash-api.md §5):
 * `timings.predicted_per_second`, `metrics.request_latency.ttft_ms`,
 * `usage.prompt_tokens`, `usage.prompt_tokens_details.cached_tokens`,
 * `usage.completion_tokens_details.reasoning_tokens`, `usage.completion_tokens`.
 */
export interface TurnStats {
  tokensPerSecond: number;
  timeToFirstTokenSeconds: number;
  promptTokens: number;
  cachedTokens: number;
  /** 0 when thinking was off. */
  thinkingTokens: number;
  /** Everything the model wrote, thinking included (`completion_tokens`). */
  outputTokens: number;
  finishReason: FinishReason;
}

/**
 * thinking: reasoning is streaming and no answer text has arrived yet.
 * streaming: answer text is arriving.
 * done / error / cancelled: the turn is over.
 */
export type AssistantStatus = 'thinking' | 'streaming' | 'done' | 'error' | 'cancelled';

export interface UserTurn {
  id: string;
  role: 'user';
  content: string;
  images?: ChatImage[];
}

export interface AssistantTurn {
  id: string;
  role: 'assistant';
  /** Markdown answer text so far. */
  content: string;
  /** Streamed `reasoning_content`, if the model thought. */
  reasoning?: string;
  /** Seconds spent thinking, once the answer started. */
  thinkingSeconds?: number;
  status: AssistantStatus;
  /** Plain-English reason when `status` is "error". */
  error?: string;
  stats?: TurnStats;
}

export type ChatTurn = UserTurn | AssistantTurn;

/** The engine words used everywhere: Ready, Thinking, Starting…, Stopped. */
export type ComposerEngineState = 'ready' | 'busy' | 'starting' | 'stopped';

export interface ComposerEngine {
  state: ComposerEngineState;
  /** Display name of the model that will answer, e.g. "Qwen3.8-27B". */
  modelName: string;
  /** Starting… only: the Splash start phase, e.g. "Loading weights". */
  phase?: string;
  /** Starting… only: seconds since the server was spawned. */
  elapsedSeconds?: number;
  /** Starting… only: 0..1. */
  progress?: number;
}

/** One installed model in the title pop-up. */
export interface PickerModel {
  id: string;
  /** Unique title: "Qwen3.8-27B" or "Qwen3.8-27B (MLX 4-bit)". */
  name: string;
  /** Gray line that tells versions apart: "Splash package · Ready", "mlx-community · 15.6 GB". */
  detail: string;
}

/** A conversation row in the sidebar. */
export interface HistoryItem {
  id: string;
  title: string;
}

export interface HistoryGroup {
  /** "Today", "Yesterday", "Previous 7 days", "Older". */
  label: string;
  items: HistoryItem[];
}

/** One searchable conversation for Search chats. */
export interface SearchableChat {
  id: string;
  title: string;
  /** Group label, as in the sidebar. */
  group: string;
  /** Plain text of the conversation's messages, searched for a snippet. */
  text?: string;
}

export type SuggestionIcon = 'code' | 'image' | 'book' | 'terminal' | 'file' | 'sparkles';

export interface Suggestion {
  id: string;
  label: string;
  icon?: SuggestionIcon;
  /** Text put in the composer when chosen. Defaults to the label. */
  prompt?: string;
}
