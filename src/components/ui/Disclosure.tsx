import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import './Disclosure.css';

export interface DisclosureProps {
  /** "Show command", "More options", "Customize". */
  label: ReactNode;
  /** Label while open ("Hide command"). Defaults to `label`. */
  openLabel?: ReactNode;
  /** Controlled open state. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  /**
   * inline (default): chevron then label, a quiet text button ("Show command").
   * row: the last row of a FormGroup, label then chevron, and the panel grows
   * the same group ("More options ›", "Customize ›"); put FormRows in it.
   */
  variant?: 'inline' | 'row';
  className?: string;
}

/**
 * Disclosure: the chevron turns 90° and the panel grows (height and fade,
 * 200 ms; instant with reduced motion). Closed content stays mounted but is
 * hidden from focus and VoiceOver.
 */
export function Disclosure({
  label,
  openLabel,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
  variant = 'inline',
  className,
}: DisclosureProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const panelId = useId();

  const toggle = () => {
    const next = !open;
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  const chevron = (
    <ChevronRight
      className="sb-disclosure__chevron"
      size={12}
      strokeWidth={2.4}
      aria-hidden="true"
    />
  );
  const text = <span>{open && openLabel != null ? openLabel : label}</span>;

  const panel = (
    <div
      id={panelId}
      className={clsx('sb-disclosure-panel', open && 'is-open')}
      data-state={open ? 'open' : 'closed'}
    >
      <div className="sb-disclosure-panel__inner">{children}</div>
    </div>
  );

  if (variant === 'row') {
    // Two siblings, not a wrapper, so the group's hairlines and corners still apply.
    return (
      <>
        <button
          type="button"
          className={clsx('sb-form-more', className)}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
        >
          {text}
          {chevron}
        </button>
        {panel}
      </>
    );
  }

  return (
    <div className={clsx('sb-disclosure-wrap', className)}>
      <button
        type="button"
        className="sb-disclosure"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        {chevron}
        {text}
      </button>
      {panel}
    </div>
  );
}
