import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Disclosure } from './Disclosure';
import { FormGroup, FormRow, FormValue } from './Form';

describe('Disclosure', () => {
  it('toggles its panel and its label', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Disclosure label="Show command" openLabel="Hide command" onOpenChange={onOpenChange}>
        <pre>splash serve --port=8000</pre>
      </Disclosure>,
    );
    const button = screen.getByRole('button', { name: 'Show command' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    expect(panel).toHaveAttribute('data-state', 'closed');

    await user.click(button);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Hide command' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(panel).toHaveAttribute('data-state', 'open');
  });

  it('grows a form group as a "More options" row and follows a controlled open prop', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <FormGroup>
        <FormRow label="Record crash traces" control={<FormValue>Off</FormValue>} />
        <Disclosure variant="row" label="More options" open onOpenChange={onOpenChange}>
          <FormRow label="Model revision" control={<FormValue>Latest</FormValue>} />
        </Disclosure>
      </FormGroup>,
    );
    const button = screen.getByRole('button', { name: 'More options' });
    expect(button).toHaveClass('sb-form-more');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Model revision')).toBeInTheDocument();

    await user.click(button);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Controlled: stays open until the parent changes `open`.
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});
