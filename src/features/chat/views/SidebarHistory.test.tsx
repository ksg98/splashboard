import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { historyGroups } from './fixtures';
import { ModelPickerTitle } from './ModelPickerTitle';
import { NewChatEmptyState } from './NewChatEmptyState';
import { SidebarHistory } from './SidebarHistory';
import { pickerModels, suggestions } from './fixtures';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('SidebarHistory', () => {
  it('groups chats and marks only the open conversation as current', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SidebarHistory groups={historyGroups} activeId="c-ttft" onSelect={onSelect} />);
    for (const label of ['Today', 'Yesterday', 'Previous 7 days', 'Older']) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Time to first token in Python' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.click(screen.getByRole('button', { name: 'Compare 27B and 35B-A3B' }));
    expect(onSelect).toHaveBeenCalledWith('c-compare');
  });

  it('selects nothing on a new chat', () => {
    const { container } = render(
      <SidebarHistory groups={historyGroups} activeId={null} onSelect={vi.fn()} />,
    );
    expect(container.querySelector('[aria-current]')).toBeNull();
  });

  it('renames inline from the ⋯ menu and deletes', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    render(
      <SidebarHistory
        groups={historyGroups}
        onSelect={vi.fn()}
        onRename={onRename}
        onDelete={onDelete}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More for Status poller backoff' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const field = await screen.findByRole('textbox', { name: 'Chat name' });
    await user.clear(field);
    await user.type(field, 'Backoff for the status poller{Enter}');
    expect(onRename).toHaveBeenCalledWith('c-backoff', 'Backoff for the status poller');

    await user.click(screen.getByRole('button', { name: 'More for Plan the Models screen' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('c-models');
  });

  it('filters with the search query and says when nothing matches', () => {
    const { rerender } = render(
      <SidebarHistory groups={historyGroups} onSelect={vi.fn()} query="splash" />,
    );
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument();
    const group = screen.getByRole('region', { name: 'Previous 7 days' });
    expect(within(group).getAllByRole('listitem')).toHaveLength(2);
    expect(within(group).getAllByText('Splash')[0]?.tagName).toBe('MARK');

    rerender(<SidebarHistory groups={historyGroups} onSelect={vi.fn()} query="benchmark" />);
    expect(screen.getByRole('status')).toHaveTextContent('No resultsNo chats mention “benchmark”.');
  });
});

describe('ModelPickerTitle', () => {
  it('lists Splash and MLX models with a detail line each and switches', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onManageModels = vi.fn();
    render(
      <ModelPickerTitle
        models={pickerModels}
        value="incoai/Qwen3.8-27B-Splash"
        onChange={onChange}
        onManageModels={onManageModels}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Model: Qwen3.8-27B' }));
    const menu = screen.getByRole('menu', { name: 'Model' });
    expect(menu).toHaveTextContent('Splash package · Ready');
    expect(menu).toHaveTextContent('mlx-community · 15.6 GB');
    expect(menu).toHaveTextContent('Switching models restarts the server.');
    expect(menu.textContent).not.toMatch(/gguf/i);
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Qwen3.8-27B \(MLX 4-bit\)mlx/ }));
    expect(onChange).toHaveBeenCalledWith('mlx-community/Qwen3.8-27B-4bit');
  });
});

describe('NewChatEmptyState', () => {
  it('asks the question, holds the composer and offers suggestions', async () => {
    const user = userEvent.setup();
    const onSelectSuggestion = vi.fn();
    render(
      <NewChatEmptyState
        composer={<textarea aria-label="Message" />}
        suggestions={suggestions}
        onSelectSuggestion={onSelectSuggestion}
      />,
    );
    expect(screen.getByRole('heading', { name: 'What can I help with?' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review a diff' }));
    expect(onSelectSuggestion).toHaveBeenCalledWith(expect.objectContaining({ id: 's-diff' }));
  });
});
