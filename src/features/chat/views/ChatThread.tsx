import clsx from 'clsx';
import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AssistantMessage } from './AssistantMessage';
import type { AssistantTurn, ChatImage, ChatTurn } from './types';
import { UserMessage } from './UserMessage';
import './ChatThread.css';

/** Within this many pixels of the bottom the thread follows new text. */
const PIN_THRESHOLD = 48;

export interface ChatThreadProps {
  turns: ChatTurn[];
  /** Used in the screen-reader announcement ("Qwen3.8-27B is thinking"). */
  modelName?: string;
  onRegenerate?: (turnId: string) => void;
  onRetry?: (turnId: string) => void;
  onOpenImage?: (image: ChatImage) => void;
  onLinkClick?: (href: string) => void;
  /** Replaces the clipboard write for Copy and code blocks. */
  onCopy?: (text: string) => void | Promise<void>;
  /**
   * Where the thread starts: at the bottom (default), or scrolled so the turn
   * with this id sits at the top (used to restore a position, and by the gallery).
   */
  initialTurnId?: string;
  /** Turn ids whose "Thought for N seconds" starts open. */
  defaultThoughtOpen?: string[];
  /** Turn id whose stats line starts open. */
  defaultStatsOpen?: string;
  /** Extra content after the last turn. */
  children?: ReactNode;
  className?: string;
}

function announcement(turns: ChatTurn[], modelName: string): string {
  const last = [...turns].reverse().find((turn): turn is AssistantTurn => turn.role === 'assistant');
  if (!last) return '';
  switch (last.status) {
    case 'thinking':
      return `${modelName} is thinking`;
    case 'streaming':
      return `${modelName} is replying`;
    case 'error':
      return 'The reply failed';
    case 'cancelled':
      return 'Reply stopped';
    default:
      return 'Response ready';
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * The conversation: a centred 760 px column that scrolls. It follows new text
 * while you are at the bottom, stays put when you scroll up to read, and then
 * offers a "Jump to latest" button. The edges fade under the toolbar and above
 * the composer instead of slicing text.
 */
export function ChatThread({
  turns,
  modelName = 'The model',
  onRegenerate,
  onRetry,
  onOpenImage,
  onLinkClick,
  onCopy,
  initialTurnId,
  defaultThoughtOpen = [],
  defaultStatsOpen,
  children,
  className,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(initialTurnId === undefined);
  const [edges, setEdges] = useState({ above: false, below: false, far: false });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
    const next = { above: el.scrollTop > 1, below: distance > 1, far: distance > PIN_THRESHOLD };
    setEdges((prev) =>
      prev.above === next.above && prev.below === next.below && prev.far === next.far ? prev : next,
    );
    return distance;
  }, []);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollHeight - el.clientHeight;
    if (smooth && typeof el.scrollTo === 'function' && !prefersReducedMotion()) {
      el.scrollTo({ top, behavior: 'smooth' });
    } else {
      el.scrollTop = top;
    }
  }, []);

  // First paint: start at the bottom, or at the requested turn.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (initialTurnId !== undefined) {
      const target = Array.from(el.querySelectorAll<HTMLElement>('[data-turn-id]')).find(
        (node) => node.dataset.turnId === initialTurnId,
      );
      if (target) el.scrollTop = Math.max(0, target.offsetTop - 12);
    } else {
      el.scrollTop = el.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first paint only
  }, []);

  // A new turn from the user always brings the thread back to the bottom.
  const lastTurn = turns[turns.length - 1];
  const lastUserId = lastTurn?.role === 'user' ? lastTurn.id : undefined;
  useLayoutEffect(() => {
    if (lastUserId === undefined) return;
    pinnedRef.current = true;
    scrollToBottom(false);
  }, [lastUserId, scrollToBottom]);

  // Follow growing content (streaming text, images loading) while pinned.
  useEffect(() => {
    const content = contentRef.current;
    const el = scrollRef.current;
    if (!content || !el) return;
    const follow = () => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight - el.clientHeight;
      measure();
    };
    follow();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const onScroll = () => {
    const distance = measure();
    if (distance !== undefined) pinnedRef.current = distance <= PIN_THRESHOLD;
  };

  const jumpToLatest = () => {
    pinnedRef.current = true;
    scrollToBottom(true);
  };

  let latestAssistantId: string | undefined;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn?.role === 'assistant') {
      latestAssistantId = turn.id;
      break;
    }
  }

  return (
    <div className={clsx('ch-thread-wrap', className)}>
      <div
        ref={scrollRef}
        className={clsx('ch-thread', edges.above && 'has-above', edges.below && 'has-below')}
        onScroll={onScroll}
        tabIndex={-1}
      >
        <div ref={contentRef} className="ch-thread-inner">
          {turns.map((turn) =>
            turn.role === 'user' ? (
              <div key={turn.id} data-turn-id={turn.id}>
                <UserMessage content={turn.content} images={turn.images} onOpenImage={onOpenImage} />
              </div>
            ) : (
              <div key={turn.id} data-turn-id={turn.id} className="ch-turn-ai">
                <AssistantMessage
                  content={turn.content}
                  reasoning={turn.reasoning}
                  thinkingSeconds={turn.thinkingSeconds}
                  status={turn.status}
                  error={turn.error}
                  stats={turn.stats}
                  isLatest={turn.id === latestAssistantId}
                  onRegenerate={onRegenerate ? () => onRegenerate(turn.id) : undefined}
                  onRetry={onRetry ? () => onRetry(turn.id) : undefined}
                  onLinkClick={onLinkClick}
                  onCopy={onCopy}
                  defaultThoughtOpen={defaultThoughtOpen.includes(turn.id)}
                  defaultStatsOpen={defaultStatsOpen === turn.id}
                />
              </div>
            ),
          )}
          {children}
        </div>
      </div>

      <button
        type="button"
        className={clsx('ch-jump', edges.far && 'is-shown')}
        aria-label="Jump to latest"
        title="Jump to latest"
        tabIndex={edges.far ? 0 : -1}
        aria-hidden={!edges.far}
        onClick={jumpToLatest}
      >
        <ArrowDown size={16} strokeWidth={1.75} aria-hidden />
      </button>

      <div className="ch-sr-only" role="status">
        {announcement(turns, modelName)}
      </div>
    </div>
  );
}
