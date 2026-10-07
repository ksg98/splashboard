import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { searchableChats } from './fixtures';
import { searchChats, snippetAround } from './search';
import { SearchChats } from './SearchChats';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

function Harness({ initial = '', onSelect = vi.fn() }: { initial?: string; onSelect?: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState(initial);
  return (
    <SearchChats
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      chats={searchableChats}
      onSelect={onSelect}
    />
  );
}

describe('searchChats', () => {
  it('matches titles and message text, with a snippet around the match', () => {
    const results = searchChats(searchableChats, 'splash');
    expect(results.map((result) => result.id)).toEqual(['c-ttft', 'c-notes', 'c-regex', 'c-mlx']);
    expect(results[0]?.snippet).toContain('Splash answers 503');
    expect(results[0]?.snippet?.startsWith('…')).toBe(true);
    expect(searchChats(searchableChats, '')).toHaveLength(searchableChats.length);
    expect(searchChats(searchableChats, 'benchmark')).toEqual([]);
  });

  it('cuts snippets on word boundaries', () => {
    expect(snippetAround('alpha beta gamma', 'beta')).toBe('alpha beta gamma');
    expect(snippetAround('nothing here', 'beta')).toBeUndefined();
  });
});

describe('SearchChats', () => {
  // TODO: cmdk hides its options from jsdom's accessibility tree (no layout); verify in a browser.
  it.skip('shows results under their group labels with the match in semibold', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness initial="Splash" onSelect={onSelect} />);
    const dialog = screen.getByRole('dialog', { name: 'Search chats' });
    expect(dialog).toHaveTextContent('Previous 7 days');
    expect(screen.getAllByText('Splash').some((node) => node.tagName === 'MARK')).toBe(true);
    await user.click(screen.getByRole('option', { name: /Regex for Splash log lines/ }));
    expect(onSelect).toHaveBeenCalledWith('c-regex');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says when nothing matches and clears with the clear button', async () => {
    const user = userEvent.setup();
    render(<Harness initial="benchmark" />);
    expect(screen.getByText('No chats mention “benchmark”.', { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.getByRole('option', { name: /Time to first token in Python/ })).toBeInTheDocument();
  });

  it('clears and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness initial="Splash" />);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
