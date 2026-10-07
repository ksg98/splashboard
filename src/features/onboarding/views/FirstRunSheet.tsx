import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import './FirstRunSheet.css';

export interface FirstRunSheetProps {
  title: string;
  /** "Step 1 of 3" */
  subtitle?: ReactNode;
  children: ReactNode;
  /** Left of the footer: what the sheet runs or where it saves. */
  note?: ReactNode;
  /** Right of the footer: Cancel, then the primary button. */
  actions: ReactNode;
  /** Default 560. */
  width?: number;
  /** Esc. Leave unset where Esc must not stop work in progress. */
  onEscape?: () => void;
}

/**
 * The first-run sheet surface: title, subtitle, a scrolling body and a footer
 * with a note and buttons. Welcome places it under the steps and makes the
 * window behind it inert, so focus stays in the sheet.
 */
export function FirstRunSheet({
  title,
  subtitle,
  children,
  note,
  actions,
  width = 560,
  onEscape,
}: FirstRunSheetProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  // Take focus when the sheet opens, as a macOS sheet does.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && onEscape) {
      event.stopPropagation();
      onEscape();
    }
  };

  return (
    <div
      ref={ref}
      className="sb-fr-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{ width }}
      onKeyDown={onKeyDown}
    >
      <div className="sb-fr-sheet__head">
        <h2 id={titleId} className="sb-fr-sheet__title">
          {title}
        </h2>
        {subtitle ? <p className="sb-fr-sheet__sub">{subtitle}</p> : null}
      </div>
      <div className="sb-fr-sheet__body">{children}</div>
      <div className="sb-fr-sheet__foot">
        <div className="sb-fr-sheet__note">{note}</div>
        <div className="sb-fr-sheet__actions">{actions}</div>
      </div>
    </div>
  );
}
