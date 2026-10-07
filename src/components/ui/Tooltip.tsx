import { clsx } from 'clsx';
import { Tooltip as RadixTooltip } from 'radix-ui';
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { OverlayAlign, OverlaySide } from './Popover';
import './Popover.css';
import './Tooltip.css';

/** macOS shows help tags after a short rest, then instantly while moving between controls. */
const DELAY_MS = 600;
const SKIP_DELAY_MS = 300;

const ProviderPresent = createContext(false);

/**
 * Optional: mount once around the app so moving between controls shows the
 * next tooltip at once. A Tooltip outside any provider brings its own.
 */
export function TooltipProvider({
  children,
  delayDuration = DELAY_MS,
}: {
  children: ReactNode;
  delayDuration?: number;
}) {
  return (
    <RadixTooltip.Provider delayDuration={delayDuration} skipDelayDuration={SKIP_DELAY_MS}>
      <ProviderPresent.Provider value={true}>{children}</ProviderPresent.Provider>
    </RadixTooltip.Provider>
  );
}

export interface TooltipProps {
  content: ReactNode;
  /** The control it describes. Must forward a ref and spread props (a button). */
  children: ReactElement;
  side?: OverlaySide;
  align?: OverlayAlign;
  /** Shown after the content in secondary text, e.g. "⌘2". */
  shortcut?: string;
  /** Controlled open state (the gallery pins it open). */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Overrides the provider's delay, in ms. */
  delayDuration?: number;
  /** Renders the child alone, with no tooltip. */
  disabled?: boolean;
  className?: string;
}

/** A small help tag on hover and keyboard focus. The trigger gets aria-describedby. */
export function Tooltip({
  content,
  children,
  side = 'bottom',
  align = 'center',
  shortcut,
  open,
  defaultOpen,
  onOpenChange,
  delayDuration,
  disabled,
  className,
}: TooltipProps) {
  const hasProvider = useContext(ProviderPresent);
  if (disabled) return children;

  const tooltip = (
    <RadixTooltip.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      delayDuration={delayDuration}
    >
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={clsx('sb-floating', 'sb-tooltip', className)}
        >
          <span>{content}</span>
          {shortcut ? <kbd className="sb-tooltip__shortcut">{shortcut}</kbd> : null}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );

  if (hasProvider) return tooltip;
  return (
    <RadixTooltip.Provider delayDuration={DELAY_MS} skipDelayDuration={SKIP_DELAY_MS}>
      {tooltip}
    </RadixTooltip.Provider>
  );
}
