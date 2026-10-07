import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import { Popover } from './Popover';

beforeAll(() => {
  // jsdom has no ResizeObserver; Radix measures the trigger with it.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('Popover', () => {
  it('opens from its trigger, closes on Escape and returns focus', async () => {
    const user = userEvent.setup();
    render(
      <Popover aria-label="Engine" width={300} trigger={<button type="button">Qwen3.8-27B</button>}>
        <p>Splash 1.2.0 · 127.0.0.1:8000</p>
      </Popover>,
    );
    const trigger = screen.getByRole('button', { name: 'Qwen3.8-27B' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(trigger);
    const panel = screen.getByRole('dialog', { name: 'Engine' });
    expect(panel).toHaveTextContent('127.0.0.1:8000');
    expect(panel).toHaveClass('sb-floating');
    expect(panel.style.width).toBe('300px');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('renders open by default for previews', () => {
    render(
      <Popover defaultOpen aria-label="Details" trigger={<button type="button">Info</button>}>
        <p>92 tok/s</p>
      </Popover>,
    );
    expect(screen.getByRole('dialog', { name: 'Details' })).toHaveTextContent('92 tok/s');
  });
});
