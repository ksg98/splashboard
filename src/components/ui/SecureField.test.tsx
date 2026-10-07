import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SecureField } from './SecureField';

describe('SecureField', () => {
  it('hides the secret until the eye button is pressed', async () => {
    const user = userEvent.setup();
    render(
      <SecureField
        aria-label="Hugging Face token"
        value="hf_kVq3TzP8mWb1yXcR4nLd7sJa2"
        onChange={() => undefined}
      />,
    );
    const field = screen.getByLabelText('Hugging Face token');
    expect(field).toHaveAttribute('type', 'password');

    const reveal = screen.getByRole('button', { name: 'Show Hugging Face token' });
    expect(reveal).toHaveAttribute('aria-pressed', 'false');
    await user.click(reveal);
    expect(field).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide Hugging Face token' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reports typed text and can omit the reveal button', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SecureField aria-label="API key" value="" onChange={onChange} revealable={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('API key'), 'k');
    expect(onChange).toHaveBeenCalledWith('k');
  });
});
