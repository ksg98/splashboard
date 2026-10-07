import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import * as fx from './fixtures';
import { LogSheet } from './LogSheet';

describe('LogSheet', () => {
  it('shows every line with its time, and filters to errors', async () => {
    const user = userEvent.setup();
    render(<LogSheet open onOpenChange={vi.fn()} lines={fx.log.lines} meta={fx.log.meta} />);
    const sheet = screen.getByRole('dialog', { name: 'Log' });
    expect(within(sheet).getByText(fx.log.meta)).toBeInTheDocument();
    const log = within(sheet).getByRole('log');
    expect(log.children).toHaveLength(fx.log.lines.length);
    expect(log).toHaveTextContent('09:12:01');

    await user.click(within(sheet).getByRole('radio', { name: 'Errors' }));
    expect(within(sheet).getByRole('log').children).toHaveLength(1);
    expect(within(sheet).getByRole('log')).toHaveTextContent('frontend_overloaded');
  });

  it('saves the shown lines as text', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <LogSheet
        open
        onOpenChange={vi.fn()}
        lines={fx.log.lines}
        meta={fx.log.meta}
        onSave={onSave}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Save log…' }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[0]).toMatch(
      /^09:12:01 {2}Splash model incoai\/Qwen3.8-27B-Splash/,
    );
  });
});
