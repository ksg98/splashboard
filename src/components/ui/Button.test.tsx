import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('renders a secondary 28 px pill by default and handles clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Restart</Button>);
    const button = screen.getByRole('button', { name: 'Restart' });
    expect(button).toHaveClass('sb-btn', 'sb-btn--secondary', 'sb-btn--md');
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('applies the variant and size', () => {
    render(
      <Button variant="primary" size="lg">
        Install Splash
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Install Splash' })).toHaveClass(
      'sb-btn--primary',
      'sb-btn--lg',
    );
  });

  it('is busy and disabled while loading, and keeps its name', () => {
    render(
      <Button variant="primary" loading>
        Starting…
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Starting…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps glyphs out of the accessible name and forwards its ref', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} iconEnd={<svg data-testid="arrow" />}>
        Get
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Get' })).toBe(ref.current);
    expect(screen.getByTestId('arrow').parentElement).toHaveAttribute('aria-hidden', 'true');
  });
});
