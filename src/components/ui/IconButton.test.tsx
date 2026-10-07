import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('is named by its label and ghost by default', async () => {
    const onClick = vi.fn();
    render(<IconButton label="Hide sidebar" icon={<svg />} onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Hide sidebar' });
    expect(button).toHaveClass('sb-icon-btn--ghost', 'sb-icon-btn--md');
    expect(button).not.toHaveClass('sb-icon-btn--circle');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('draws the send button as a primary circle', () => {
    render(<IconButton label="Send" icon={<svg />} variant="primary" size="lg" disabled />);
    const button = screen.getByRole('button', { name: 'Send' });
    expect(button).toHaveClass('sb-icon-btn--primary', 'sb-icon-btn--lg', 'sb-icon-btn--circle');
    expect(button).toBeDisabled();
  });

  it('passes pressed state through', () => {
    render(<IconButton label="Show stats" icon={<svg />} size="sm" aria-pressed />);
    expect(screen.getByRole('button', { name: 'Show stats' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
