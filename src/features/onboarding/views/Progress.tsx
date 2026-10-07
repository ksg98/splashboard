import { useLayoutEffect, useRef, type ReactNode } from 'react';
import './Progress.css';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface ProgressBarProps {
  /** 0..1, or null for an indeterminate bar. */
  value: number | null;
  label: string;
  /** What a screen reader says, e.g. "8.6 of 17.6 GB". */
  valueText?: string;
  /** 'sm' is 4px (the Start row), 'lg' 6px (sheets). */
  size?: 'sm' | 'lg';
  className?: string;
}

/** A thin gray progress bar; indeterminate while `value` is null. */
export function ProgressBar({ value, label, valueText, size = 'sm', className }: ProgressBarProps) {
  const known = value !== null && Number.isFinite(value);
  const percent = known ? Math.round(clamp01(value) * 1000) / 10 : 0;
  return (
    <div
      className={className ? `sb-fr-bar ${className}` : 'sb-fr-bar'}
      data-size={size}
      data-indeterminate={known ? undefined : ''}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? percent : undefined}
      aria-valuetext={valueText}
    >
      <span className="sb-fr-bar__fill" style={known ? { width: `${percent}%` } : undefined} />
    </div>
  );
}

export interface ProgressBlockProps {
  /** Left of the top line, e.g. "Downloading Splash 1.2.0" or the repo id. */
  title: ReactNode;
  /** Right of the top line, e.g. "214 of 418 MB". */
  value?: ReactNode;
  progress: number | null;
  progressLabel: string;
  progressValueText?: string;
  /** One line under the bar: time left, or what Cancel does. */
  foot?: ReactNode;
}

/** Title and value on one line, a 6px bar, and a footnote (design/minimal-ref .progress-block). */
export function ProgressBlock({
  title,
  value,
  progress,
  progressLabel,
  progressValueText,
  foot,
}: ProgressBlockProps) {
  return (
    <div className="sb-fr-progress">
      <div className="sb-fr-progress__line">
        <span className="sb-fr-progress__title">{title}</span>
        {value ? <span className="sb-fr-progress__value">{value}</span> : null}
      </div>
      <ProgressBar value={progress} label={progressLabel} valueText={progressValueText} size="lg" />
      <p className="sb-fr-progress__foot">{foot}</p>
    </div>
  );
}

export interface LogTailProps {
  lines: readonly string[];
  /** Accessible name, e.g. "Install log". */
  label: string;
  id?: string;
  /** A button pinned to the box's top-right corner, e.g. Copy log. */
  action?: ReactNode;
}

/**
 * The live end of a log, monospaced and selectable. It follows new lines
 * while scrolled to the bottom and stays put once the reader scrolls up.
 */
export function LogTail({ lines, label, id, action }: LogTailProps) {
  const ref = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const element = ref.current;
    if (!element) return;
    pinned.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
  };

  return (
    <div className="sb-fr-log-wrap" data-has-action={action ? '' : undefined}>
      <pre
        ref={ref}
        id={id}
        className="sb-fr-log"
        role="log"
        aria-label={label}
        aria-live="off"
        tabIndex={0}
        onScroll={onScroll}
      >
        {lines.length > 0 ? (
          lines.join('\n')
        ) : (
          <span className="sb-fr-log__empty">Waiting for output…</span>
        )}
      </pre>
      {action ? <div className="sb-fr-log-action">{action}</div> : null}
    </div>
  );
}
