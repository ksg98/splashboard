import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { ContextMenu as RadixContextMenu, DropdownMenu as RadixDropdownMenu } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import type { OverlayAlign, OverlaySide } from './Popover';
import './Popover.css';
import './Menu.css';

export interface MenuActionItem {
  type?: 'item';
  id: string;
  label: string;
  /** One line of secondary text under the label. */
  description?: string;
  /** A 16px line icon before the label. */
  icon?: ReactNode;
  /** Shows a trailing checkmark when true; the row reserves the slot when false. */
  checked?: boolean;
  disabled?: boolean;
  /** Right-aligned hint, e.g. "⌘2". */
  shortcut?: string;
  /** Red text, for actions that remove something. */
  destructive?: boolean;
  onSelect: () => void;
}

export type MenuItem =
  | MenuActionItem
  | { type: 'separator'; id?: string }
  | { type: 'heading'; label: string; id?: string }
  /** A short footnote line, e.g. "Switching models restarts the server." */
  | { type: 'note'; label: ReactNode; id?: string };

/** The Radix parts used to draw rows; DropdownMenu and ContextMenu share them. */
interface MenuParts {
  Item: typeof RadixDropdownMenu.Item;
  CheckboxItem: typeof RadixDropdownMenu.CheckboxItem;
  ItemIndicator: typeof RadixDropdownMenu.ItemIndicator;
  Label: typeof RadixDropdownMenu.Label;
  Separator: typeof RadixDropdownMenu.Separator;
}

const dropdownParts: MenuParts = RadixDropdownMenu;
const contextParts: MenuParts = RadixContextMenu;

export function MenuCheck() {
  return <Check aria-hidden strokeWidth={2} />;
}

function itemKey(item: MenuItem, index: number): string {
  return item.id ?? `${item.type ?? 'item'}-${index}`;
}

function MenuRows({ items, parts }: { items: MenuItem[]; parts: MenuParts }) {
  const hasChecks = items.some(
    (item) => (item.type === undefined || item.type === 'item') && item.checked !== undefined,
  );
  return (
    <>
      {items.map((item, index) => {
        const key = itemKey(item, index);
        if (item.type === 'separator') {
          return <parts.Separator key={key} className="sb-menu__separator" />;
        }
        if (item.type === 'heading') {
          return (
            <parts.Label key={key} className="sb-menu__heading">
              {item.label}
            </parts.Label>
          );
        }
        if (item.type === 'note') {
          return (
            <parts.Label key={key} className="sb-menu__note">
              {item.label}
            </parts.Label>
          );
        }
        const body = (
          <>
            {item.icon ? (
              <span className="sb-menu__icon" aria-hidden>
                {item.icon}
              </span>
            ) : null}
            <span className="sb-menu__text">
              <span className="sb-menu__label-text">{item.label}</span>
              {item.description ? <span className="sb-menu__desc">{item.description}</span> : null}
            </span>
            {item.shortcut ? (
              <kbd className="sb-menu__shortcut" aria-hidden>
                {item.shortcut}
              </kbd>
            ) : null}
          </>
        );
        const className = clsx('sb-menu__item', item.destructive && 'sb-menu__item--destructive');
        const ariaKeyShortcuts = item.shortcut ? toAriaShortcut(item.shortcut) : undefined;
        if (item.checked !== undefined) {
          return (
            <parts.CheckboxItem
              key={key}
              className={className}
              checked={item.checked}
              disabled={item.disabled}
              aria-keyshortcuts={ariaKeyShortcuts}
              onSelect={item.onSelect}
            >
              {body}
              <span className="sb-menu__check">
                <parts.ItemIndicator>
                  <MenuCheck />
                </parts.ItemIndicator>
              </span>
            </parts.CheckboxItem>
          );
        }
        return (
          <parts.Item
            key={key}
            className={className}
            disabled={item.disabled}
            aria-keyshortcuts={ariaKeyShortcuts}
            onSelect={item.onSelect}
          >
            {body}
            {hasChecks ? <span className="sb-menu__check" aria-hidden /> : null}
          </parts.Item>
        );
      })}
    </>
  );
}

const SYMBOLS: Record<string, string> = {
  '⌘': 'Meta',
  '⌥': 'Alt',
  '⌃': 'Control',
  '⇧': 'Shift',
  '↩': 'Enter',
  '⌫': 'Backspace',
  '⎋': 'Escape',
};

/** "⌘⇧N" -> "Meta+Shift+N" for aria-keyshortcuts. */
function toAriaShortcut(shortcut: string): string {
  const parts: string[] = [];
  let rest = '';
  for (const char of shortcut) {
    const symbol = SYMBOLS[char];
    if (symbol) parts.push(symbol);
    else rest += char;
  }
  if (rest) parts.push(rest.length === 1 ? rest.toUpperCase() : rest);
  return parts.join('+');
}

export interface MenuProps {
  /** The control that opens it. Must forward a ref and spread props (a button). */
  trigger: ReactElement;
  items: MenuItem[];
  side?: OverlaySide;
  align?: OverlayAlign;
  /** Fixed width in px. Default: fits the content, at least 200px. */
  width?: number;
  /** Controlled open state. */
  open?: boolean;
  /** Uncontrolled initial state (the gallery renders menus open). */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Accessible name for the menu. */
  'aria-label'?: string;
  /** Gap between the trigger and the menu. Default 6. */
  sideOffset?: number;
  className?: string;
  /** Makes the window behind inert while open. Default true. */
  modal?: boolean;
}

/** A dropdown menu on a trigger (role="menu"): items, headings, separators and notes. */
export function Menu({
  trigger,
  items,
  side = 'bottom',
  align = 'start',
  width,
  open,
  defaultOpen,
  onOpenChange,
  'aria-label': ariaLabel,
  sideOffset = 6,
  className,
  modal = true,
}: MenuProps) {
  return (
    <RadixDropdownMenu.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      modal={modal}
    >
      <RadixDropdownMenu.Trigger asChild>{trigger}</RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          loop
          aria-label={ariaLabel}
          // Radix names the menu after its trigger; an explicit label wins.
          {...(ariaLabel ? { 'aria-labelledby': undefined } : null)}
          className={clsx('sb-floating', 'sb-menu', className)}
          style={width !== undefined ? { width } : undefined}
        >
          <MenuRows items={items} parts={dropdownParts} />
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}

export interface ContextMenuProps {
  items: MenuItem[];
  /** The area that opens the menu on right-click or Ctrl-click (a single element). */
  children: ReactElement;
  width?: number;
  onOpenChange?: (open: boolean) => void;
  'aria-label'?: string;
  disabled?: boolean;
  className?: string;
}

/** A right-click menu over its child, with the same rows as Menu. */
export function ContextMenu({
  items,
  children,
  width,
  onOpenChange,
  'aria-label': ariaLabel,
  disabled,
  className,
}: ContextMenuProps) {
  return (
    <RadixContextMenu.Root onOpenChange={onOpenChange}>
      <RadixContextMenu.Trigger asChild disabled={disabled}>
        {children}
      </RadixContextMenu.Trigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content
          collisionPadding={8}
          loop
          aria-label={ariaLabel}
          className={clsx('sb-floating', 'sb-menu', className)}
          style={width !== undefined ? { width } : undefined}
        >
          <MenuRows items={items} parts={contextParts} />
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  );
}
