import clsx from 'clsx';
import { Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ContextMenu, Menu, type MenuItem } from '@/components/ui/Menu';
import { splitMatches } from './format';
import type { HistoryGroup, HistoryItem } from './types';
import './SidebarHistory.css';

export interface SidebarHistoryProps {
  /** Today, Yesterday, Previous 7 days, Older; empty groups are skipped. */
  groups: HistoryGroup[];
  /**
   * The open conversation. Pass null on a new chat: "New chat" is an action,
   * so nothing in the sidebar is selected then.
   */
  activeId?: string | null;
  onSelect: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  /**
   * Filters the list as the sidebar search field is typed in: matches stay
   * under their group label with the matched words in semibold; no match
   * shows "No results".
   */
  query?: string;
  /** Starts with this row in inline rename (gallery and tests). */
  defaultRenamingId?: string;
}

function Title({ title, query }: { title: string; query: string }) {
  return (
    <>
      {splitMatches(title, query).map((range, index) =>
        range.match ? <mark key={index}>{range.text}</mark> : <span key={index}>{range.text}</span>,
      )}
    </>
  );
}

function RenameField({
  item,
  onCommit,
  onCancel,
}: {
  item: HistoryItem;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(item.title);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  // The row menu closes and hands focus back after this mounts, so focus on the next frame.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const title = draft.trim();
    if (commit && title && title !== item.title) onCommit(title);
    else onCancel();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  };

  return (
    <input
      ref={ref}
      className="ch-history-rename"
      value={draft}
      aria-label="Chat name"
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
    />
  );
}

/**
 * Conversation history in the sidebar: 12 px group labels and 32 px rows.
 * Hovering a row shows a ⋯ menu with Rename (inline) and Delete.
 */
export function SidebarHistory({
  groups,
  activeId = null,
  onSelect,
  onRename,
  onDelete,
  query = '',
  defaultRenamingId,
}: SidebarHistoryProps) {
  const [renamingId, setRenamingId] = useState<string | null>(defaultRenamingId ?? null);
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
      <div className="ch-history">
        <div className="ch-history-empty" role="status">
          <strong>No results</strong>
          No chats mention “{query.trim()}”.
        </div>
      </div>
    );
  }

  return (
    <nav className="ch-history" aria-label="Chats">
      {visible.map((group) => (
        <section key={group.label} className="ch-history-group" aria-label={group.label}>
          <h2 className="ch-history-label">{group.label}</h2>
          <ul className="ch-history-list">
            {group.items.map((item) => {
              const current = item.id === activeId;
              const renaming = item.id === renamingId && Boolean(onRename);
              const menuItems: MenuItem[] = [];
              if (onRename) {
                menuItems.push({
                  id: 'rename',
                  label: 'Rename',
                  icon: <Pencil size={16} strokeWidth={1.5} aria-hidden />,
                  onSelect: () => setRenamingId(item.id),
                });
              }
              if (onDelete) {
                menuItems.push({
                  id: 'delete',
                  label: 'Delete',
                  icon: <Trash2 size={16} strokeWidth={1.5} aria-hidden />,
                  onSelect: () => onDelete(item.id),
                });
              }
              return (
                <li
                  key={item.id}
                  className={clsx('ch-history-row', current && 'is-current', renaming && 'is-renaming')}
                >
                  {renaming ? (
                    <RenameField
                      item={item}
                      onCommit={(title) => {
                        setRenamingId(null);
                        onRename?.(item.id, title);
                      }}
                      onCancel={() => setRenamingId(null)}
                    />
                  ) : (
                    <>
                      <ContextMenu items={menuItems} width={180} disabled={menuItems.length === 0}>
                        <button
                          type="button"
                          className="ch-history-link"
                          aria-current={current ? 'page' : undefined}
                          title={item.title}
                          onClick={() => onSelect(item.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'F2' && onRename) {
                              event.preventDefault();
                              setRenamingId(item.id);
                            }
                          }}
                        >
                          <span className="ch-history-title">
                            <Title title={item.title} query={needle ? query.trim() : ''} />
                          </span>
                        </button>
                      </ContextMenu>
                      {menuItems.length > 0 && (
                        <Menu
                          side="bottom"
                          align="start"
                          width={180}
                          items={menuItems}
                          aria-label={`Actions for ${item.title}`}
                          trigger={
                            <button
                              type="button"
                              className="ch-history-more"
                              aria-label={`More for ${item.title}`}
                            >
                              <Ellipsis size={16} strokeWidth={1.5} aria-hidden />
                            </button>
                          }
                        />
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
