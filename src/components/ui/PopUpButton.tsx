import { clsx } from 'clsx';
import { ChevronDown, ChevronsUpDown } from 'lucide-react';
import { DropdownMenu as RadixDropdownMenu } from 'radix-ui';
import { useId, type ReactNode } from 'react';
import { useFormRow } from './FormRowContext';
import { MenuCheck } from './Menu';
import type { OverlayAlign, OverlaySide } from './Popover';
import './Popover.css';
import './Menu.css';
import './PopUpButton.css';

export interface PopUpOption<T extends string> {
  value: T;
  label: string;
  /** One line of secondary text under the label in the menu. */
  description?: string;
  disabled?: boolean;
}

export interface PopUpButtonProps<T extends string> {
  value: T;
  options: PopUpOption<T>[];
  onChange: (value: T) => void;
  /** filled: 24px (sm) / 28px (md). plain: 28px (sm) / 36px (md). */
  size?: 'sm' | 'md';
  /** filled: macOS pop-up with up-down chevrons. plain: ChatGPT pill with a chevron. */
  variant?: 'plain' | 'filled';
  /** Names the control; the chosen value (and a FormRow's help line) is its description. */
  'aria-label': string;
  /** A 16px line icon before the value (the bulb on the thinking pill). */
  icon?: ReactNode;
  /** What the button shows, when it differs from the option label ("Medium thinking"). */
  valueLabel?: ReactNode;
  /** A small gray title at the top of the menu ("Thinking", "Version"). */
  heading?: string;
  /** A footnote at the bottom of the menu. */
  note?: ReactNode;
  /** Menu width in px. Default: fits the options, at least 200px. */
  menuWidth?: number;
  side?: OverlaySide;
  align?: OverlayAlign;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * A button that shows the current choice and opens a menu of choices with a
 * checkmark on the current one (role="menu", menuitemradio, aria-checked).
 */
export function PopUpButton<T extends string>({
  value,
  options,
  onChange,
  size,
  variant = 'filled',
  'aria-label': ariaLabel,
  icon,
  valueLabel,
  heading,
  note,
  menuWidth,
  side = 'bottom',
  align = 'start',
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  id,
  className,
}: PopUpButtonProps<T>) {
  const valueId = useId();
  // Inside a FormRow: disabled with the row and described by its help line.
  const row = useFormRow();
  const isDisabled = disabled || row?.disabled || false;
  const describedBy = [valueId, row?.describedBy].filter(Boolean).join(' ');
  const resolvedSize = size ?? (variant === 'plain' ? 'md' : 'sm');
  const selected = options.find((option) => option.value === value);
  const shown = valueLabel ?? selected?.label ?? value;
  const Chevron = variant === 'filled' ? ChevronsUpDown : ChevronDown;

  return (
    <RadixDropdownMenu.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <RadixDropdownMenu.Trigger asChild disabled={isDisabled}>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          className={clsx(
            'sb-popup',
            `sb-popup--${variant}`,
            `sb-popup--${resolvedSize}`,
            className,
          )}
        >
          {icon ? (
            <span className="sb-popup__icon" aria-hidden>
              {icon}
            </span>
          ) : null}
          <span className="sb-popup__value" id={valueId}>
            {shown}
          </span>
          <Chevron
            className="sb-popup__chevron"
            aria-hidden
            strokeWidth={variant === 'filled' ? 2 : 2.25}
          />
        </button>
      </RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          loop
          aria-label={heading ?? ariaLabel}
          aria-labelledby={undefined}
          className="sb-floating sb-menu"
          style={menuWidth !== undefined ? { width: menuWidth } : undefined}
        >
          {heading ? (
            <RadixDropdownMenu.Label className="sb-menu__heading">
              {heading}
            </RadixDropdownMenu.Label>
          ) : null}
          <RadixDropdownMenu.RadioGroup
            value={value}
            onValueChange={(next) => {
              const match = options.find((option) => option.value === next);
              if (match) onChange(match.value);
            }}
          >
            {options.map((option) => (
              <RadixDropdownMenu.RadioItem
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="sb-menu__item"
              >
                <span className="sb-menu__text">
                  <span className="sb-menu__label-text">{option.label}</span>
                  {option.description ? (
                    <span className="sb-menu__desc">{option.description}</span>
                  ) : null}
                </span>
                <span className="sb-menu__check">
                  <RadixDropdownMenu.ItemIndicator>
                    <MenuCheck />
                  </RadixDropdownMenu.ItemIndicator>
                </span>
              </RadixDropdownMenu.RadioItem>
            ))}
          </RadixDropdownMenu.RadioGroup>
          {note ? (
            <RadixDropdownMenu.Label className="sb-menu__note">{note}</RadixDropdownMenu.Label>
          ) : null}
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}
