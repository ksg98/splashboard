import clsx from 'clsx';
import { Search, X } from 'lucide-react';
import type { KeyboardEvent, Ref } from 'react';
import { useFormRow } from './FormRowContext';
import './SearchField.css';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Hint shown at the right while the field is empty, e.g. "⌘K". Display only. */
  shortcut?: string;
  /** Called after Esc or the clear button empties the field. */
  onClear?: () => void;
  /** Called on Enter with the current text. */
  onSubmit?: (value: string) => void;
  /** Esc on an already empty field (e.g. close the search). */
  onEscape?: () => void;
  /** Defaults to the placeholder, then "Search". */
  'aria-label'?: string;
  'aria-controls'?: string;
  /** Width in px, or 'fill'. Default 240. */
  width?: number | 'fill';
  autoFocus?: boolean;
  disabled?: boolean;
  id?: string;
  ref?: Ref<HTMLInputElement>;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
}

const KEY_NAMES: Record<string, string> = {
  '⌘': 'Meta',
  '⇧': 'Shift',
  '⌥': 'Alt',
  '⌃': 'Control',
};

/** "⌘K" → "Meta+K", for aria-keyshortcuts. */
function toAriaShortcut(shortcut: string): string {
  const keys = [...shortcut].map((char) => KEY_NAMES[char] ?? char.toUpperCase());
  return keys.join('+');
}

/** Rounded search field (design/minimal-ref .search-field) with a clear button and an Esc to clear. */
export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  shortcut,
  onClear,
  onSubmit,
  onEscape,
  width = 240,
  autoFocus,
  disabled,
  id,
  ref,
  onKeyDown,
  className,
  'aria-label': ariaLabel,
  'aria-controls': ariaControls,
}: SearchFieldProps) {
  const row = useFormRow();
  const isDisabled = disabled ?? row?.disabled ?? false;

  const clear = () => {
    onChange('');
    onClear?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (value) clear();
      else onEscape?.();
    } else if (event.key === 'Enter') {
      onSubmit?.(value);
    }
  };

  return (
    <div
      className={clsx(
        'sb-search-field',
        isDisabled && 'is-disabled',
        width === 'fill' && 'is-fill',
        className,
      )}
      style={width === 'fill' ? undefined : { width }}
    >
      <Search className="sb-search-field__icon" size={16} strokeWidth={1.5} aria-hidden="true" />
      <input
        ref={ref}
        id={id}
        type="search"
        className="sb-search-field__input"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        aria-controls={ariaControls}
        aria-describedby={row?.describedBy}
        aria-keyshortcuts={shortcut ? toAriaShortcut(shortcut) : undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={isDisabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {value ? (
        <button
          type="button"
          className="sb-search-field__clear"
          aria-label="Clear search"
          disabled={isDisabled}
          // Keep focus in the field while clearing.
          onMouseDown={(event) => event.preventDefault()}
          onClick={clear}
        >
          <X size={10} strokeWidth={2.8} aria-hidden="true" />
        </button>
      ) : shortcut ? (
        <kbd className="sb-search-field__kbd" aria-hidden="true">
          {shortcut}
        </kbd>
      ) : null}
    </div>
  );
}
