import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ConnectView } from './ConnectView';
import {
  agents,
  agentsMixed,
  api,
  apiNoKey,
  engineReady,
  engineStarting,
  engineStopped,
} from './fixtures';
import { maskKey } from './maskKey';

beforeAll(() => {
  // jsdom has no ResizeObserver; the scroll-edge container and Radix use it.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function renderView(overrides: Partial<Parameters<typeof ConnectView>[0]> = {}) {
  const props = {
    engine: engineReady,
    agents,
    api,
    onOpenAgent: vi.fn(),
    onGetAgent: vi.fn(),
    copyText: vi.fn(),
    ...overrides,
  };
  render(<ConnectView {...props} />);
  return props;
}

describe('ConnectView', () => {
  it('lists the five agents with Open, and Hermes as not installed with Get', async () => {
    const props = renderView();
    expect(screen.getByRole('heading', { name: 'Connect' })).toBeInTheDocument();
    expect(
      screen.getByText('Use Qwen3.8-27B from coding agents and other apps on this Mac.'),
    ).toBeInTheDocument();

    const list = screen.getByRole('list', { name: 'Coding agents' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    for (const name of ['Claude Code', 'OpenCode', 'Codex', 'Hermes', 'Pi']) {
      expect(within(list).getByText(name)).toBeInTheDocument();
    }
    expect(screen.getByText('Not installed')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open Claude Code' }));
    expect(props.onOpenAgent).toHaveBeenCalledWith('claude');
    await userEvent.click(screen.getByRole('button', { name: /^Get Hermes/ }));
    expect(props.onGetAgent).toHaveBeenCalledWith('hermes');
    expect(screen.queryByRole('button', { name: 'Open Hermes' })).not.toBeInTheDocument();
  });

  it('says what happens when the server is stopped or starting', () => {
    const { unmount } = render(
      <ConnectView
        engine={engineStopped}
        agents={agents}
        api={api}
        onOpenAgent={vi.fn()}
        onGetAgent={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Qwen3.8-27B isn’t running. Opening an agent starts it first.'),
    ).toBeInTheDocument();
    unmount();
    renderView({ engine: engineStarting });
    expect(
      screen.getByText('Qwen3.8-27B is starting. Agents can connect once it’s ready.'),
    ).toBeInTheDocument();
  });

  it('masks the API key until revealed and copies the real values', async () => {
    const props = renderView();
    expect(screen.getByText(maskKey(api.apiKey!))).toBeInTheDocument();
    expect(screen.queryByText(api.apiKey!)).not.toBeInTheDocument();

    const reveal = screen.getByRole('button', { name: 'Show API key' });
    await userEvent.click(reveal);
    expect(screen.getByText(api.apiKey!)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide API key' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Copy base URL' }));
    expect(props.copyText).toHaveBeenCalledWith('http://127.0.0.1:8000/v1');
    await userEvent.click(screen.getByRole('button', { name: 'Copy API key' }));
    expect(props.copyText).toHaveBeenCalledWith(api.apiKey);
    await userEvent.click(screen.getByRole('button', { name: 'Copy model name' }));
    expect(props.copyText).toHaveBeenCalledWith('incoai/Qwen3.8-27B-Splash');
  });

  it('shows running sessions, agents still being looked for, and a server without a key', () => {
    renderView({ agents: agentsMixed, api: apiNoKey });
    expect(screen.getByRole('button', { name: 'Show Claude Code' })).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Looking for Pi' })).toBeInTheDocument();
    expect(screen.getByText('local')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show API key' })).not.toBeInTheDocument();
  });

  it('never mentions GGUF', () => {
    renderView();
    expect(document.body.textContent).not.toMatch(/gguf/i);
  });
});

describe('maskKey', () => {
  it('keeps the prefix and the last four characters', () => {
    expect(maskKey('sk-splash-2b9c41e07d5a7f3a')).toBe('sk-splash-••••••••••••7f3a');
    expect(maskKey('abcdefghijkl')).toBe('••••••••••••ijkl');
  });
});
