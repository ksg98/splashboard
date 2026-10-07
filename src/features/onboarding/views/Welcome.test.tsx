import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  DEMO_ADDRESS,
  DEMO_MAC,
  DEMO_MAC_TOO_OLD,
  DEMO_PARTIAL_DOWNLOAD,
  DEMO_START_PROGRESS,
  QWEN_27B,
  QWEN_35B,
  QWEN_27B_MLX,
  SPLASH_VERSION,
} from './fixtures';
import { Welcome, type WelcomeProps } from './Welcome';

function setup(overrides: Partial<WelcomeProps> = {}) {
  const handlers = {
    onInstall: vi.fn(),
    onDownload: vi.fn(),
    onChooseModel: vi.fn(),
    onStart: vi.fn(),
    onOpenChat: vi.fn(),
  };
  render(
    <Welcome
      step="install"
      model={QWEN_27B}
      mac={DEMO_MAC}
      splashVersion={SPLASH_VERSION}
      address={DEMO_ADDRESS}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

function stepItems() {
  return within(screen.getByRole('list', { name: 'Setup' })).getAllByRole('listitem');
}

describe('Welcome', () => {
  it('shows the three steps with step 1 current and one primary button', async () => {
    const handlers = setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to Splashboard' })).toBeVisible();
    const items = stepItems();
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveTextContent('Install Splash');
    expect(items[1]).toHaveTextContent('Download Qwen3.8-27B');
    expect(items[1]).toHaveTextContent('17.6 GB. Recommended for this Mac’s 64 GB of memory.');
    expect(items[2]).toHaveTextContent('Start');
    expect(
      screen.getByText('This Mac is ready: MacBook Pro, M3 Max, 64 GB, macOS 26.4'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Install Splash' }));
    expect(handlers.onInstall).toHaveBeenCalledOnce();
  });

  it('marks finished steps done and names the next action on the button', async () => {
    const handlers = setup({ step: 'download' });
    const items = stepItems();
    expect(items[0]).toHaveTextContent('Splash 1.2.0 is installed.');
    expect(items[1]).toHaveAttribute('aria-current', 'step');

    await userEvent.click(screen.getByRole('button', { name: 'Download Qwen3.8-27B' }));
    expect(handlers.onDownload).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Change model' }));
    expect(handlers.onChooseModel).toHaveBeenCalledOnce();
  });

  it('describes a chosen model that is not the recommended one', () => {
    setup({ step: 'download', model: QWEN_27B_MLX });
    expect(stepItems()[1]).toHaveTextContent('15.6 GB. MLX 4-bit, from mlx-community.');
    setup({ step: 'download', model: QWEN_35B });
    expect(screen.getAllByText('Download Qwen3.6-35B-A3B')[0]).toBeInTheDocument();
  });

  it('offers Resume download after a cancelled download', () => {
    setup({ step: 'download', partialDownload: DEMO_PARTIAL_DOWNLOAD });
    expect(screen.getByRole('button', { name: 'Resume download' })).toBeEnabled();
    expect(stepItems()[1]).toHaveTextContent('Paused at 8.6 of 17.6 GB.');
  });

  it('shows start progress in place and disables the button while starting', () => {
    setup({ step: 'start', starting: DEMO_START_PROGRESS });
    const bar = screen.getByRole('progressbar', { name: 'Starting Qwen3.8-27B' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText('Loading weights · 12 s')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Change model' })).not.toBeInTheDocument();
  });

  it('hands off to chat when ready', async () => {
    const handlers = setup({ step: 'done' });
    for (const item of stepItems()) expect(item).not.toHaveAttribute('aria-current');
    expect(stepItems()[2]).toHaveTextContent('Running at 127.0.0.1:8000.');
    await userEvent.click(screen.getByRole('button', { name: 'Start chatting' }));
    expect(handlers.onOpenChat).toHaveBeenCalledOnce();
  });

  it('keeps the welcome visible but inert under a sheet', () => {
    setup({
      sheet: (
        <div role="dialog" aria-label="Installing Splash">
          sheet
        </div>
      ),
    });
    const title = screen.getByRole('heading', { level: 1, hidden: true });
    expect(title).toHaveTextContent('Welcome to Splashboard');
    expect(title.closest('section')).toHaveAttribute('inert');
    expect(screen.getByRole('dialog', { name: 'Installing Splash' })).toBeInTheDocument();
  });

  it('says why when this Mac cannot run Splash', () => {
    setup({ mac: DEMO_MAC_TOO_OLD });
    expect(screen.getByRole('alert')).toHaveTextContent('Splash needs macOS 26.4 or newer.');
    expect(screen.getByRole('button', { name: 'Install Splash' })).toBeDisabled();
  });
});
