import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusDot } from './StatusDot';

describe('StatusDot', () => {
  it('draws the label next to the dot', () => {
    render(<StatusDot tone="ok" label="Ready" />);
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('hides a bare dot from assistive tech and pulses only when busy', () => {
    const { container, rerender } = render(<StatusDot tone="busy" />);
    const dot = container.querySelector('.sb-dot');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot).toHaveClass('sb-dot--busy', 'is-pulsing');
    rerender(<StatusDot tone="off" />);
    expect(container.querySelector('.sb-dot')).not.toHaveClass('is-pulsing');
  });
});
