import clsx from 'clsx';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { useFormRow } from './FormRowContext';
import './Stepper.css';

export interface StepperProps {
  value: number;
  min?: number;
  max?: number;
  /** Default 1. */
  step?: number;
  onChange: (value: number) => void;
  /** Shown after the stepper in secondary text ("MB"). */
  unit?: string;
  'aria-label': string;
  disabled?: boolean;
  invalid?: boolean;
  /** Field width in px. Default 72. */
  width?: number;
  id?: string;
  'aria-describedby'?: string;
  className?: string;
}

function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * Number field with a macOS stepper: a 24px right-aligned tabular field and a
 * 15px up/down column. Arrow keys step (Page Up/Down by ten steps); typed
 * values are clamped and applied on Enter or blur, Esc reverts.
 */
export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  unit,
  disabled,
  invalid,
  width = 72,
  id,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
}: StepperProps) {
  const row = useFormRow();
  const isDisabled = disabled ?? row?.disabled ?? false;
  const isInvalid = invalid ?? row?.invalid ?? false;
  const decimals = decimalsOf(step);
  // null while not editing: the field shows the value prop.
  const [draft, setDraft] = useState<string | null>(null);

  const clamp = (n: number) =>
    Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, n));
  const tidy = (n: number) => Number(clamp(n).toFixed(decimals));

  const parsedDraft = draft === null || draft.trim() === '' ? null : Number(draft.trim());
  const base = parsedDraft !== null && Number.isFinite(parsedDraft) ? parsedDraft : value;

  const emit = (next: number) => {
    setDraft(null);
    if (next !== value) onChange(next);
  };

  const commit = () => {
    if (draft === null) return;
    if (parsedDraft === null || !Number.isFinite(parsedDraft)) {
      setDraft(null);
      return;
    }
    emit(tidy(parsedDraft));
  };

  const nudge = (steps: number) => emit(tidy(base + steps * step));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        nudge(1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        nudge(-1);
        break;
      case 'PageUp':
        event.preventDefault();
        nudge(10);
        break;
      case 'PageDown':
        event.preventDefault();
        nudge(-10);
        break;
      case 'Enter':
        commit();
        break;
      case 'Escape':
        if (draft !== null) {
          event.preventDefault();
          event.stopPropagation();
          setDraft(null);
        }
        break;
      default:
        break;
    }
  };

  const atMin = min !== undefined && value <= min;
  const atMax = max !== undefined && value >= max;

  return (
    <span className={clsx('sb-stepper', isDisabled && 'is-disabled', className)}>
      <input
        id={id}
        className={clsx('sb-stepper__field', isInvalid && 'is-invalid')}
        type="text"
        inputMode={decimals > 0 ? 'decimal' : 'numeric'}
        role="spinbutton"
        aria-label={ariaLabel}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={unit ? `${value} ${unit}` : undefined}
        aria-invalid={isInvalid || undefined}
        aria-describedby={describedBy ?? row?.describedBy}
        autoComplete="off"
        spellCheck={false}
        disabled={isDisabled}
        style={{ width }}
        value={draft ?? value.toFixed(decimals)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {/* The arrows repeat what ↑ and ↓ do in the field, so they stay out of the tab order. */}
      <span className="sb-stepper__arrows">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Increase ${ariaLabel}`}
          disabled={isDisabled || atMax}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => nudge(1)}
        >
          <ChevronUp size={9} strokeWidth={3} aria-hidden="true" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Decrease ${ariaLabel}`}
          disabled={isDisabled || atMin}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => nudge(-1)}
        >
          <ChevronDown size={9} strokeWidth={3} aria-hidden="true" />
        </button>
      </span>
      {unit ? (
        <span className="sb-stepper__unit" aria-hidden="true">
          {unit}
        </span>
      ) : null}
    </span>
  );
}
