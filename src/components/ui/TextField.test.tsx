import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FormRow } from './Form';
import { TextField } from './TextField';

function Controlled({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <TextField
      aria-label="Hugging Face endpoint"
      placeholder="https://huggingface.co"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      monospace
    />
  );
}

describe('TextField', () => {
  it('reports typed text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const field = screen.getByRole('textbox', { name: 'Hugging Face endpoint' });
    expect(field).toHaveAttribute('placeholder', 'https://huggingface.co');
    await user.type(field, 'hf.co');
    expect(onChange).toHaveBeenLastCalledWith('hf.co');
    expect(field).toHaveValue('hf.co');
  });

  it('takes its name from the row label and is invalid with the row error', () => {
    render(
      <FormRow
        label="Extra host names"
        error="Use letters, numbers, dots and dashes, without spaces."
        control={<TextField value="my mac.local" onChange={() => undefined} />}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Extra host names' });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(
      'Use letters, numbers, dots and dashes, without spaces.',
    );
  });

  it('renders a prefix and suffix inside the field', () => {
    render(
      <TextField
        aria-label="Timeout"
        value="10"
        onChange={() => undefined}
        prefix="≈"
        suffix="s"
      />,
    );
    expect(screen.getByText('≈')).toBeInTheDocument();
    expect(screen.getByText('s')).toBeInTheDocument();
  });
});
