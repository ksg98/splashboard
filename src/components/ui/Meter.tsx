import clsx from 'clsx';
import './Meter.css';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export interface MeterBarProps {
  /** Fraction filled, 0..1 (clamped). */
  value: number;
  'aria-label': string;
  /** What a screen reader says for the value, e.g. "31.4 of 48 GB". Defaults to a percentage. */
  valueText?: string;
  /** 'sm' is the 4 px bar on cards; 'lg' is the 6 px bar in sheets. */
  size?: 'sm' | 'lg';
  className?: string;
}

/** A thin gray bar: memory in use, download progress. */
export function MeterBar({
  value,
  'aria-label': ariaLabel,
  valueText,
  size = 'sm',
  className,
}: MeterBarProps) {
  const fraction = clamp01(value);
  const percent = Math.round(fraction * 1000) / 10;
  return (
    <div
      className={clsx('sb-meter', size === 'lg' && 'sb-meter--lg', className)}
      role="meter"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText ?? `${Math.round(fraction * 100)}%`}
    >
      <span className="sb-meter__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

export interface DotsMeterProps {
  /** Dots filled; may be fractional (5.6 of 7 shows 5 full dots and a half-tone one). */
  filled: number;
  total: number;
  'aria-label': string;
  /** Defaults to "5.6 of 7". */
  valueText?: string;
  className?: string;
}

type DotState = 'on' | 'part' | 'off';

/** Rounds to the nearest half dot: 5.6 → 5 on + 1 half-tone, 5.8 → 6 on. */
function dotStates(filled: number, total: number): DotState[] {
  const count = Math.max(0, Math.floor(total));
  const halves = Math.round(Math.min(count, Math.max(0, Number.isFinite(filled) ? filled : 0)) * 2);
  return Array.from({ length: count }, (_, index) => {
    const full = (index + 1) * 2;
    if (halves >= full) return 'on';
    if (halves === full - 1) return 'part';
    return 'off';
  });
}

/** A row of small dots: the draft-acceptance indicator ("5.6 of 7 kept"). */
export function DotsMeter({
  filled,
  total,
  'aria-label': ariaLabel,
  valueText,
  className,
}: DotsMeterProps) {
  const states = dotStates(filled, total);
  const shown = Math.min(Math.max(0, filled), total);
  return (
    <span
      className={clsx('sb-dots', className)}
      role="meter"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.round(shown * 10) / 10}
      aria-valuetext={valueText ?? `${(Math.round(shown * 10) / 10).toString()} of ${total}`}
    >
      {states.map((state, index) => (
        <i key={index} className="sb-dots__dot" data-state={state} />
      ))}
    </span>
  );
}
