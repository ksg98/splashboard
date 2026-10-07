import { Command } from 'cmdk';
import { MessageCircle, Search, X } from 'lucide-react';
import { Dialog, VisuallyHidden } from 'radix-ui';
import { useMemo } from 'react';
import { splitMatches } from './format';
import { searchChats, type ChatSearchResult } from './search';
import type { SearchableChat } from './types';
import './SearchChats.css';

export interface SearchChatsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Every chat, newest first, with its group label and message text. */
  chats: SearchableChat[];
  /** Opens the chosen chat; the overlay closes itself. */
  onSelect: (id: string) => void;
  /** Most rows shown at once. */
  limit?: number;
  /** Portal target (defaults to document.body). */
  container?: HTMLElement | null;
}

function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitMatches(text, query).map((range, index) =>
        range.match ? <mark key={index}>{range.text}</mark> : <span key={index}>{range.text}</span>,
      )}
    </>
  );
}

function groupResults(results: ChatSearchResult[]): { label: string; items: ChatSearchResult[] }[] {
  const groups: { label: string; items: ChatSearchResult[] }[] = [];
  for (const result of results) {
    const last = groups[groups.length - 1];
    if (last && last.label === result.group) last.items.push(result);
    else groups.push({ label: result.group, items: [result] });
  }
  return groups;
}

/**
 * Search chats (⌘K): a centred overlay with one search field. Results keep
 * their Today / Previous 7 days labels; the matched words are set in semibold
 * in the title and in a one-line snippet from the messages. Esc clears and
 * closes it.
 */
export function SearchChats({
  open,
  onOpenChange,
  query,
  onQueryChange,
  chats,
  onSelect,
  limit = 50,
  container,
}: SearchChatsProps) {
  const trimmed = query.trim();
  const results = useMemo(() => searchChats(chats, query).slice(0, limit), [chats, query, limit]);
  const groups = groupResults(results);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container ?? undefined}>
        <Dialog.Overlay className="ch-search-scrim" />
        <Dialog.Content
          className="ch-search"
          aria-describedby={undefined}
          onEscapeKeyDown={() => onQueryChange('')}
        >
          <VisuallyHidden.Root>
            <Dialog.Title>Search chats</Dialog.Title>
          </VisuallyHidden.Root>
          <Command label="Search chats" shouldFilter={false} loop>
            <div className="ch-search-field">
              <Search size={18} strokeWidth={1.5} aria-hidden className="ch-search-icon" />
              <Command.Input
                className="ch-search-input"
                value={query}
                onValueChange={onQueryChange}
                placeholder="Search chats"
                autoFocus
                spellCheck={false}
              />
              {query && (
                <button
                  type="button"
                  className="ch-search-clear"
                  aria-label="Clear search"
                  // Keep focus in the field while clearing.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onQueryChange('')}
                >
                  <X size={10} strokeWidth={2.5} aria-hidden />
                </button>
              )}
            </div>
            <Command.List className="ch-search-list">
              {trimmed && results.length === 0 && (
                <div className="ch-search-empty" role="status">
                  <strong>No results</strong>
                  No chats mention “{trimmed}”.
                </div>
              )}
              {!trimmed && chats.length === 0 && (
                <div className="ch-search-empty" role="status">
                  <strong>No chats yet</strong>
                  Your conversations will appear here.
                </div>
              )}
              {groups.map((group) => (
                <Command.Group key={group.label} heading={group.label} className="ch-search-group">
                  {group.items.map((result) => (
                    <Command.Item
                      key={result.id}
                      value={result.id}
                      className="ch-search-item"
                      onSelect={() => {
                        onSelect(result.id);
                        onOpenChange(false);
                      }}
                    >
                      <MessageCircle
                        size={16}
                        strokeWidth={1.5}
                        aria-hidden
                        className="ch-search-item-icon"
                      />
                      <span className="ch-search-item-text">
                        <span className="ch-search-item-title">
                          <Highlight text={result.title} query={trimmed} />
                        </span>
                        {result.snippet && (
                          <span className="ch-search-item-snippet">
                            <Highlight text={result.snippet} query={trimmed} />
                          </span>
                        )}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
