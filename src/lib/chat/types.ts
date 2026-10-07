/**
 * The chat's data model: conversations, messages and their parts. Plain
 * JSON-serialisable data (persisted by ./persistence.ts), except `live`,
 * which only exists while a reply streams and is never saved.
 */
import type { TurnPhase, TurnStats, TurnToolCall } from '@/lib/splash/chat-stream';
import type { ChatSettings, RequestNote } from '@/lib/splash/request';

/** Bumped when the persisted shape changes; see `migrateRecord` in ./persistence.ts. */
export const CONVERSATION_SCHEMA_VERSION = 1;

/** Title of a conversation nobody named yet. */
export const DEFAULT_TITLE = 'New chat';

/** The image types Splash accepts (docs/splash-api.md 5.1). */
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image';
  /** Base64 `data:` URL, sent as-is as `image_url.url`. */
  url: string;
  mime: ImageMime;
  /** File name, for the chip and VoiceOver. */
  name?: string;
  width?: number;
  height?: number;
  /** Decoded size of the image data. */
  bytes?: number;
}

export type MessagePart = TextPart | ImagePart;

export type MessageRole = 'user' | 'assistant';

/**
 * - `pending`: sent; nothing generated yet (connecting, queued, waking the
 *   model, prefilling, or waiting to retry after a 503).
 * - `streaming`: reasoning or answer tokens are arriving.
 * - `done`, `cancelled` (Stop), `error`: the turn is over. A reply that was
 *   streaming when the app quit is loaded back as an `interrupted` error.
 */
export type MessageStatus = 'pending' | 'streaming' | 'done' | 'cancelled' | 'error';

/** What a failed turn tells the user. Built by `describeChatError` (./errors.ts). */
export type ChatErrorKind =
  | 'unreachable'
  | 'engine-stopped'
  | 'engine-starting'
  | 'not-installed'
  | 'timeout'
  | 'forbidden-origin'
  | 'forbidden-host'
  | 'unauthorized'
  | 'context-length'
  | 'model-not-found'
  | 'not-found'
  | 'bad-request'
  | 'capacity'
  | 'overloaded'
  | 'recovering'
  | 'unavailable'
  | 'engine-failed'
  | 'request-timeout'
  | 'server'
  | 'stream'
  | 'incomplete'
  | 'interrupted'
  | 'invalid-response'
  | 'unknown';

/** The one thing the user can do about an error (the UI picks the button). */
export type ChatErrorAction =
  | 'retry'
  | 'start-engine'
  | 'restart-engine'
  | 'install-splash'
  | 'open-settings'
  | 'choose-model'
  | 'new-chat'
  | 'wait';

export interface ChatError {
  kind: ChatErrorKind;
  /** Short headline: "Splash isn't running". */
  title: string;
  /** One or two plain sentences: what happened and what to do. */
  message: string;
  /** Splash's own message, when it said more than the headline (shown smaller). */
  detail?: string;
  action?: ChatErrorAction;
  /** Sending the same turn again can work (Retry / Regenerate). */
  retryable: boolean;
  /** Splash `error.code` or the transport kind. */
  code?: string;
  /** HTTP status, when Splash answered. */
  status?: number;
}

/** In-flight details of a reply. Not persisted. */
export interface LiveTurn {
  phase: TurnPhase;
  /** When the current attempt was sent (`now()` clock). */
  sentAt: number | null;
  /** Prompt prefill progress (`prompt_progress`), or null. */
  prefill: { done: number; total: number; cached: number; elapsedMs: number } | null;
  /** The weights look released after idle: the wait is the model waking up. */
  waking: boolean;
  /** 1 for the first try; higher after a 503 retry. */
  attempt: number;
  /** When the next retry is sent (after a 503 with Retry-After), or null. */
  retryAt: number | null;
  keepalives: number;
  /** Last stream event of any kind, keepalives included (stall detection). */
  lastActivityAt: number | null;
}

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  /** User: text and images, in order. Assistant: one text part (the answer). */
  content: MessagePart[];
  /** Streamed `reasoning_content` (assistant). */
  reasoning?: string;
  /** Tool calls the model made (assistant; only when tools were set). */
  toolCalls?: TurnToolCall[];
  status: MessageStatus;
  createdAt: number;
  /** Set when a user message was edited. */
  editedAt?: number;
  /** The model that answered (start chunk), assistant only. */
  model?: string;
  /** Per-turn numbers: live approximations while streaming, then the engine's. */
  stats?: TurnStats;
  error?: ChatError;
  /** Adjustments `buildChatRequest` made to the request (dropped fields, ...). */
  notes?: RequestNote[];
  /** Ms the engine took to reload idle-released weights before this reply. */
  wakeMs?: number;
  live?: LiveTurn;
}

/**
 * - `default`: "New chat". `provisional`: the first line of the first
 *   message. `auto`: the model's title. `user`: renamed; never overwritten.
 */
export type TitleSource = 'default' | 'provisional' | 'auto' | 'user';

export interface Conversation {
  id: string;
  title: string;
  titleSource: TitleSource;
  createdAt: number;
  /** Last send or finished reply; drives the history order and groups. */
  updatedAt: number;
  /** A `/v1/models` id sent as `model`; undefined = whatever Splash has loaded. */
  model?: string;
  /** Overrides of the default chat settings; only keys set here apply. */
  settings: ChatSettings;
  messages: ConversationMessage[];
}

/** An image ready to send (`prepareImage` in ./images.ts). */
export interface PreparedImage {
  id: string;
  name: string;
  mime: ImageMime;
  /** Base64 `data:` URL. */
  url: string;
  width: number;
  height: number;
  /** Decoded bytes of `url`. */
  bytes: number;
  originalWidth: number;
  originalHeight: number;
  originalBytes: number;
  /** True when it was scaled down to the server's pixel limit. */
  resized: boolean;
}
