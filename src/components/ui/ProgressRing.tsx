import { clsx } from 'clsx';
import './ProgressRing.css';

export interface ProgressRingProps {
  /** 0..1, clamped. */
  value: number;
  /** Diameter in px. Default 28 (the download ring in the Models list). */
  size?: number;
  /** What is progressing, e.g. "Downloading Qwen3.6-35B-A3B". */
  label: string;
  /** Makes the ring a button with a stop square; pressing it cancels. */
  onCancel?: () => void;
  /** Accessible name of the stop button. Default "Stop" + label, e.g. "Stop downloading Qwen3.6-35B-A3B". */
  cancelLabel?: string;
  className?: string;
}

/**
 * The App Store download ring: a 2 px gray track, a 2 px arc and, when it can
 * be cancelled, a 7 px stop square, all in the primary text colour.
 */
export function ProgressRing({
  value,
  size = 28,
  label,
  onCancel,
  cancelLabel,
  className,
}: ProgressRingProps) {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const percent = Math.round(clamped * 100);
  const stroke = 2;
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  const square = Math.max(5, Math.round(size / 4));
  const centre = size / 2;

  return (
    <span
      className={clsx('sb-ring', onCancel && 'sb-ring--cancellable', className)}
      style={{ width: size, height: size }}
    >
      <span
        className="sb-ring__meter"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%`}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <circle className="sb-ring__track" cx={centre} cy={centre} r={r} strokeWidth={stroke} />
          <circle
            className="sb-ring__fill"
            cx={centre}
            cy={centre}
            r={r}
            strokeWidth={stroke}
            strokeDasharray={`${c * clamped} ${c}`}
            transform={`rotate(-90 ${centre} ${centre})`}
          />
          {onCancel ? (
            <rect
              className="sb-ring__stop"
              x={centre - square / 2}
              y={centre - square / 2}
              width={square}
              height={square}
              rx={1.5}
            />
          ) : null}
        </svg>
      </span>
      {onCancel ? (
        <button
          type="button"
          className="sb-ring__button"
          aria-label={cancelLabel ?? `Stop ${lowerFirst(label)}`}
          onClick={onCancel}
        />
      ) : null}
    </span>
  );
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}
