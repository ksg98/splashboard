import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import './Kbd.css';

export interface KbdProps {
  /** The shortcut as macOS writes it, e.g. "⌘2", "⇧⌘L". */
  children: ReactNode;
  className?: string;
}

/** A keyboard shortcut hint: plain 12 px secondary text, as in macOS menus. */
export function Kbd({ children, className }: KbdProps) {
  return <kbd className={clsx('sb-kbd', className)}>{children}</kbd>;
}
