import { clsx } from 'clsx';
import './Spinner.css';

export interface SpinnerProps {
  /** Diameter in px. Default 16. */
  size?: number;
  /** What is loading, for VoiceOver. Default "Loading". */
  label?: string;
  /** Hide it from assistive tech when the surrounding control already says it is busy. */
  decorative?: boolean;
  className?: string;
}

/**
 * A small gray arc that turns. Under reduced motion it stays still and the
 * label still says what is happening.
 */
export function Spinner({
  size = 16,
  label = 'Loading',
  decorative = false,
  className,
}: SpinnerProps) {
  const stroke = size <= 14 ? 1.5 : 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span
      className={clsx('sb-spinner', className)}
      style={{ width: size, height: size }}
      {...(decorative ? { 'aria-hidden': true } : { role: 'status', 'aria-label': label })}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          className="sb-spinner__track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
        />
        <circle
          className="sb-spinner__arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={`${c * 0.28} ${c}`}
        />
      </svg>
    </span>
  );
}
