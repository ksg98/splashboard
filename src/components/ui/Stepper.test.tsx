import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Stepper } from './Stepper';

describe('Stepper', () => {
  it('is a spinbutton that steps with the arrow keys and buttons', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Stepper aria-label="Port" value={8000} min={1024} max={65535} onChange={onChange} />);
    const field = screen.getByRole('spinbutton', { name: 'Port' });
    expect(field).toHaveValue('8000');
    expect(field).toHaveAttribute('aria-valuenow', '8000');

    fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(8001);

    await user.click(screen.getByRole('button', { name: 'Decrease Port' }));
    expect(onChange).toHaveBeenLastCalledWith(7999);
  });

  it('applies a typed value on blur, clamped to the range', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Stepper
        aria-label="Largest request"
        value={128}
        min={1}
        max={2048}
        unit="MB"
        onChange={onChange}
      />,
    );
    const field = screen.getByRole('spinbutton', { name: 'Largest request' });
    expect(screen.getByText('MB')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, '99999');
    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalledWith(2048);
  });

  it('reverts text that is not a number and disables the arrow at the limit', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Stepper aria-label="Request queue" value={1} min={1} max={1024} onChange={onChange} />);
    const field = screen.getByRole('spinbutton', { name: 'Request queue' });
    await user.clear(field);
    await user.type(field, 'abc');
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
    expect(field).toHaveValue('1');
    expect(screen.getByRole('button', { name: 'Decrease Request queue' })).toBeDisabled();
  });
});
