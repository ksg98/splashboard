import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { dismissToast, toast, Toaster } from './Toast';

beforeAll(() => {
  // jsdom lacks pointer capture, which the swipe-to-dismiss handlers call.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});

describe('Toast', () => {
  it('shows toasts raised with toast(), with an action and an error tone', async () => {
    const user = userEvent.setup();
    const undo = vi.fn();
    render(<Toaster />);

    let copied = '';
    act(() => {
      copied = toast('Copied to clipboard', { duration: Infinity });
      toast('Chat deleted', { duration: Infinity, action: { label: 'Undo', onClick: undo } });
      toast('Couldn’t reach Splash at 127.0.0.1:8000', { tone: 'error', duration: Infinity });
    });

    expect(screen.getByText('Copied to clipboard')).toBeInTheDocument();
    const error = screen.getByText(/Couldn’t reach Splash/).closest('.sb-toast');
    expect(error).toHaveAttribute('data-tone', 'error');
    expect(error?.querySelector('.sb-toast__dot')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);

    act(() => dismissToast(copied));
    expect(screen.queryByText('Copied to clipboard')).not.toBeInTheDocument();
  });

  it('replaces a toast that reuses an id', () => {
    render(<Toaster />);
    act(() => {
      toast('Downloading 10%', { id: 'download', duration: Infinity });
      toast('Downloading 20%', { id: 'download', duration: Infinity });
    });
    expect(screen.queryByText('Downloading 10%')).not.toBeInTheDocument();
    expect(screen.getByText('Downloading 20%')).toBeInTheDocument();
    act(() => dismissToast('download'));
  });
});
