import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Dialog, DialogCloseButton, ScrollEdge } from './Dialog';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('Dialog', () => {
  it('renders a named sheet with a pinned header, scrolling body and footer', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
        title="Launch settings"
        description="Qwen3.8-27B · incoai/Qwen3.8-27B-Splash"
        footerNote="Restart required to apply changes"
        footer={<button type="button">Save and restart</button>}
        width={640}
      >
        <p>Context length 128K</p>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Launch settings' });
    expect(dialog).toHaveAccessibleDescription('Qwen3.8-27B · incoai/Qwen3.8-27B-Splash');
    expect(dialog.style.width).toBe('640px');
    expect(dialog).toHaveFocus();
    expect(screen.getByText('Context length 128K').closest('.sb-scroll-edge')).not.toBeNull();
    expect(screen.getByText('Restart required to apply changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and restart' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on Escape unless it is not dismissible', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Dialog open onOpenChange={onOpenChange} title="Downloading">
        <p>8.6 of 17.6 GB</p>
      </Dialog>,
    );
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    rerender(
      <Dialog open onOpenChange={onOpenChange} title="Downloading" dismissible={false}>
        <p>8.6 of 17.6 GB</p>
      </Dialog>,
    );
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('bare layout keeps the title for screen readers and lets children draw the chrome', () => {
    render(
      <Dialog open onOpenChange={vi.fn()} title="Settings" layout="bare" width={800} height={620}>
        <nav aria-label="Settings sections">
          <DialogCloseButton label="Close settings" />
        </nav>
        <ScrollEdge>
          <h2>General</h2>
        </ScrollEdge>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('marks a scroll edge once its content is scrolled', () => {
    render(
      <ScrollEdge data-testid="body">
        <div>rows</div>
      </ScrollEdge>,
    );
    const body = screen.getByTestId('body');
    expect(body).not.toHaveAttribute('data-edge-above');
    body.scrollTop = 40;
    body.dispatchEvent(new Event('scroll'));
    expect(body).toHaveAttribute('data-edge-above');
  });
});
