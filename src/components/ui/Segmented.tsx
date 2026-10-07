import clsx from 'clsx';
import { ToggleGroup } from 'radix-ui';
import type { ReactNode } from 'react';
import { useFormRow } from './FormRowContext';
import './Segmented.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Show only the icon; the label becomes the segment's accessible name. */
  iconOnly?: boolean;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** md (default) is the System Settings size: 22px segments, 12px text. sm is 20px, 11px. */
  size?: 'sm' | 'md';
  'aria-label': string;
  disabled?: boolean;
  /** Every segment as wide as the widest, as on macOS when the labels are short. */
  equalWidths?: boolean;
  className?: string;
}

/**
 * Segmented control ("Compact (8-bit) | Full (16-bit)", "System | Light | Dark").
 * One segment is always selected; arrow keys move between segments.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  disabled,
  equalWidths = false,
  className,
  'aria-label': ariaLabel,
}: SegmentedProps<T>) {
  const row = useFormRow();
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        // Radix sends "" when the selected segment is pressed again: keep the selection.
        const match = options.find((option) => option.value === next);
        if (match && match.value !== value) onChange(match.value);
      }}
      disabled={disabled ?? row?.disabled}
      aria-label={ariaLabel}
      aria-describedby={row?.describedBy}
      className={clsx('sb-segmented', `is-${size}`, equalWidths && 'is-equal', className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          aria-label={option.iconOnly ? option.label : undefined}
          className="sb-segmented__item"
        >
          {option.icon ? (
            <span className="sb-segmented__icon" aria-hidden="true">
              {option.icon}
            </span>
          ) : null}
          {option.iconOnly ? null : <span className="sb-segmented__label">{option.label}</span>}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
