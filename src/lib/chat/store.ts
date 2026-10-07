/**
 * The chat: conversations, sending, streaming, stop, regenerate, persistence.
 *
 * Conversations are saved one per key in getStorage().conversations. A reply
 * streams through SplashClient.chatTurn() and is folded into the assistant
 * message with reduceTurn(), at most once per animation frame.
 */
import { create } from 'zustand';
import { newId } from '@/lib/env';
import { initialTurnState, reduceTurn, type TurnState } from '@/lib/splash/chat-stream';
import { getSplashClient } from '@/lib/splash/client';
import { buildChatRequest, type ChatSettings, type ThinkingLevel } from '@/lib/splash/request';
import type { ChatMessage, UserContentPart } from '@/lib/splash/types';
import { getStorage } from '@/lib/storage';
import {
  CONVERSATION_SCHEMA_VERSION,
  DEFAULT_TITLE,
  type ChatError,
  type Conversation,
  type ConversationMessage,
  type ImageMime,
  type ImagePart,
  type MessagePart,
} from './types';

export type { Conversation, ConversationMessage } from './types';

const DEFAULTS_KEY = 'chat.defaults';
const ACCEPTED_IMAGES: readonly ImageMime[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

export interface PendingImage {
  id: string;
  name: string;
  mime: ImageMime;
  url: string;
  bytes: number;
}

interface StoredConversation extends Conversation {
  schemaVersion: number;
}

export interface ChatState {
  loaded: boolean;
  conversations: Conversation[];
  /** null = a new, unsaved chat. */
  activeId: string | null;
  draft: string;
  attachments: PendingImage[];
  /** Default settings for new turns (Settings > Chat). */
  defaults: ChatSettings;
  /** Conversation ids with a reply streaming. */
  streaming: Record<string, true>;

  load: () => Promise<void>;
  setDraft: (draft: string) => void;
  setThinking: (level: ThinkingLevel) => void;
  setDefaults: (patch: Partial<ChatSettings>) => void;
  /** Starts a fresh chat (nothing is saved until the first message). */
  newChat: () => void;
  /** Creates an empty conversation, makes it active and returns its id. */
  newConversation: (title?: string) => string;
  selectConversation: (id: string | null) => void;
  addImages: (files: File[]) => Promise<string[]>;
  removeAttachment: (id: string) => void;
  /** Sends the draft (and attachments) in the active chat. */
  send: () => Promise<void>;
  stop: (conversationId?: string) => void;
  /** Writes the assistant reply `messageId` again. */
  regenerate: (messageId: string) => Promise<void>;
  rename: (id: string, title: string) => void;
  remove: (id: string) => void;
}

const controllers = new Map<string, AbortController>();

function now(): number {
  return Date.now();
}

function textOf(parts: MessagePart[]): string {
  return parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function provisionalTitle(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  const words = line.split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
  if (!words) return DEFAULT_TITLE;
  return words.length > 60 ? `${words.slice(0, 57)}…` : words;
}

/** The conversation as Splash messages (finished turns only). */
function toRequestMessages(messages: ConversationMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const images = message.content.filter((part): part is ImagePart => part.type === 'image');
      const text = textOf(message.content);
      if (images.length === 0) {
        out.push({ role: 'user', content: text });
      } else {
        const parts: UserContentPart[] = images.map((image) => ({
          type: 'image_url',
          image_url: { url: image.url },
        }));
        if (text) parts.push({ type: 'text', text });
        out.push({ role: 'user', content: parts });
      }
    } else if (message.status === 'done' || message.status === 'cancelled') {
      const text = textOf(message.content);
      if (text) out.push({ role: 'assistant', content: text });
    }
  }
  return out;
}

function describeError(state: TurnState): ChatError {
  const info = state.error;
  const kind = info?.kind ?? 'unknown';
  const status = info?.status;
  if (kind === 'unreachable' || kind === 'timeout') {
    return {
      kind: 'engine-stopped',
      title: "Splash isn't running",
      message: 'Start the model, then try again.',
      action: 'start-engine',
      retryable: true,
    };
  }
  if (kind === 'forbidden-origin' || kind === 'forbidden-host') {
    return {
      kind: 'forbidden-origin',
      title: 'Splash refused the connection',
      message: 'The server rejected this app. Restart it from Splashboard.',
      detail: info?.message,
      action: 'restart-engine',
      retryable: true,
      status,
    };
  }
  if (kind === 'unauthorized') {
    return {
      kind: 'unauthorized',
      title: 'API key needed',
      message: 'This server needs an API key. Add it in Settings.',
      action: 'open-settings',
      retryable: false,
      status,
    };
  }
  if (kind === 'context-length') {
    return {
      kind: 'context-length',
      title: 'This chat is too long',
      message: 'Start a new chat, or raise the context length in Launch settings.',
      action: 'new-chat',
      retryable: false,
      status,
    };
  }
  if (kind === 'overloaded' || kind === 'unavailable' || kind === 'recovering') {
    return {
      kind: 'overloaded',
      title: 'Splash is busy',
      message: 'Too many requests at once. Try again in a moment.',
      action: 'retry',
      retryable: true,
      status,
    };
  }
  return {
    kind: 'unknown',
    title: 'Something went wrong',
    message: info?.message ?? 'The reply stopped unexpectedly.',
    code: info?.code ?? undefined,
    action: 'retry',
    retryable: info?.retryable ?? true,
    status,
  };
}

/** The assistant message as of `turn`. */
function applyTurn(message: ConversationMessage, turn: TurnState): ConversationMessage {
  const status: ConversationMessage['status'] =
    turn.phase === 'done'
      ? 'done'
      : turn.phase === 'cancelled'
        ? 'cancelled'
        : turn.phase === 'error'
          ? 'error'
          : turn.reasoning || turn.content
            ? 'streaming'
            : 'pending';
  return {
    ...message,
    content: [{ type: 'text', text: turn.content }],
    reasoning: turn.reasoning || undefined,
    toolCalls: turn.toolCalls.length ? turn.toolCalls : undefined,
    status,
    model: turn.model ?? message.model,
    stats: turn.stats,
    error: turn.phase === 'error' ? describeError(turn) : undefined,
    live:
      status === 'pending' || status === 'streaming'
        ? {
            phase: turn.phase,
            sentAt: null,
            prefill: turn.prefill,
            waking: false,
            attempt: 1,
            retryAt: null,
            keepalives: turn.keepalives,
            lastActivityAt: null,
          }
        : undefined,
  };
}

async function persist(conversation: Conversation): Promise<void> {
  const record: StoredConversation = {
    ...conversation,
    schemaVersion: CONVERSATION_SCHEMA_VERSION,
    messages: conversation.messages.map(({ live: _live, ...message }) => message),
  };
  try {
    await getStorage().conversations.set(conversation.id, record);
  } catch {
    // Saving failed (storage unavailable): the chat still works for this session.
  }
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

export const useChatStore = create<ChatState>()((set, get) => {
  function patchConversation(id: string, update: (c: Conversation) => Conversation) {
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? update(c) : c)),
    }));
  }

  function patchMessage(
    conversationId: string,
    messageId: string,
    update: (m: ConversationMessage) => ConversationMessage,
  ) {
    patchConversation(conversationId, (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === messageId ? update(m) : m)),
    }));
  }

  /** Streams a reply into `assistantId`, using the messages before it. */
  async function stream(conversationId: string, assistantId: string): Promise<void> {
    const conversation = get().conversations.find((c) => c.id === conversationId);
    if (!conversation) return;
    const index = conversation.messages.findIndex((m) => m.id === assistantId);
    const history = toRequestMessages(conversation.messages.slice(0, index));
    const settings: ChatSettings = { ...get().defaults, ...conversation.settings };
    const { request, notes } = buildChatRequest(history, settings, conversation.model);

    controllers.get(conversationId)?.abort();
    const controller = new AbortController();
    controllers.set(conversationId, controller);
    set((s) => ({ streaming: { ...s.streaming, [conversationId]: true } }));

    let turn = initialTurnState();
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      const snapshot = turn;
      patchMessage(conversationId, assistantId, (m) => ({ ...applyTurn(m, snapshot), notes }));
    };
    const schedule = () => {
      if (frame !== null) return;
      frame =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(flush)
          : (setTimeout(flush, 16) as unknown as number);
    };

    try {
      for await (const event of getSplashClient().chatTurn(request, {
        signal: controller.signal,
      })) {
        turn = reduceTurn(turn, event);
        schedule();
      }
    } catch (error) {
      turn = reduceTurn(turn, {
        type: 'error',
        t: now(),
        kind: 'unknown',
        code: 'client',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
    } finally {
      if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      if (turn.phase !== 'done' && turn.phase !== 'error' && turn.phase !== 'cancelled') {
        turn = { ...turn, phase: controller.signal.aborted ? 'cancelled' : 'done' };
      }
      flush();
      if (controllers.get(conversationId) === controller) controllers.delete(conversationId);
      set((s) => {
        const next = { ...s.streaming };
        delete next[conversationId];
        return { streaming: next };
      });
      patchConversation(conversationId, (c) => ({ ...c, updatedAt: now() }));
      const saved = get().conversations.find((c) => c.id === conversationId);
      if (saved) void persist(saved);
    }
  }

  return {
    loaded: false,
    conversations: [],
    activeId: null,
    draft: '',
    attachments: [],
    defaults: { thinking: 'high' },
    streaming: {},

    load: async () => {
      if (get().loaded) return;
      const storage = getStorage();
      try {
        const [keys, defaults] = await Promise.all([
          storage.conversations.keys(),
          storage.settings.get<ChatSettings>(DEFAULTS_KEY),
        ]);
        const records = await Promise.all(
          keys.map((key) => storage.conversations.get<StoredConversation>(key)),
        );
        const conversations = records
          .filter(
            (record): record is StoredConversation => !!record && Array.isArray(record.messages),
          )
          .map(({ schemaVersion: _version, ...conversation }) => ({
            ...conversation,
            settings: conversation.settings ?? {},
            // A reply that was streaming when the app quit is over now.
            messages: conversation.messages.map((m) =>
              m.status === 'pending' || m.status === 'streaming'
                ? { ...m, status: 'cancelled' as const }
                : m,
            ),
          }))
          .sort((a, b) => b.updatedAt - a.updatedAt);
        set((s) => ({
          loaded: true,
          conversations: [
            ...s.conversations.filter((c) => !conversations.some((saved) => saved.id === c.id)),
            ...conversations,
          ],
          defaults: { ...s.defaults, ...(defaults ?? {}) },
        }));
      } catch {
        set({ loaded: true });
      }
    },

    setDraft: (draft) => set({ draft }),

    setThinking: (thinking) => get().setDefaults({ thinking }),

    setDefaults: (patch) => {
      const defaults = { ...get().defaults, ...patch };
      set({ defaults });
      void getStorage()
        .settings.set(DEFAULTS_KEY, defaults)
        .catch(() => undefined);
    },

    newChat: () => set({ activeId: null, draft: '', attachments: [] }),

    newConversation: (title = DEFAULT_TITLE) => {
      const created = now();
      const conversation: Conversation = {
        id: newId(),
        title,
        titleSource: title === DEFAULT_TITLE ? 'default' : 'user',
        createdAt: created,
        updatedAt: created,
        settings: {},
        messages: [],
      };
      set((s) => ({
        conversations: [conversation, ...s.conversations],
        activeId: conversation.id,
      }));
      return conversation.id;
    },

    selectConversation: (activeId) => set({ activeId, attachments: [] }),

    addImages: async (files) => {
      const rejected: string[] = [];
      const added: PendingImage[] = [];
      for (const file of files) {
        const mime = file.type as ImageMime;
        if (!ACCEPTED_IMAGES.includes(mime) || file.size > MAX_IMAGE_BYTES) {
          rejected.push(file.name);
          continue;
        }
        try {
          added.push({
            id: newId(),
            name: file.name,
            mime,
            url: await readFile(file),
            bytes: file.size,
          });
        } catch {
          rejected.push(file.name);
        }
      }
      if (added.length) set((s) => ({ attachments: [...s.attachments, ...added] }));
      return rejected;
    },

    removeAttachment: (id) =>
      set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),

    send: async () => {
      const { draft, attachments } = get();
      const text = draft.trim();
      if (!text && attachments.length === 0) return;
      let conversationId = get().activeId;
      if (conversationId && get().streaming[conversationId]) return;
      if (!conversationId || !get().conversations.some((c) => c.id === conversationId)) {
        conversationId = get().newConversation();
      }
      const sentAt = now();
      const parts: MessagePart[] = attachments.map((image) => ({
        type: 'image',
        url: image.url,
        mime: image.mime,
        name: image.name,
        bytes: image.bytes,
      }));
      if (text) parts.push({ type: 'text', text });
      const user: ConversationMessage = {
        id: newId(),
        role: 'user',
        content: parts,
        status: 'done',
        createdAt: sentAt,
      };
      const assistant: ConversationMessage = {
        id: newId(),
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        status: 'pending',
        createdAt: sentAt,
      };
      patchConversation(conversationId, (c) => ({
        ...c,
        title: c.titleSource === 'default' ? provisionalTitle(text || 'Image') : c.title,
        titleSource: c.titleSource === 'default' ? 'provisional' : c.titleSource,
        updatedAt: sentAt,
        messages: [...c.messages, user, assistant],
      }));
      set({ draft: '', attachments: [] });
      await stream(conversationId, assistant.id);
    },

    stop: (conversationId) => {
      const id = conversationId ?? get().activeId;
      if (id) controllers.get(id)?.abort();
    },

    regenerate: async (messageId) => {
      const conversation = get().conversations.find((c) =>
        c.messages.some((m) => m.id === messageId),
      );
      if (!conversation || get().streaming[conversation.id]) return;
      const index = conversation.messages.findIndex((m) => m.id === messageId);
      const fresh: ConversationMessage = {
        id: newId(),
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        status: 'pending',
        createdAt: now(),
      };
      patchConversation(conversation.id, (c) => ({
        ...c,
        messages: [...c.messages.slice(0, index), fresh],
      }));
      await stream(conversation.id, fresh.id);
    },

    rename: (id, title) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      patchConversation(id, (c) => ({ ...c, title: trimmed, titleSource: 'user' }));
      const saved = get().conversations.find((c) => c.id === id);
      if (saved) void persist(saved);
    },

    remove: (id) => {
      controllers.get(id)?.abort();
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== id),
        activeId: s.activeId === id ? null : s.activeId,
      }));
      void getStorage()
        .conversations.delete(id)
        .catch(() => undefined);
    },
  };
});

/** Today / Yesterday / Previous 7 days / Older, newest first. */
export function groupConversations(
  conversations: Conversation[],
  at: number = now(),
): { label: string; items: Conversation[] }[] {
  const startOfToday = new Date(at);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const day = 24 * 60 * 60 * 1000;
  const groups = [
    { label: 'Today', from: today },
    { label: 'Yesterday', from: today - day },
    { label: 'Previous 7 days', from: today - 7 * day },
    { label: 'Older', from: -Infinity },
  ];
  const result = groups.map((group) => ({ label: group.label, items: [] as Conversation[] }));
  for (const conversation of [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (conversation.messages.length === 0) continue;
    const slot = groups.findIndex((group) => conversation.updatedAt >= group.from);
    result[slot === -1 ? groups.length - 1 : slot]?.items.push(conversation);
  }
  return result.filter((group) => group.items.length > 0);
}

export function conversationText(conversation: Conversation): string {
  return conversation.messages.map((m) => textOf(m.content)).join('\n');
}
