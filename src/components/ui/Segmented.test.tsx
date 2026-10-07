import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Segmented } from './Segmented';

const options = [
  { value: 'int8', label: 'Compact (8-bit)' },
  { value: 'bf16', label: 'Full (16-bit)' },
] as const;

describe('Segmented', () => {
  it('marks the selected segment and reports a new choice', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Segmented
        aria-label="Working memory precision"
        value="int8"
        options={options}
        onChange={onChange}
      />,
    );
    expect(
      screen.getByRole('radiogroup', { name: 'Working memory precision' }),
    ).toBeInTheDocument();
    const compact = screen.getByRole('radio', { name: 'Compact (8-bit)' });
    const full = screen.getByRole('radio', { name: 'Full (16-bit)' });
    expect(compact).toBeChecked();
    expect(full).not.toBeChecked();

    await user.click(full);
    expect(onChange).toHaveBeenCalledWith('bf16');
  });

  it('keeps the selection when the selected segment is pressed again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Segmented aria-label="Precision" value="int8" options={options} onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Compact (8-bit)' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
