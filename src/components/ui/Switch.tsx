import clsx from 'clsx';
import { Switch as RadixSwitch } from 'radix-ui';
import { useFormRow } from './FormRowContext';
import './Switch.css';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  'aria-label': string;
  disabled?: boolean;
  id?: string;
  'aria-describedby'?: string;
  className?: string;
}

/** macOS switch: 32×18 track, 16px white knob, the system accent when on. */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
}: SwitchProps) {
  const row = useFormRow();
  return (
    <RadixSwitch.Root
      className={clsx('sb-switch', className)}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled ?? row?.disabled}
      id={id}
      aria-label={ariaLabel}
      aria-describedby={describedBy ?? row?.describedBy}
    >
      <RadixSwitch.Thumb className="sb-switch__knob" />
    </RadixSwitch.Root>
  );
}
