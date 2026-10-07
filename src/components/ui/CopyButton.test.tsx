import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPIED_MS, CopyButton } from './CopyButton';

afterEach(() => {
  vi.useRealTimers();
});

describe('CopyButton', () => {
  it('copies the text, says Copied, and reverts after 1.5 s', async () => {
    vi.useFakeTimers();
    const copy = vi.fn().mockResolvedValue(undefined);
    const onCopied = vi.fn();
    render(
      <CopyButton
        text="http://127.0.0.1:8000/v1"
        label="Copy base URL"
        copy={copy}
        onCopied={onCopied}
      />,
    );
    const button = screen.getByRole('button', { name: 'Copy base URL' });

    await act(async () => {
      fireEvent.click(button);
    });
    expect(copy).toHaveBeenCalledWith('http://127.0.0.1:8000/v1');
    expect(onCopied).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
    expect(button).toHaveAttribute('data-copied', 'true');

    act(() => {
      vi.advanceTimersByTime(COPIED_MS);
    });
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(button).not.toHaveAttribute('data-copied');
  });

  it('uses the clipboard by default and stays quiet when copying fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<CopyButton text="sk-splash-2b9c41e07d5a7f3a" label="Copy API key" showLabel />);
    const button = screen.getByRole('button', { name: /Copy API key/ });

    await act(async () => {
      fireEvent.click(button);
    });
    expect(writeText).toHaveBeenCalledWith('sk-splash-2b9c41e07d5a7f3a');
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(button).toHaveTextContent('Copy API key');
  });
});
