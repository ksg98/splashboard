import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { StatusDot, type StatusTone } from '@/components/ui/StatusDot';
import './AppShellView.css';

export interface ToolbarEngineChipProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  /** Running (or last) model, e.g. "Qwen3.8-27B". Read as part of the accessible name. */
  model: string;
  state: { label: string; tone: StatusTone };
  ref?: Ref<HTMLButtonElement>;
}

/**
 * The engine state at the toolbar's right end while the sidebar is hidden: a
 * dot and Ready / Thinking / Starting… / Stopped. Pass it to AppShellView's
 * `toolbarEngine`, wrapped as the trigger of a Popover holding EnginePopover:
 *
 *   <Popover side="bottom" align="end" trigger={<ToolbarEngineChip … />}>
 *     <EnginePopover … />
 *   </Popover>
 *
 * Forwards its ref and every button attribute, so Popover can drive it.
 */
export function ToolbarEngineChip({
  model,
  state,
  className,
  type = 'button',
  ref,
  ...rest
}: ToolbarEngineChipProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx('sb-tb-engine', className)}
      aria-label={`${model}, ${state.label}`}
      aria-haspopup="dialog"
      title={model}
      {...rest}
    >
      <StatusDot tone={state.tone} />
      <span>{state.label}</span>
    </button>
  );
}
