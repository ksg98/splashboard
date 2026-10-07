import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Spinner } from './Spinner';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * primary: the black pill (white in dark), one per screen, Start is always primary.
   * secondary: the gray pill (default), every row-level action.
   * ghost: a text button with no fill until hover ("Start now", "Regenerate…").
   * destructive: the gray pill with red text, for actions that remove something.
   */
  variant?: ButtonVariant;
  /** sm 24 px, md 28 px (default), lg 36 px (the one primary action of a page or dialog). */
  size?: ButtonSize;
  /** Leading glyph. The design keeps text buttons icon-free; use sparingly. */
  icon?: ReactNode;
  /** Trailing glyph, e.g. ↗ when the action leaves Splashboard. */
  iconEnd?: ReactNode;
  /** Shows a spinner in place of the leading icon and disables the button. */
  loading?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/** A macOS / ChatGPT pill button. Forwards its ref and every button attribute. */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconEnd,
  loading = false,
  block = false,
  className,
  children,
  disabled,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  const lead = loading ? (
    <Spinner size={size === 'lg' ? 16 : 14} decorative className="sb-btn__spinner" />
  ) : icon ? (
    <span className="sb-btn__icon" aria-hidden>
      {icon}
    </span>
  ) : null;

  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        'sb-btn',
        `sb-btn--${variant}`,
        `sb-btn--${size}`,
        block && 'sb-btn--block',
        loading && 'is-loading',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {lead}
      {children !== undefined && children !== null && children !== false ? (
        <span className="sb-btn__label">{children}</span>
      ) : null}
      {iconEnd ? (
        <span className="sb-btn__icon" aria-hidden>
          {iconEnd}
        </span>
      ) : null}
    </button>
  );
}
