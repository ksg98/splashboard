import type { MouseEvent } from 'react';

/**
 * Click handler for the element that wraps the engine popover's content:
 * after a page link inside it (Open Activity, Open Models, Launch settings…)
 * the popover closes. Start, Stop and Restart keep it open, so it can show
 * the new state.
 */
export function closeOnNavigate(setOpen: (open: boolean) => void) {
  return (event: MouseEvent<HTMLElement>) => {
    const target = event.target as Element | null;
    if (target?.closest('[data-closes-popover]')) setOpen(false);
  };
}

/**
 * The engine popover takes focus itself instead of its first button, so a
 * second Return after opening it never restarts or stops the server. Tab then
 * moves through Restart, Stop and the page links.
 */
export function focusPanel(event: Event) {
  event.preventDefault();
  const panel = event.currentTarget ?? event.target;
  if (panel instanceof HTMLElement) panel.focus({ preventScroll: true });
}
