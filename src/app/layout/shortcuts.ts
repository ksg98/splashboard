/**
 * Window shortcuts, written once: the sidebar tooltips, the row hints, the
 * collapsed-toolbar buttons and useShellShortcuts all read this table.
 */

/** Destinations. "chat" is the open conversation (⌘1); only activity, models and connect have a sidebar row. */
export type ShellNavId = 'chat' | 'activity' | 'models' | 'connect';

export const SHELL_SHORTCUTS = {
  newChat: '⌘N',
  search: '⌘K',
  toggleSidebar: '⌘\\',
  settings: '⌘,',
  chat: '⌘1',
  activity: '⌘2',
  models: '⌘3',
  connect: '⌘4',
} as const;

/** "⌘2" -> "Meta+2", "⌃⌘S" -> "Control+Meta+S", for aria-keyshortcuts. */
export function ariaShortcut(shortcut: string): string {
  return shortcut
    .replace('⌃', 'Control+')
    .replace('⌥', 'Alt+')
    .replace('⇧', 'Shift+')
    .replace('⌘', 'Meta+');
}
