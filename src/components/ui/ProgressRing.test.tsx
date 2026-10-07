import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProgressRing } from './ProgressRing';

describe('ProgressRing', () => {
  it('reports its value as a percentage', () => {
    render(<ProgressRing value={0.42} label="Downloading Qwen3.6-35B-A3B" />);
    const bar = screen.getByRole('progressbar', { name: 'Downloading Qwen3.6-35B-A3B' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('clamps out-of-range values', () => {
    render(<ProgressRing value={3} label="Installing Splash" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('stops when the ring is pressed', async () => {
    const onCancel = vi.fn();
    render(<ProgressRing value={0.5} label="Downloading Qwen3.6-35B-A3B" onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Stop downloading Qwen3.6-35B-A3B' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
