import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { claudeTranscript, terminal } from './fixtures';
import { TerminalSheet, type TerminalSheetProps } from './TerminalSheet';
import { TerminalTranscript } from './TerminalTranscript';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function renderSheet(overrides: Partial<TerminalSheetProps> = {}) {
  const props: TerminalSheetProps = {
    open: true,
    ...terminal,
    status: 'running',
    onHide: vi.fn(),
    onEndSession: vi.fn(),
    onOpenInTerminal: vi.fn(),
    onChangeFolder: vi.fn(),
    ...overrides,
  };
  const result = render(<TerminalSheet {...props} />);
  return { props, ...result };
}

describe('TerminalSheet', () => {
  it('attaches the terminal to its host element and cleans up on close', () => {
    const cleanup = vi.fn();
    const mount = vi.fn((_element: HTMLElement) => cleanup);
    const { unmount } = renderSheet({ mount });
    expect(mount).toHaveBeenCalledTimes(1);
    const host = mount.mock.calls[0]?.[0];
    expect(host).toBeInstanceOf(HTMLElement);
    expect(host).toHaveAttribute('data-terminal-host');
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('is named for the agent and folder, and Hide or Esc keeps the session', async () => {
    const { props } = renderSheet({
      transcript: <TerminalTranscript lines={claudeTranscript} />,
    });
    expect(
      screen.getByRole('dialog', { name: 'Claude Code — ~/Projects/splashboard' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Claude Code terminal' })).toHaveTextContent(
      'All 148 tests pass.',
    );
    expect(screen.getByText('Qwen3.8-27B on port 8000')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(props.onHide).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(props.onHide).toHaveBeenCalledTimes(2);
    expect(props.onEndSession).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(props.onEndSession).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /^Working folder/ }));
    expect(props.onChangeFolder).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Open in Terminal' }));
    expect(props.onOpenInTerminal).toHaveBeenCalledTimes(1);
  });

  it('offers Close and Start again once the agent has ended', async () => {
    const onRestart = vi.fn();
    const { props } = renderSheet({ status: 'exited', exitCode: 0, onRestart });
    expect(screen.getByText('Claude Code ended · exit code 0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End session' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onHide).toHaveBeenCalledTimes(1);
  });

  it('says the server is starting first', () => {
    renderSheet({ status: 'starting', startingDetail: 'Loading weights · 3 s' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Starting Qwen3.8-27B · Loading weights · 3 s · Claude Code opens when it’s ready',
    );
  });
});
