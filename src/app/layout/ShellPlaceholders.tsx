import { Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { StatusDot, type StatusTone } from '@/components/ui/StatusDot';
import { Tooltip } from '@/components/ui/Tooltip';
import './ShellPlaceholders.css';

/**
 * Stand-ins for the slots the feature views fill (SidebarHistory from chat,
 * EngineStatusRow from engine). The routed AppShell and the shell gallery use
 * them until the wiring phase passes the real components. They draw the
 * reference markup so the window reads right in screenshots.
 */

export interface ShellEngineState {
  label: string;
  tone: StatusTone;
}

export interface PlaceholderHistoryProps {
  groups: { label: string; items: { id: string; title: string }[] }[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  /** Sidebar search text: matching rows stay, matched words in semibold. */
  query?: string;
}

export function PlaceholderHistory({
  groups,
  activeId = null,
  onSelect,
  query = '',
}: PlaceholderHistoryProps) {
  const needle = query.trim().toLowerCase();
  const visible = groups
    .map((group) => ({
      ...group,
      items: needle
        ? group.items.filter((item) => item.title.toLowerCase().includes(needle))
        : group.items,
    }))
    .filter((group) => group.items.length > 0);

  if (needle && visible.length === 0) {
    return (
      <div className="sb-ph-history">
        <p className="sb-ph-empty" role="status">
          <strong>No results</strong>
          No chats mention “{query.trim()}”.
        </p>
      </div>
    );
  }

  return (
    <nav className="sb-ph-history" aria-label="Chats">
      {visible.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h2 className="sb-ph-label">{group.label}</h2>
          {group.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="sb-ph-chat"
              aria-current={item.id === activeId ? 'page' : undefined}
              onClick={() => onSelect?.(item.id)}
            >
              <span>{highlight(item.title, needle)}</span>
            </button>
          ))}
        </section>
      ))}
    </nav>
  );
}

function highlight(title: string, needle: string): ReactNode {
  if (!needle) return title;
  const parts: ReactNode[] = [];
  const lower = title.toLowerCase();
  let from = 0;
  let index = lower.indexOf(needle, from);
  while (index !== -1) {
    if (index > from) parts.push(title.slice(from, index));
    parts.push(<mark key={index}>{title.slice(index, index + needle.length)}</mark>);
    from = index + needle.length;
    index = lower.indexOf(needle, from);
  }
  if (from < title.length) parts.push(title.slice(from));
  return parts;
}

export interface PlaceholderEngineRowProps {
  model: string;
  state: ShellEngineState;
  onOpen?: () => void;
  onOpenSettings: () => void;
  /** Renders the Settings gear as a link (routed shell). */
  settingsHref?: string;
}

/** The sidebar's bottom row: status dot, model name, state word, then the Settings gear. */
export function PlaceholderEngineRow({
  model,
  state,
  onOpen,
  onOpenSettings,
  settingsHref,
}: PlaceholderEngineRowProps) {
  return (
    <div className="sb-ph-engine">
      <button
        type="button"
        className="sb-ph-engine__button"
        aria-label={`${model}, ${state.label}`}
        onClick={onOpen}
      >
        <StatusDot tone={state.tone} />
        <span className="sb-ph-engine__name">{model}</span>
        <span className="sb-ph-engine__state">{state.label}</span>
      </button>
      <Tooltip content="Settings" shortcut="⌘," side="top">
        {settingsHref ? (
          <a
            href={settingsHref}
            className="sb-icon-btn sb-icon-btn--md sb-icon-btn--ghost"
            aria-label="Settings"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              onOpenSettings();
            }}
          >
            <span className="sb-icon-btn__glyph" aria-hidden>
              <Settings size={18} strokeWidth={1.5} />
            </span>
          </a>
        ) : (
          <IconButton
            label="Settings"
            icon={<Settings size={18} strokeWidth={1.5} />}
            onClick={onOpenSettings}
          />
        )}
      </Tooltip>
    </div>
  );
}
