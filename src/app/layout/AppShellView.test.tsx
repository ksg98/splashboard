import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppShellView, type AppShellViewProps } from './AppShellView';
import { useShellShortcuts } from './useShellShortcuts';

function renderShell(props: Partial<AppShellViewProps> = {}) {
  const handlers = {
    onToggleSidebar: vi.fn(),
    onNewChat: vi.fn(),
    onSearch: vi.fn(),
    onNavigate: vi.fn(),
  };
  const result = render(
    <AppShellView
      {...handlers}
      sidebarHistory={<p>History slot</p>}
      engineRow={<p>Engine slot</p>}
      toolbar={<p>Toolbar slot</p>}
      toolbarEngine={<p>Engine chip</p>}
      {...props}
    >
      <h1>Page</h1>
    </AppShellView>,
  );
  return { ...handlers, ...result };
}

describe('AppShellView', () => {
  it('renders the nav rows and every slot', () => {
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const name of ['New chat', 'Search chats', 'Activity', 'Models', 'Connect']) {
      expect(within(nav).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('History slot')).toBeInTheDocument();
    expect(screen.getByText('Engine slot')).toBeInTheDocument();
    expect(screen.getByText('Toolbar slot')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Page' })).toBeInTheDocument();
    // The engine chip belongs to the collapsed toolbar only.
    expect(screen.queryByText('Engine chip')).not.toBeInTheDocument();
  });

  it('marks only the current destination, never New chat', () => {
    renderShell({ activeNav: 'models' });
    expect(screen.getByRole('button', { name: 'Models' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'New chat' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Activity' })).not.toHaveAttribute('aria-current');
  });

  it('sends actions out through callbacks', async () => {
    const { onNewChat, onSearch, onNavigate, onToggleSidebar } = renderShell();
    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await userEvent.click(screen.getByRole('button', { name: 'Search chats' }));
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    expect(onNewChat).toHaveBeenCalledOnce();
    expect(onSearch).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith('connect');
    expect(onToggleSidebar).toHaveBeenCalledOnce();
  });

  it('renders destinations as links when given paths', async () => {
    const { onNavigate } = renderShell({ navHrefs: { activity: '/engine' } });
    const link = screen.getByRole('link', { name: 'Activity' });
    expect(link).toHaveAttribute('href', '/engine');
    await userEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('activity');
  });

  it('hides the sidebar from the keyboard when collapsed and moves the controls to the toolbar', async () => {
    const { container, onToggleSidebar, onNewChat } = renderShell({ collapsed: true });
    const aside = container.querySelector('aside');
    expect(aside).toHaveAttribute('inert');
    expect(screen.getByText('Engine chip')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));
    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(onToggleSidebar).toHaveBeenCalledOnce();
    expect(onNewChat).toHaveBeenCalledOnce();
  });

  it('swaps Search chats for a focused field; Esc clears and closes it', async () => {
    function Harness() {
      const [query, setQuery] = useState<string | null>('');
      return (
        <AppShellView
          onToggleSidebar={() => undefined}
          onNewChat={() => undefined}
          onSearch={() => setQuery('')}
          onNavigate={() => undefined}
          search={
            query === null
              ? null
              : { value: query, onChange: setQuery, onClose: () => setQuery(null) }
          }
        />
      );
    }
    render(<Harness />);
    const field = screen.getByRole('searchbox', { name: 'Search chats' });
    expect(field).toHaveFocus();
    await userEvent.type(field, 'Splash');
    expect(field).toHaveValue('Splash');
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
    await userEvent.type(field, 'x');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search chats' })).toBeInTheDocument();
  });
});

describe('useShellShortcuts', () => {
  it('maps ⌘N, ⌘K, ⌘\\, ⌃⌘S, ⌘1–⌘4 and ⌘,', () => {
    const handlers = {
      onNewChat: vi.fn(),
      onSearch: vi.fn(),
      onToggleSidebar: vi.fn(),
      onNavigate: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    function Harness() {
      useShellShortcuts(handlers);
      return null;
    }
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(window, { key: '\\', metaKey: true });
    fireEvent.keyDown(window, { key: 's', metaKey: true, ctrlKey: true });
    fireEvent.keyDown(window, { key: '3', metaKey: true });
    fireEvent.keyDown(window, { key: ',', metaKey: true });
    fireEvent.keyDown(window, { key: 'n' });
    expect(handlers.onNewChat).toHaveBeenCalledOnce();
    expect(handlers.onSearch).toHaveBeenCalledOnce();
    expect(handlers.onToggleSidebar).toHaveBeenCalledTimes(2);
    expect(handlers.onNavigate).toHaveBeenCalledWith('models');
    expect(handlers.onOpenSettings).toHaveBeenCalledOnce();
  });
});
