import type { SearchableChat } from './types';

export interface ChatSearchResult {
  id: string;
  title: string;
  group: string;
  /** A short excerpt around the first match in the messages, if the match is there. */
  snippet?: string;
}

/** Characters of context kept before and after the match in a snippet. */
const BEFORE = 36;
const AFTER = 96;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** An excerpt of `text` around the first match of `needle` (lower case), with ellipses. */
export function snippetAround(text: string, needle: string): string | undefined {
  const flat = collapse(text);
  const at = flat.toLowerCase().indexOf(needle);
  if (at === -1) return undefined;
  let start = Math.max(0, at - BEFORE);
  let end = Math.min(flat.length, at + needle.length + AFTER);
  // Start and end on word boundaries when they cut a word.
  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space !== -1 && space < at) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end);
    if (space > at + needle.length) end = space;
  }
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/**
 * Chats whose title or messages contain `query` (case-insensitive), in the
 * order given, each with a snippet from the messages when they match. An empty
 * query returns every chat with no snippet.
 */
export function searchChats(chats: SearchableChat[], query: string): ChatSearchResult[] {
  const needle = collapse(query).toLowerCase();
  const results: ChatSearchResult[] = [];
  for (const chat of chats) {
    if (!needle) {
      results.push({ id: chat.id, title: chat.title, group: chat.group });
      continue;
    }
    const inTitle = chat.title.toLowerCase().includes(needle);
    const snippet = chat.text ? snippetAround(chat.text, needle) : undefined;
    if (inTitle || snippet) results.push({ id: chat.id, title: chat.title, group: chat.group, snippet });
  }
  return results;
}
