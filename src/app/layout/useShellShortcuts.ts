import { useEffect, useRef } from 'react';
import type { ShellNavId } from './shortcuts';

export interface ShellShortcutHandlers {
  onNewChat?: () => void;
  onSearch?: () => void;
  onToggleSidebar?: () => void;
  onNavigate?: (id: ShellNavId) => void;
  onOpenSettings?: () => void;
}

const DESTINATION_KEYS: Record<string, ShellNavId> = {
  '1': 'chat',
  '2': 'activity',
  '3': 'models',
  '4': 'connect',
};

/**
 * Window shortcuts (see ./shortcuts.ts): ⌘N new chat, ⌘K search chats,
 * ⌘\ (and ⌃⌘S, the View menu's macOS default) toggles the sidebar, ⌘1–⌘4
 * open Chat, Activity, Models and Connect, ⌘, opens Settings. They work with
 * the sidebar hidden too. Mount once, in the routed shell.
 */
export function useShellShortcuts(handlers: ShellShortcutHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.altKey || event.isComposing) return;
      const h = latest.current;
      const key = event.key.toLowerCase();
      let handled = true;
      if (event.ctrlKey) {
        if (key === 's' && h.onToggleSidebar) h.onToggleSidebar();
        else handled = false;
      } else if (event.shiftKey) {
        handled = false;
      } else if (key === 'n' && h.onNewChat) h.onNewChat();
      else if (key === 'k' && h.onSearch) h.onSearch();
      else if (key === '\\' && h.onToggleSidebar) h.onToggleSidebar();
      else if (key === ',' && h.onOpenSettings) h.onOpenSettings();
      else if (key in DESTINATION_KEYS && h.onNavigate)
        h.onNavigate(DESTINATION_KEYS[key] as ShellNavId);
      else handled = false;
      if (handled) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
