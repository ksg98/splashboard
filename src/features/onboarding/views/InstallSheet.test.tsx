import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  INSTALL_FAILED,
  INSTALL_LOG_FAILED,
  INSTALL_LOG_RUNNING,
  INSTALL_NO_HOMEBREW,
  INSTALL_POURING,
  INSTALL_RUNNING,
  INSTALL_SUCCEEDED,
} from './fixtures';
import { InstallSheet, type InstallSheetProps } from './InstallSheet';

function setup(overrides: Partial<InstallSheetProps> = {}) {
  const handlers = {
    onCancel: vi.fn(),
    onRetry: vi.fn(),
    onContinue: vi.fn(),
    onOpenTerminal: vi.fn(),
    onOpenHomebrewSite: vi.fn(),
  };
  render(
    <InstallSheet state={INSTALL_RUNNING} log={INSTALL_LOG_RUNNING} {...handlers} {...overrides} />,
  );
  return handlers;
}

describe('InstallSheet', () => {
  it('shows brew progress, time left, the command and a closed log', async () => {
    const handlers = setup();
    expect(screen.getByRole('dialog', { name: 'Installing Splash' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('Downloading Splash 1.2.0')).toBeInTheDocument();
    expect(screen.getByText('214 of 418 MB')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Installing Splash' })).toHaveAttribute(
      'aria-valuenow',
      '51.2',
    );
    expect(screen.getByText('About 30 seconds left')).toBeInTheDocument();
    expect(screen.getByText('brew install incoai/tap/splash')).toBeInTheDocument();

    const details = screen.getByRole('button', { name: 'Show details' });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(details);
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('log', { name: 'Install log' })).toHaveTextContent(
      '==> Tapping incoai/tap',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handlers.onCancel).toHaveBeenCalledOnce();
  });

  it('shows an indeterminate bar while a phase has no measure', () => {
    setup({ state: INSTALL_POURING });
    const bar = screen.getByRole('progressbar', { name: 'Installing Splash' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('Installing')).toBeInTheDocument();
  });

  it('on failure says why, opens the log with Copy log and offers Try again', async () => {
    const handlers = setup({ state: INSTALL_FAILED, log: INSTALL_LOG_FAILED });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The download from GitHub was interrupted.',
    );
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Copy log' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(handlers.onRetry).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(handlers.onCancel).toHaveBeenCalledOnce();
  });

  it('offers the built-in terminal when Homebrew is missing', async () => {
    const handlers = setup({ state: INSTALL_NO_HOMEBREW, log: [] });
    expect(screen.getByRole('dialog', { name: 'Homebrew isn’t installed' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy Homebrew install command' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Install in terminal' }));
    expect(handlers.onOpenTerminal).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'brew.sh' }));
    expect(handlers.onOpenHomebrewSite).toHaveBeenCalledOnce();
  });

  it('continues to step 2 once installed', async () => {
    const handlers = setup({ state: INSTALL_SUCCEEDED });
    expect(screen.getByText(/Splash 1\.2\.0 is installed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(handlers.onContinue).toHaveBeenCalledOnce();
  });
});
