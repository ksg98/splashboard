import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_MODELS, QWEN_27B, QWEN_35B } from './fixtures';
import { ModelChoice } from './ModelChoice';

function setup(value = QWEN_27B.id) {
  const handlers = { onChange: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn() };
  render(<ModelChoice options={DEMO_MODELS} value={value} memoryGb={64} {...handlers} />);
  return handlers;
}

describe('ModelChoice', () => {
  it('lists Splash packages and MLX 4-bit models as three-line rows', () => {
    setup();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByRole('radio', { name: 'Qwen3.8-27B, Recommended for 64 GB' })).toBeChecked();
    expect(screen.getByText('17.6 GB · 4-bit · Splash package')).toBeInTheDocument();
    expect(screen.getByText('20.4 GB · 4-bit · Splash package')).toBeInTheDocument();
    expect(screen.getAllByText('15.6 GB · 4-bit · MLX')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Download Qwen3.8-27B' })).toBeEnabled();
  });

  it('reports the chosen model and downloads it', async () => {
    const handlers = setup(QWEN_35B.id);
    await userEvent.click(screen.getByRole('radio', { name: 'Qwen3.8-27B MLX 4-bit (LM Studio)' }));
    expect(handlers.onChange).toHaveBeenCalledWith('lmstudio-community/Qwen3.8-27B-MLX-4bit');
    await userEvent.click(screen.getByRole('button', { name: 'Download Qwen3.6-35B-A3B' }));
    expect(handlers.onConfirm).toHaveBeenCalledOnce();
  });

  it('cancels with Esc and with Cancel', async () => {
    const handlers = setup();
    await userEvent.keyboard('{Escape}');
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handlers.onCancel).toHaveBeenCalledTimes(2);
  });
});
