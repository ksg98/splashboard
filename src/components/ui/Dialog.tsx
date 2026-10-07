import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { Dialog as RadixDialog, VisuallyHidden } from 'radix-ui';
import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import './Dialog.css';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The pinned sheet title (17px semibold). Also the dialog's accessible name. */
  title: ReactNode;
  /** One line under the title ("Qwen3.8-27B · incoai/Qwen3.8-27B-Splash"). */
  description?: ReactNode;
  children: ReactNode;
  /** Buttons on the right of the footer, usually Cancel then the primary action. */
  footer?: ReactNode;
  /** Panel width in px. Default 640 (forms); 560 install, 860 log. */
  width?: number;
  /** The body scrolls under the pinned header, with the scroll-edge fade. Default true. */
  scroll?: boolean;
  /** Fixed panel height in px, never taller than the window minus 80px. */
  height?: number;
  /** A status note on the left of the footer ("Restart required to apply changes"). */
  footerNote?: ReactNode;
  /** Extra controls in the header, before the close button (a segmented filter, Copy). */
  headerActions?: ReactNode;
  /** Shows the ✕ button in the header. Default true. */
  showClose?: boolean;
  /** Accessible name of the ✕ button. Default "Close". */
  closeLabel?: string;
  /**
   * sheet: header, body and footer (default).
   * bare:  only the panel; children draw their own chrome (the Settings dialog).
   *        The title is kept for screen readers but not shown.
   */
  layout?: 'sheet' | 'bare';
  /** When false, Esc and clicks on the scrim do not close it. Default true. */
  dismissible?: boolean;
  /** Called as the panel takes focus. Default: the panel itself takes focus, so Tab starts at its first control. */
  onOpenAutoFocus?: (event: Event) => void;
  className?: string;
  bodyClassName?: string;
}

/**
 * A centred sheet over a dim scrim, like Launch settings: pinned title and
 * subtitle with a close button, a body that scrolls, and a footer with a
 * status note and Cancel + primary buttons. Esc closes it and focus returns
 * to the control that opened it; the window behind is inert while it is open.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width,
  scroll = true,
  height,
  footerNote,
  headerActions,
  showClose = true,
  closeLabel = 'Close',
  layout = 'sheet',
  dismissible = true,
  onOpenAutoFocus,
  className,
  bodyClassName,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const hasDescription = description !== undefined && description !== null && layout === 'sheet';

  const handleOpenAutoFocus = (event: Event) => {
    if (onOpenAutoFocus) {
      onOpenAutoFocus(event);
      return;
    }
    event.preventDefault();
    panelRef.current?.focus({ preventScroll: true });
  };

  const preventIfFixed = (event: Event) => {
    if (!dismissible) event.preventDefault();
  };

  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = `min(${height}px, calc(100vh - 80px))`;

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="sb-dialog-scrim">
          <RadixDialog.Content
            ref={panelRef}
            className={clsx('sb-dialog', layout === 'bare' && 'sb-dialog--bare', className)}
            style={style}
            onOpenAutoFocus={handleOpenAutoFocus}
            onEscapeKeyDown={preventIfFixed}
            onPointerDownOutside={preventIfFixed}
            onInteractOutside={preventIfFixed}
            {...(hasDescription ? {} : { 'aria-describedby': undefined })}
          >
            {layout === 'bare' ? (
              <>
                <VisuallyHidden.Root>
                  <RadixDialog.Title>{title}</RadixDialog.Title>
                </VisuallyHidden.Root>
                <div className="sb-dialog__bare">{children}</div>
              </>
            ) : (
              <>
                <div className="sb-dialog__head">
                  <div className="sb-dialog__heading">
                    <RadixDialog.Title className="sb-dialog__title">{title}</RadixDialog.Title>
                    {hasDescription ? (
                      <RadixDialog.Description className="sb-dialog__description">
                        {description}
                      </RadixDialog.Description>
                    ) : null}
                  </div>
                  {headerActions || showClose ? (
                    <div className="sb-dialog__actions">
                      {headerActions}
                      {showClose ? <DialogCloseButton label={closeLabel} /> : null}
                    </div>
                  ) : null}
                </div>
                {scroll ? (
                  <ScrollEdge
                    className={clsx('sb-dialog__body', 'sb-dialog__body--scroll', bodyClassName)}
                  >
                    {children}
                  </ScrollEdge>
                ) : (
                  <div
                    className={clsx('sb-dialog__body', 'sb-dialog__body--static', bodyClassName)}
                  >
                    {children}
                  </div>
                )}
                {footer || footerNote ? (
                  <div className="sb-dialog__foot">
                    {footerNote ? <div className="sb-dialog__note">{footerNote}</div> : null}
                    {footer}
                  </div>
                ) : null}
              </>
            )}
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** The ✕ icon button that closes the enclosing Dialog (top left in the Settings dialog). */
export function DialogCloseButton({
  label = 'Close',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <RadixDialog.Close asChild>
      <button type="button" className={clsx('sb-dialog__close', className)} aria-label={label}>
        <X aria-hidden strokeWidth={1.5} />
      </button>
    </RadixDialog.Close>
  );
}

export interface ScrollEdgeProps extends HTMLAttributes<HTMLDivElement> {
  /** Also fade the bottom edge (32px) while more content is below. Default false. */
  bottom?: boolean;
  /** md fades over 16px (sheets, Settings); sm over 8px (the terminal). */
  size?: 'md' | 'sm';
  ref?: Ref<HTMLDivElement>;
}

/**
 * A scroll container whose content fades out under a pinned header once
 * scrolled, instead of being sliced at the edge. Use it for any scrolling
 * body under a fixed title (sheets, the Settings dialog panel).
 */
export function ScrollEdge({
  bottom = false,
  size = 'md',
  className,
  children,
  ref,
  ...rest
}: ScrollEdgeProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  useEffect(() => {
    const element = innerRef.current;
    if (!element) return;
    const update = () => {
      element.toggleAttribute('data-edge-above', element.scrollTop > 1);
      element.toggleAttribute(
        'data-edge-below',
        bottom && element.scrollTop + element.clientHeight < element.scrollHeight - 2,
      );
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(element);
      const first = element.firstElementChild;
      if (first) observer.observe(first);
    }
    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [bottom]);

  return (
    <div {...rest} ref={setRef} data-edge-size={size} className={clsx('sb-scroll-edge', className)}>
      {children}
    </div>
  );
}
