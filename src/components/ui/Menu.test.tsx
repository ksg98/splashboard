import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ContextMenu, Menu, type MenuItem } from './Menu';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('Menu', () => {
  it('lists items with shortcuts, checks, headings and notes, and runs onSelect', async () => {
    const user = userEvent.setup();
    const openActivity = vi.fn();
    const pickModel = vi.fn();
    const items: MenuItem[] = [
      { type: 'heading', label: 'Model' },
      {
        id: 'qwen-27b',
        label: 'Qwen3.8-27B',
        description: 'Splash package · Ready',
        checked: true,
        onSelect: pickModel,
      },
      { id: 'qwen-35b', label: 'Qwen3.6-35B-A3B', checked: false, onSelect: pickModel },
      { type: 'note', label: 'Switching models restarts the server.' },
      { type: 'separator' },
      { id: 'activity', label: 'Open Activity', shortcut: '⌘2', onSelect: openActivity },
      { id: 'gone', label: 'Unavailable', disabled: true, onSelect: vi.fn() },
    ];
    render(
      <Menu aria-label="Engine" items={items} trigger={<button type="button">Open menu</button>} />,
    );

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const menu = screen.getByRole('menu', { name: 'Engine' });
    expect(menu).toHaveTextContent('Switching models restarts the server.');
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('Splash package · Ready')).toBeInTheDocument();

    const checked = screen.getByRole('menuitemcheckbox', { name: /Qwen3.8-27B/ });
    expect(checked).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemcheckbox', { name: /Qwen3.6-35B-A3B/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    const activity = screen.getByRole('menuitem', { name: /Open Activity/ });
    expect(activity).toHaveAttribute('aria-keyshortcuts', 'Meta+2');
    expect(screen.getByRole('menuitem', { name: /Unavailable/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await user.click(activity);
    expect(openActivity).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('ContextMenu', () => {
  it('opens on right-click with destructive items', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <ContextMenu
        aria-label="Conversation"
        items={[
          { id: 'rename', label: 'Rename', onSelect: vi.fn() },
          { type: 'separator' },
          { id: 'delete', label: 'Delete', destructive: true, onSelect: onDelete },
        ]}
      >
        <div>Time to first token in Python</div>
      </ContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText('Time to first token in Python'));
    const remove = screen.getByRole('menuitem', { name: 'Delete' });
    expect(remove).toHaveClass('sb-menu__item--destructive');
    await user.click(remove);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
