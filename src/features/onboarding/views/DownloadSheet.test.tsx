import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DownloadSheet, type DownloadSheetProps } from './DownloadSheet';
import {
  DOWNLOAD_CHECKING,
  DOWNLOAD_FAILED,
  DOWNLOAD_LOG,
  DOWNLOAD_LOG_FAILED,
  DOWNLOAD_PAUSED,
  DOWNLOAD_RUNNING,
  QWEN_27B,
} from './fixtures';

function setup(overrides: Partial<DownloadSheetProps> = {}) {
  const handlers = {
    onCancel: vi.fn(),
    onResume: vi.fn(),
    onRetry: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <DownloadSheet
      model={QWEN_27B}
      state={DOWNLOAD_RUNNING}
      log={DOWNLOAD_LOG}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('DownloadSheet', () => {
  it('shows bytes, speed and time left, and Cancel keeps the files', async () => {
    const handlers = setup();
    expect(screen.getByRole('dialog', { name: 'Downloading Qwen3.8-27B' })).toBeInTheDocument();
    expect(screen.getByText('incoai/Qwen3.8-27B-Splash')).toBeInTheDocument();
    expect(screen.getByText('8.6 of 17.6 GB · 52 MB/s · about 3 min')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Downloading Qwen3.8-27B' })).toHaveAttribute(
      'aria-valuenow',
      '48.9',
    );
    expect(screen.getByText(/Cancel keeps what’s downloaded/)).toBeInTheDocument();
    expect(screen.getByText('~/.cache/huggingface/hub')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handlers.onCancel).toHaveBeenCalledOnce();
  });

  it('is indeterminate while checking files', () => {
    setup({ state: DOWNLOAD_CHECKING });
    expect(
      screen.getByRole('progressbar', { name: 'Downloading Qwen3.8-27B' }),
    ).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('Checking what’s already downloaded…')).toBeInTheDocument();
  });

  it('resumes a paused download', async () => {
    const handlers = setup({ state: DOWNLOAD_PAUSED });
    expect(screen.getByRole('dialog', { name: 'Download paused' })).toBeInTheDocument();
    expect(screen.getByText('8.6 of 17.6 GB')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(handlers.onResume).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it('says why a download failed and offers Try again', async () => {
    const handlers = setup({ state: DOWNLOAD_FAILED, log: DOWNLOAD_LOG_FAILED });
    expect(screen.getByRole('alert')).toHaveTextContent('Not enough space on this Mac');
    expect(screen.getByRole('alert')).toHaveTextContent('8.6 of 17.6 GB is kept for next time.');
    expect(screen.getByRole('log', { name: 'Download log' })).toHaveTextContent(
      'No space left on device',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(handlers.onRetry).toHaveBeenCalledOnce();
  });
});
