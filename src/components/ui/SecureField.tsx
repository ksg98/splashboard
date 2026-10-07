import { Eye, EyeOff } from 'lucide-react';
import { useState, type Ref } from 'react';
import { useFormRow } from './FormRowContext';
import { TextField } from './TextField';
import './SecureField.css';

export interface SecureFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Adds an eye button that shows the text. Default true. */
  revealable?: boolean;
  placeholder?: string;
  /** Names the field and its reveal button ("Hugging Face token"). Defaults to the row label. */
  'aria-label'?: string;
  'aria-describedby'?: string;
  /** Width in px, or 'fill'. Default 220. */
  width?: number | 'fill';
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  autoFocus?: boolean;
  /** Start revealed (controlled reveal is not needed anywhere yet). */
  defaultRevealed?: boolean;
  ref?: Ref<HTMLInputElement>;
  className?: string;
}

/** A password field in monospace, with an optional eye button to show the secret. */
export function SecureField({
  value,
  onChange,
  revealable = true,
  placeholder,
  width = 220,
  invalid,
  disabled,
  id,
  autoFocus,
  defaultRevealed = false,
  ref,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
}: SecureFieldProps) {
  const row = useFormRow();
  const [revealed, setRevealed] = useState(defaultRevealed);
  const isDisabled = disabled ?? row?.disabled ?? false;
  const name = ariaLabel ?? 'secret';

  return (
    <TextField
      ref={ref}
      id={id}
      className={className}
      type={revealed ? 'text' : 'password'}
      monospace
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      width={width}
      invalid={invalid}
      disabled={isDisabled}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      suffix={
        revealable ? (
          <button
            type="button"
            className="sb-secure-field__reveal"
            aria-label={revealed ? `Hide ${name}` : `Show ${name}`}
            aria-pressed={revealed}
            disabled={isDisabled}
            onClick={() => setRevealed((current) => !current)}
          >
            {revealed ? (
              <EyeOff size={14} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Eye size={14} strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
        ) : undefined
      }
    />
  );
}
