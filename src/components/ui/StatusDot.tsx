import { clsx } from 'clsx';
import './StatusDot.css';

export type StatusTone = 'ok' | 'busy' | 'warn' | 'error' | 'off';

export interface StatusDotProps {
  /**
   * ok: green (Ready). busy: green with a slow pulse (Thinking).
   * warn: orange (Starting…). error: red. off: a hollow gray ring (Stopped).
   */
  tone: StatusTone;
  /** Pulse the dot. Default: on for busy, off otherwise. Stops under reduced motion. */
  pulse?: boolean;
  /**
   * Visible text drawn after the dot ("Ready"). Colour is never the only
   * signal: without a label the dot is hidden from VoiceOver, so put the
   * word next to it yourself.
   */
  label?: string;
  className?: string;
}

/** The 8 px status dot. The only place green, orange and red appear. */
export function StatusDot({ tone, pulse, label, className }: StatusDotProps) {
  const pulsing = pulse ?? tone === 'busy';
  const dot = (
    <span
      className={clsx('sb-dot', `sb-dot--${tone}`, pulsing && 'is-pulsing', !label && className)}
      data-tone={tone}
      aria-hidden
    />
  );
  if (!label) return dot;
  return (
    <span className={clsx('sb-dot-label', className)}>
      {dot}
      <span className="sb-dot-label__text">{label}</span>
    </span>
  );
}
