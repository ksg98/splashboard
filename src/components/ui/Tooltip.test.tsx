import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { Tooltip, TooltipProvider } from './Tooltip';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('Tooltip', () => {
  it('describes its trigger, with the shortcut after the label', () => {
    render(
      <Tooltip open content="Settings" shortcut="⌘,">
        <button type="button" aria-label="Settings">
          ⚙
        </button>
      </Tooltip>,
    );
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Settings');
    expect(tooltip).toHaveTextContent('⌘,');
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-describedby');
  });

  it('works under a shared provider and renders only the child when disabled', () => {
    render(
      <TooltipProvider>
        <Tooltip open content="Activity" shortcut="⌘2">
          <button type="button">Activity</button>
        </Tooltip>
        <Tooltip disabled content="Hidden">
          <button type="button">Models</button>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('Activity');
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Models' })).not.toHaveAttribute('aria-describedby');
  });
});
