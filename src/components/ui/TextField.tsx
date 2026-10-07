import clsx from 'clsx';
import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { useFormRow } from './FormRowContext';
import './TextField.css';

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'prefix' | 'size' | 'width'
> {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Monospace 12px, for paths, origins, aliases, keys and tokens. */
  monospace?: boolean;
  /** Draws a 1px destructive ring and sets aria-invalid. */
  invalid?: boolean;
  /** Content inside the field before the text (a unit, a short label, an icon). */
  prefix?: ReactNode;
  /** Content inside the field after the text (a unit, a small icon button). */
  suffix?: ReactNode;
  /** Width in px, or 'fill' for the row's full width. Default 220. */
  width?: number | 'fill';
  /** Right-align the text (numbers). */
  align?: 'left' | 'right';
  ref?: Ref<HTMLInputElement>;
}

/** 24px gray field with a 6px radius (design/minimal-ref .field). */
export function TextField({
  value,
  onChange,
  monospace = false,
  invalid,
  prefix,
  suffix,
  width = 220,
  align = 'left',
  className,
  disabled,
  type = 'text',
  ref,
  ...rest
}: TextFieldProps) {
  const row = useFormRow();
  const isDisabled = disabled ?? row?.disabled ?? false;
  const isInvalid = invalid ?? row?.invalid ?? false;
  const labelledBy = rest['aria-labelledby'] ?? (rest['aria-label'] ? undefined : row?.labelId);

  return (
    <span
      className={clsx(
        'sb-field',
        monospace && 'is-mono',
        isInvalid && 'is-invalid',
        isDisabled && 'is-disabled',
        width === 'fill' && 'is-fill',
        className,
      )}
      style={width === 'fill' ? undefined : { width }}
    >
      {prefix ? <span className="sb-field__affix">{prefix}</span> : null}
      <input
        ref={ref}
        type={type}
        className={clsx('sb-field__input', align === 'right' && 'is-right')}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        {...rest}
        aria-labelledby={labelledBy}
        aria-describedby={rest['aria-describedby'] ?? row?.describedBy}
        aria-invalid={isInvalid || undefined}
        disabled={isDisabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {suffix ? <span className="sb-field__affix">{suffix}</span> : null}
    </span>
  );
}
