import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import './IconButton.css';

export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonVariant = 'ghost' | 'secondary' | 'primary';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  /** Accessible name. Icon-only buttons always need one. */
  label: string;
  /** A line icon (lucide, strokeWidth 1.5). Sized by the button: 16 px at sm, 18 px at md and lg. */
  icon: ReactNode;
  /** sm 30 px, md 32 px (default), lg 36 px. */
  size?: IconButtonSize;
  /**
   * ghost (default): secondary-gray glyph, light fill on hover.
   * secondary: gray fill.
   * primary: black circle (white in dark), the composer's send and stop.
   */
  variant?: IconButtonVariant;
  /** Default: circle for primary and for lg, rounded square otherwise. */
  shape?: 'rounded' | 'circle';
  ref?: Ref<HTMLButtonElement>;
}

/** An icon-only button. Forwards its ref and every button attribute (Tooltip and Popover triggers work). */
export function IconButton({
  label,
  icon,
  size = 'md',
  variant = 'ghost',
  shape,
  className,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  const resolvedShape = shape ?? (variant === 'primary' || size === 'lg' ? 'circle' : 'rounded');
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={clsx(
        'sb-icon-btn',
        `sb-icon-btn--${size}`,
        `sb-icon-btn--${variant}`,
        resolvedShape === 'circle' && 'sb-icon-btn--circle',
        className,
      )}
      {...rest}
    >
      <span className="sb-icon-btn__glyph" aria-hidden>
        {icon}
      </span>
    </button>
  );
}
