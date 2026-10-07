import clsx from 'clsx';
import { Info, RotateCw } from 'lucide-react';
import { useId, useState } from 'react';
import { CopyButton } from '@/components/ui/CopyButton';
import { IconButton } from '@/components/ui/IconButton';
import { statsParts } from './format';
import type { TurnStats } from './types';
import './MessageActions.css';

export interface MessageActionsProps {
  /** What Copy puts on the clipboard (the reply's Markdown). */
  text: string;
  /** Per-turn numbers; without them the Info button is hidden. */
  stats?: TurnStats;
  onRegenerate?: () => void;
  /** Replaces the clipboard write (default navigator.clipboard), e.g. with a Tauri command. */
  onCopy?: (text: string) => void | Promise<void>;
  /**
   * The latest finished turn keeps its actions visible; older turns show
   * them on hover or keyboard focus.
   */
  persistent?: boolean;
  /** Controlled stats line. */
  statsOpen?: boolean;
  defaultStatsOpen?: boolean;
  onStatsOpenChange?: (open: boolean) => void;
}

/**
 * Copy, Regenerate and Info under an assistant reply. Info toggles one line of
 * per-turn stats in 12 px secondary text next to the buttons, with no popover
 * chrome (reference: chat-stats).
 */
export function MessageActions({
  text,
  stats,
  onRegenerate,
  onCopy,
  persistent = false,
  statsOpen,
  defaultStatsOpen = false,
  onStatsOpenChange,
}: MessageActionsProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultStatsOpen);
  const open = statsOpen ?? uncontrolled;
  const statsId = useId();

  const toggle = () => {
    const next = !open;
    if (statsOpen === undefined) setUncontrolled(next);
    onStatsOpenChange?.(next);
  };

  return (
    <div
      className={clsx('ch-actions', (persistent || open) && 'is-persistent')}
      role="toolbar"
      aria-label="Message actions"
    >
      <CopyButton text={text} label="Copy" copy={onCopy} className="ch-actions-copy" />
      {onRegenerate && (
        <IconButton
          label="Regenerate"
          size="sm"
          icon={<RotateCw size={16} strokeWidth={1.5} aria-hidden />}
          onClick={onRegenerate}
        />
      )}
      {stats && (
        <>
          <IconButton
            label={open ? 'Hide stats' : 'Show stats'}
            size="sm"
            icon={<Info size={16} strokeWidth={1.5} aria-hidden />}
            aria-pressed={open}
            aria-controls={statsId}
            onClick={toggle}
          />
          <span id={statsId} className={clsx('ch-stats', open && 'is-shown')} role="status">
            {open
              ? statsParts(stats).map((part, index) => (
                  <span key={part} className="ch-stats-part">
                    {index > 0 && <span aria-hidden> · </span>}
                    {part}
                  </span>
                ))
              : null}
          </span>
        </>
      )}
    </div>
  );
}
