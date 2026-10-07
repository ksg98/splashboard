import { Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { Popover } from '@/components/ui/Popover';
import { StatusDot } from '@/components/ui/StatusDot';
import { Tooltip } from '@/components/ui/Tooltip';
import { closeOnNavigate, focusPanel } from './popoverBehavior';
import type { EngineStateLabel } from './types';
import { useControllable } from './useControllable';
import './EngineStatusRow.css';

export interface EngineStatusRowProps {
  /** "Qwen3.8-27B" */
  model: string;
  state: EngineStateLabel;
  /** The popover content, usually <EnginePopover />. */
  popover: ReactNode;
  onOpenSettings: () => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * The engine row at the bottom of the sidebar: status dot, model name and the
 * engine word, then the Settings gear. Pressing the row opens the engine popover.
 */
export function EngineStatusRow({
  model,
  state,
  popover,
  onOpenSettings,
  open,
  defaultOpen = false,
  onOpenChange,
}: EngineStatusRowProps) {
  const [isOpen, setOpen] = useControllable(open, defaultOpen, onOpenChange);
  return (
    <div className="eng-row">
      <Popover
        open={isOpen}
        onOpenChange={setOpen}
        side="top"
        align="start"
        width={300}
        onOpenAutoFocus={focusPanel}
        aria-label={`${model} engine`}
        trigger={
          <button type="button" className="eng-row-btn" aria-label={`${model}, ${state.label}`}>
            <StatusDot tone={state.tone} />
            <span className="eng-row-name">{model}</span>
            <span className="eng-row-state">{state.label}</span>
          </button>
        }
      >
        <div onClick={closeOnNavigate(setOpen)}>{popover}</div>
      </Popover>
      <Tooltip content="Settings" shortcut="⌘," side="top">
        <IconButton
          label="Settings"
          icon={<Settings strokeWidth={1.5} size={18} />}
          onClick={onOpenSettings}
        />
      </Tooltip>
    </div>
  );
}
