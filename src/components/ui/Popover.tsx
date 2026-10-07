import { clsx } from 'clsx';
import { Popover as RadixPopover } from 'radix-ui';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import './Popover.css';

export type OverlaySide = 'top' | 'right' | 'bottom' | 'left';
export type OverlayAlign = 'start' | 'center' | 'end';

export interface PopoverProps {
  /** The control that opens it. Must forward a ref and spread props (a button). */
  trigger: ReactElement;
  children: ReactNode;
  side?: OverlaySide;
  align?: OverlayAlign;
  /** Controlled open state. Leave undefined for an uncontrolled popover. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Fixed width in px. Default: fits the content, at least 200px. */
  width?: number;
  /** Uncontrolled initial state (the gallery renders popovers open). */
  defaultOpen?: boolean;
  /** Gap between the trigger and the panel. Default 6. */
  sideOffset?: number;
  /** Accessible name for the panel (role="dialog"). */
  'aria-label'?: string;
  /** Extra classes on the panel, e.g. to change its padding. */
  className?: string;
  style?: CSSProperties;
  /** Traps focus and makes the window behind inert while open. Default true. */
  modal?: boolean;
  /** Called when the panel takes focus; preventDefault() keeps focus on the trigger. */
  onOpenAutoFocus?: (event: Event) => void;
}

/**
 * A floating panel anchored to a trigger, on the raised surface with the
 * soft popover shadow. Esc and a click outside close it, and focus returns
 * to the trigger.
 */
export function Popover({
  trigger,
  children,
  side = 'bottom',
  align = 'center',
  open,
  onOpenChange,
  width,
  defaultOpen,
  sideOffset = 6,
  'aria-label': ariaLabel,
  className,
  style,
  modal = true,
  onOpenAutoFocus,
}: PopoverProps) {
  return (
    <RadixPopover.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      modal={modal}
    >
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          aria-label={ariaLabel}
          onOpenAutoFocus={onOpenAutoFocus}
          className={clsx('sb-floating', 'sb-popover', className)}
          style={{ ...(width !== undefined ? { width } : null), ...style }}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

/** A control inside a popover that closes it when pressed (wraps the child). */
export function PopoverClose({ children }: { children: ReactElement }) {
  return <RadixPopover.Close asChild>{children}</RadixPopover.Close>;
}
