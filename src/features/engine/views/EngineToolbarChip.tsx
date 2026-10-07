import type { ReactNode } from 'react';
import { Popover } from '@/components/ui/Popover';
import { StatusDot } from '@/components/ui/StatusDot';
import { closeOnNavigate, focusPanel } from './popoverBehavior';
import type { EngineStateLabel } from './types';
import { useControllable } from './useControllable';
import './EngineToolbarChip.css';

export interface EngineToolbarChipProps {
  /** "Qwen3.8-27B": part of the accessible name only. */
  model: string;
  state: EngineStateLabel;
  /** The popover content, usually <EnginePopover onOpenModels={…} />. */
  popover: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * With the sidebar hidden, the toolbar's right end shows the engine state (a
 * dot and Ready / Thinking / Starting… / Stopped) and opens the same engine
 * popover, whose Open Activity ⌘2 and Open Models ⌘3 reach the engine's pages.
 */
export function EngineToolbarChip({
  model,
  state,
  popover,
  open,
  defaultOpen = false,
  onOpenChange,
}: EngineToolbarChipProps) {
  const [isOpen, setOpen] = useControllable(open, defaultOpen, onOpenChange);
  return (
    <Popover
      open={isOpen}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      width={300}
      onOpenAutoFocus={focusPanel}
      aria-label={`${model} engine`}
      trigger={
        <button type="button" className="eng-chip" aria-label={`${model}, ${state.label}`}>
          <StatusDot tone={state.tone} />
          <span>{state.label}</span>
        </button>
      }
    >
      <div onClick={closeOnNavigate(setOpen)}>{popover}</div>
    </Popover>
  );
}
