import clsx from 'clsx';
import { Slider as RadixSlider } from 'radix-ui';
import type { CSSProperties } from 'react';
import { useFormRow } from './FormRowContext';
import './Slider.css';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Called once when a drag or key press ends, with the final value. */
  onCommit?: (value: number) => void;
  /** Text for the value at the right ("128K", "4.2 MP") and for VoiceOver. */
  formatValue?: (value: number) => string;
  'aria-label': string;
  disabled?: boolean;
  /**
   * Named ends instead of a number, for values that mean nothing as numbers
   * ("Long prompt first" … "Replies first"). Draws tick marks under the track
   * and hides the value label; formatValue still names the position for VoiceOver.
   */
  ends?: [string, string];
  /** Tick marks under the track when `ends` is set. Default 5. */
  ticks?: number;
  /** Track width in px. Default 200 (232 with ends). */
  width?: number;
  /** Show the value at the right. Default true unless `ends` is set. */
  showValue?: boolean;
  'aria-describedby'?: string;
  className?: string;
}

/** Plain-track slider: 4px gray track, 16px white knob, no accent fill, value at the right. */
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  formatValue,
  disabled,
  ends,
  ticks = 5,
  width,
  showValue,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
}: SliderProps) {
  const row = useFormRow();
  const isDisabled = disabled ?? row?.disabled ?? false;
  const text = formatValue ? formatValue(value) : String(value);
  const withValue = showValue ?? !ends;
  const trackWidth = width ?? (ends ? 232 : 200);

  const root = (
    <RadixSlider.Root
      className="sb-slider__root"
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={isDisabled}
      onValueChange={(next) => {
        const [first] = next;
        if (first !== undefined) onChange(first);
      }}
      onValueCommit={(next) => {
        const [first] = next;
        if (first !== undefined) onCommit?.(first);
      }}
    >
      <RadixSlider.Track className="sb-slider__track" />
      <RadixSlider.Thumb
        className="sb-slider__thumb"
        aria-label={ariaLabel}
        aria-valuetext={formatValue ? text : undefined}
        aria-describedby={describedBy ?? row?.describedBy}
      />
    </RadixSlider.Root>
  );

  const style = { '--sb-slider-width': `${trackWidth}px` } as CSSProperties;

  if (ends) {
    return (
      <div
        className={clsx('sb-slider', 'has-ends', className)}
        style={style}
        data-disabled={isDisabled || undefined}
      >
        {root}
        <span className="sb-slider__ticks" aria-hidden="true">
          {Array.from({ length: Math.max(2, ticks) }, (_, index) => (
            <i key={index} />
          ))}
        </span>
        <span className="sb-slider__end" aria-hidden="true">
          {ends[0]}
        </span>
        <span className="sb-slider__end" aria-hidden="true">
          {ends[1]}
        </span>
      </div>
    );
  }

  return (
    <div
      className={clsx('sb-slider', className)}
      style={style}
      data-disabled={isDisabled || undefined}
    >
      {root}
      {withValue ? (
        <span className="sb-slider__value" aria-hidden="true">
          {text}
        </span>
      ) : null}
    </div>
  );
}
