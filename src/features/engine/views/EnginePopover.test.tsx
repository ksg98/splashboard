import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EnginePopover } from './EnginePopover';
import { EngineStatusRow } from './EngineStatusRow';
import { EngineToolbarChip } from './EngineToolbarChip';
import * as fx from './fixtures';

function handlers() {
  return {
    onRestart: vi.fn(),
    onStop: vi.fn(),
    onStart: vi.fn(),
    onOpenActivity: vi.fn(),
    onOpenLaunchSettings: vi.fn(),
    onOpenModels: vi.fn(),
  };
}

describe('EnginePopover', () => {
  it('shows exactly three numbers with Restart and Stop while thinking', () => {
    render(<EnginePopover {...fx.popover.busy} {...handlers()} />);
    expect(screen.getByText('Splash 1.2.0 · 127.0.0.1:8000 · up 2 h 14 min')).toBeInTheDocument();
    expect(screen.getByText('Speed')).toBeInTheDocument();
    expect(screen.getByText('Drafts accepted')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('offers one Start and no numbers when stopped', async () => {
    const user = userEvent.setup();
    const on = handlers();
    render(<EnginePopover {...fx.popover.stopped} {...on} />);
    expect(screen.getByText('Last ran today at 11:27 · Splash 1.2.0')).toBeInTheDocument();
    expect(screen.queryByText('Speed')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(on.onStart).toHaveBeenCalledOnce();
  });

  it('shows the start phase with a progress line', () => {
    render(<EnginePopover {...fx.popover.starting} {...handlers()} />);
    expect(screen.getByText('Loading weights')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Starting Qwen3.8-27B' })).toBeInTheDocument();
  });

  it('reaches Activity, Models and Launch settings', async () => {
    const user = userEvent.setup();
    const on = handlers();
    render(<EnginePopover {...fx.popover.busy} {...on} />);
    await user.click(screen.getByRole('button', { name: /Open Activity/ }));
    await user.click(screen.getByRole('button', { name: /Open Models/ }));
    await user.click(screen.getByRole('button', { name: 'Launch settings…' }));
    expect(on.onOpenActivity).toHaveBeenCalledOnce();
    expect(on.onOpenModels).toHaveBeenCalledOnce();
    expect(on.onOpenLaunchSettings).toHaveBeenCalledOnce();
    expect(screen.getByText('⌘2')).toBeInTheDocument();
    expect(screen.getByText('⌘3')).toBeInTheDocument();
  });
});

describe('EngineStatusRow', () => {
  it('opens the engine popover and closes it after a page link', async () => {
    const user = userEvent.setup();
    const on = handlers();
    const onOpenSettings = vi.fn();
    render(
      <EngineStatusRow
        model={fx.DEMO_MODEL}
        state={fx.engineState.busy}
        popover={<EnginePopover {...fx.popover.busy} {...on} />}
        onOpenSettings={onOpenSettings}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Qwen3.8-27B, Thinking' }));
    const panel = screen.getByRole('dialog', { name: 'Qwen3.8-27B engine' });
    // Focus goes to the panel, never to Restart, so a second Return does nothing.
    expect(panel).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /Open Activity/ }));
    expect(on.onOpenActivity).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});

describe('EngineToolbarChip', () => {
  it('shows the engine word and opens the same popover', async () => {
    const user = userEvent.setup();
    render(
      <EngineToolbarChip
        model={fx.DEMO_MODEL}
        state={fx.engineState.stopped}
        popover={<EnginePopover {...fx.popover.stopped} {...handlers()} />}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Qwen3.8-27B, Stopped' }));
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });
});
