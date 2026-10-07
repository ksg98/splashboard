import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Markdown } from '@/components/ui/Markdown';
import { StatusDot } from '@/components/ui/StatusDot';
import { thoughtLabel } from './format';
import { MessageActions } from './MessageActions';
import type { AssistantStatus, TurnStats } from './types';
import './AssistantMessage.css';

export interface AssistantMessageProps {
  /** Markdown answer text so far. */
  content: string;
  /** Streamed reasoning, if the model thought. */
  reasoning?: string;
  /** Seconds spent thinking; shown as "Thought for N seconds". */
  thinkingSeconds?: number;
  status: AssistantStatus;
  /** Plain-English reason when `status` is "error". */
  error?: string;
  stats?: TurnStats;
  /** The latest finished reply keeps its actions visible. */
  isLatest?: boolean;
  onRegenerate?: () => void;
  /** Error state: try the same request again. */
  onRetry?: () => void;
  /** Replaces the clipboard write for Copy and code blocks. */
  onCopy?: (text: string) => void | Promise<void>;
  /** Links in the answer open outside the app. */
  onLinkClick?: (href: string) => void;
  /** Controlled "Thought for N seconds" disclosure. */
  thoughtOpen?: boolean;
  defaultThoughtOpen?: boolean;
  onThoughtOpenChange?: (open: boolean) => void;
  /** Controlled stats line (see MessageActions). */
  statsOpen?: boolean;
  defaultStatsOpen?: boolean;
  onStatsOpenChange?: (open: boolean) => void;
}

function Paragraphs({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </>
  );
}

/**
 * An assistant reply: plain text on the window, no bubble. While reasoning
 * streams it shows a shimmering "Thinking…" over the live reasoning (gray,
 * left rule); once the answer starts that collapses to "Thought for N
 * seconds ›". The answer streams with Markdown's dot caret at its end.
 */
export function AssistantMessage({
  content,
  reasoning,
  thinkingSeconds,
  status,
  error,
  stats,
  isLatest = false,
  onRegenerate,
  onRetry,
  onCopy,
  onLinkClick,
  thoughtOpen,
  defaultThoughtOpen = false,
  onThoughtOpenChange,
  statsOpen,
  defaultStatsOpen,
  onStatsOpenChange,
}: AssistantMessageProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultThoughtOpen);
  const open = thoughtOpen ?? uncontrolledOpen;
  const thinkingId = useId();

  const thinkingLive = status === 'thinking';
  const hasReasoning = Boolean(reasoning && reasoning.trim());
  const showThoughtRow = thinkingLive || hasReasoning || thinkingSeconds !== undefined;
  const showReasoning = hasReasoning && (thinkingLive || open);
  const streaming = status === 'streaming';
  const finished = status === 'done' || status === 'cancelled';

  const toggleThought = () => {
    const next = !open;
    if (thoughtOpen === undefined) setUncontrolledOpen(next);
    onThoughtOpenChange?.(next);
  };

  return (
    <article
      className={clsx('ch-ai', isLatest && 'is-latest', `is-${status}`)}
      aria-label="Reply"
      aria-busy={thinkingLive || streaming}
    >
      {showThoughtRow &&
        (thinkingLive ? (
          <div className="ch-thought is-live">
            <span className="ch-shimmer">Thinking…</span>
          </div>
        ) : (
          <button
            type="button"
            className="ch-thought"
            aria-expanded={open}
            aria-controls={hasReasoning ? thinkingId : undefined}
            onClick={toggleThought}
            disabled={!hasReasoning}
          >
            <span>{thoughtLabel(thinkingSeconds)}</span>
            {hasReasoning && <ChevronRight size={14} strokeWidth={1.75} aria-hidden />}
          </button>
        ))}

      {showReasoning && (
        <div className="ch-thinking" id={thinkingId} data-selectable>
          <Paragraphs text={reasoning ?? ''} />
        </div>
      )}

      {content && (
        <div className="ch-answer">
          <Markdown streaming={streaming} onLinkClick={onLinkClick} onCopyCode={onCopy}>
            {content}
          </Markdown>
        </div>
      )}
      {streaming && !content && <span className="ch-caret" aria-hidden />}

      {status === 'cancelled' && <p className="ch-ai-note">You stopped this reply.</p>}

      {status === 'error' && (
        <div className="ch-ai-error" role="alert">
          <StatusDot tone="error" />
          <span className="ch-ai-error-text">
            {error ?? 'Something went wrong before the reply finished.'}
          </span>
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      )}

      {finished && (content || stats) && (
        <MessageActions
          text={content}
          stats={stats}
          onRegenerate={onRegenerate}
          onCopy={onCopy}
          persistent={isLatest}
          statsOpen={statsOpen}
          defaultStatsOpen={defaultStatsOpen}
          onStatsOpenChange={onStatsOpenChange}
        />
      )}
    </article>
  );
}
