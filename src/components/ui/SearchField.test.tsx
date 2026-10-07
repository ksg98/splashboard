import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchField } from './SearchField';

describe('SearchField', () => {
  it('shows the shortcut hint while empty', () => {
    render(
      <SearchField
        placeholder="Search Hugging Face"
        value=""
        onChange={() => undefined}
        shortcut="⌘K"
      />,
    );
    const field = screen.getByRole('searchbox', { name: 'Search Hugging Face' });
    expect(field).toHaveAttribute('aria-keyshortcuts', 'Meta+K');
    expect(screen.getByText('⌘K')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  it('clears with the clear button and with Esc', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(
      <SearchField
        placeholder="Search chats"
        value="splash"
        onChange={onChange}
        onClear={onClear}
        shortcut="⌘K"
      />,
    );
    expect(screen.queryByText('⌘K')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(onClear).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(onClear).toHaveBeenCalledTimes(2);
  });

  it('calls onEscape when Esc is pressed on an empty field, and onSubmit on Enter', () => {
    const onEscape = vi.fn();
    const onSubmit = vi.fn();
    render(
      <SearchField value="" onChange={() => undefined} onEscape={onEscape} onSubmit={onSubmit} />,
    );
    const field = screen.getByRole('searchbox', { name: 'Search' });
    fireEvent.keyDown(field, { key: 'Escape' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onEscape).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith('');
  });
});
