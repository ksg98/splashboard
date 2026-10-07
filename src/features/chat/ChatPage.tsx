import { useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from '@/components/ui/Toast';
import {
  displayModelName,
  engineWord,
  launchPhaseWord,
  startEngine,
  useLaunchStore,
} from '@/lib/launch';
import { engine } from '@/lib/splash/engine';
import { useEngineStore } from '@/lib/splash/engine-store';
import type { ThinkingLevel } from '@/lib/splash/request';
import { useNow } from '@/lib/useNow';
import type { ConversationMessage, ImagePart } from '@/lib/chat/types';
import { useChatStore } from './store';
import { ChatThread } from './views/ChatThread';
import { Composer } from './views/Composer';
import { NewChatEmptyState } from './views/NewChatEmptyState';
import type {
  AssistantTurn,
  ChatTurn,
  ComposerEngine,
  FinishReason,
  Suggestion,
  ThinkingEffort,
  TurnStats as ViewTurnStats,
} from './views/types';
import './ChatPage.css';

const SUGGESTIONS: Suggestion[] = [
  { id: 'trace', label: 'Explain a stack trace', icon: 'code', prompt: 'Explain this stack trace:\n\n' },
  { id: 'script', label: 'Write a shell script', icon: 'terminal', prompt: 'Write a shell script that ' },
  { id: 'summary', label: 'Summarize a document', icon: 'file', prompt: 'Summarize this:\n\n' },
  { id: 'diff', label: 'Review a diff', icon: 'book', prompt: 'Review this diff:\n\n' },
];

const LEVEL_TO_EFFORT: Record<ThinkingLevel, ThinkingEffort> = {
  off: 'none',
  on: 'high',
  low: 'low',
  medium: 'medium',
  high: 'high',
};
const EFFORT_TO_LEVEL: Record<ThinkingEffort, ThinkingLevel> = {
  none: 'off',
  low: 'low',
  medium: 'medium',
  high: 'high',
};

function textOf(message: ConversationMessage): string {
  return message.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function viewStats(message: ConversationMessage): ViewTurnStats | undefined {
  const stats = message.stats;
  if (!stats || message.status === 'pending' || message.status === 'streaming') return undefined;
  const finish: FinishReason =
    message.status === 'cancelled'
      ? 'cancelled'
      : message.status === 'error'
        ? 'error'
        : stats.finishReason === 'length'
          ? 'length'
          : stats.finishReason === 'tool_calls'
            ? 'tool_calls'
            : 'stop';
  return {
    tokensPerSecond: stats.decodeTokPerSec ?? 0,
    timeToFirstTokenSeconds: (stats.ttftMs ?? 0) / 1000,
    promptTokens: stats.promptTokens ?? 0,
    cachedTokens: stats.cachedTokens ?? 0,
    thinkingTokens: stats.reasoningTokens ?? 0,
    outputTokens: stats.completionTokens ?? 0,
    finishReason: finish,
  };
}

function toTurn(message: ConversationMessage): ChatTurn {
  if (message.role === 'user') {
    const images = message.content
      .filter((part): part is ImagePart => part.type === 'image')
      .map((image, index) => ({
        id: `${message.id}-${index}`,
        name: image.name ?? 'Image',
        src: image.url,
        sizeBytes: image.bytes,
      }));
    return { id: message.id, role: 'user', content: textOf(message), images };
  }
  const content = textOf(message);
  const status: AssistantTurn['status'] =
    message.status === 'pending'
      ? 'thinking'
      : message.status === 'streaming'
        ? content
          ? 'streaming'
          : 'thinking'
        : message.status;
  const thinkingMs = message.stats?.thinkingMs;
  return {
    id: message.id,
    role: 'assistant',
    content,
    reasoning: message.reasoning,
    thinkingSeconds: thinkingMs ? Math.max(1, Math.round(thinkingMs / 1000)) : undefined,
    status,
    error: message.error ? `${message.error.title}. ${message.error.message}` : undefined,
    stats: viewStats(message),
  };
}

/** Resolves once the engine answers requests (or rejects after `timeoutMs`). */
function whenServing(timeoutMs = 10 * 60 * 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const word = engineWord(useEngineStore.getState().state);
      if (word.serving) return 'ok';
      if (useEngineStore.getState().state.phase === 'failed') return 'failed';
      return null;
    };
    const first = check();
    if (first === 'ok') return resolve();
    if (first === 'failed') return reject(new Error('The model failed to start.'));
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('The model took too long to start.'));
    }, timeoutMs);
    const unsubscribe = useEngineStore.subscribe(() => {
      const result = check();
      if (!result) return;
      clearTimeout(timer);
      unsubscribe();
      if (result === 'ok') resolve();
      else reject(new Error('The model failed to start.'));
    });
  });
}

export function ChatPage() {
  const load = useChatStore((s) => s.load);
  const activeId = useChatStore((s) => s.activeId);
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === s.activeId));
  const draft = useChatStore((s) => s.draft);
  const attachments = useChatStore((s) => s.attachments);
  const thinking = useChatStore((s) => s.defaults.thinking ?? 'high');
  const generating = useChatStore((s) => (activeId ? !!s.streaming[activeId] : false));
  const { setDraft, setThinking, send, stop, regenerate, addImages, removeAttachment } =
    useChatStore.getState();

  const engineState = useEngineStore((s) => s.state);
  const launchModel = useLaunchStore((s) => s.model);
  const loadLaunch = useLaunchStore((s) => s.load);
  const startingRef = useRef(false);

  useEffect(() => {
    void load();
    void loadLaunch();
  }, [load, loadLaunch]);

  const word = engineWord(engineState);
  const modelName = displayModelName(engineState.model ?? launchModel);
  const now = useNow();
  const sinceSeconds = Math.max(0, Math.round((now - engineState.sinceMs) / 1000));
  const composerEngine: ComposerEngine | undefined = !engine.available
    ? undefined
    : {
        state: word.serving
          ? engineState.phase === 'busy'
            ? 'busy'
            : 'ready'
          : word.launching
            ? 'starting'
            : 'stopped',
        modelName,
        phase: launchPhaseWord(engineState.phase),
        elapsedSeconds: word.launching ? sinceSeconds : undefined,
        progress:
          engineState.phase === 'downloading' && engineState.progress?.fraction != null
            ? engineState.progress.fraction
            : undefined,
      };

  const start = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      const result = await startEngine();
      if (!result) {
        const error = useEngineStore.getState().error;
        toast(error?.message ?? 'Splash could not start.', { tone: 'error' });
      }
    } finally {
      startingRef.current = false;
    }
  }, []);

  const submit = useCallback(async () => {
    if (engine.available && !engineWord(useEngineStore.getState().state).serving) {
      if (!engineWord(useEngineStore.getState().state).launching) await start();
      try {
        await whenServing();
      } catch (error) {
        toast(error instanceof Error ? error.message : 'The model is not running.', {
          tone: 'error',
        });
        return;
      }
    }
    await send();
  }, [send, start]);

  const onAddImages = useCallback(
    async (files: File[]) => {
      const rejected = await addImages(files);
      if (rejected.length) {
        toast(`Couldn't attach ${rejected.join(', ')}. Use JPEG, PNG, WEBP or GIF under 32 MB.`, {
          tone: 'error',
        });
      }
    },
    [addImages],
  );

  const turns = useMemo(() => conversation?.messages.map(toTurn) ?? [], [conversation?.messages]);
  const composerAttachments = attachments.map((image) => ({
    id: image.id,
    name: image.name,
    src: image.url,
    sizeBytes: image.bytes,
  }));

  const composer = (autoFocus: boolean) => (
    <Composer
      value={draft}
      onChange={setDraft}
      onSubmit={() => void submit()}
      generating={generating}
      onStop={() => stop()}
      attachments={composerAttachments}
      onAddImages={(files) => void onAddImages(files)}
      onRemoveAttachment={removeAttachment}
      effort={LEVEL_TO_EFFORT[thinking]}
      onEffortChange={(effort) => setThinking(EFFORT_TO_LEVEL[effort])}
      engine={composerEngine}
      onStartEngine={() => void start()}
      autoFocus={autoFocus}
    />
  );

  if (turns.length === 0) {
    return (
      <div className="sb-chat-page">
        <NewChatEmptyState
          composer={composer(true)}
          suggestions={SUGGESTIONS}
          onSelectSuggestion={(suggestion) => setDraft(suggestion.prompt ?? suggestion.label)}
        />
      </div>
    );
  }

  return (
    <div className="sb-chat-page">
      <ChatThread
        key={conversation?.id}
        turns={turns}
        modelName={modelName}
        onRegenerate={(id) => void regenerate(id)}
        onRetry={(id) => void regenerate(id)}
      />
      <div className="sb-chat-page__dock">{composer(false)}</div>
    </div>
  );
}
