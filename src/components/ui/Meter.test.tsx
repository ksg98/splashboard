import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DotsMeter, MeterBar } from './Meter';

describe('MeterBar', () => {
  it('exposes the value as a labelled meter and fills to the fraction', () => {
    render(<MeterBar value={31.4 / 48} aria-label="GPU memory in use" valueText="31.4 of 48 GB" />);
    const meter = screen.getByRole('meter', { name: 'GPU memory in use' });
    expect(meter).toHaveAttribute('aria-valuenow', '65.4');
    expect(meter).toHaveAttribute('aria-valuetext', '31.4 of 48 GB');
    expect(meter.firstElementChild).toHaveStyle({ width: '65.4%' });
  });

  it('clamps out-of-range values', () => {
    render(<MeterBar value={1.7} aria-label="Download progress" size="lg" />);
    const meter = screen.getByRole('meter', { name: 'Download progress' });
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '100%');
    expect(meter).toHaveClass('sb-meter--lg');
  });
});

describe('DotsMeter', () => {
  it('shows 5.6 of 7 as five full dots, one half-tone and one empty', () => {
    render(<DotsMeter filled={5.6} total={7} aria-label="Draft tokens kept" />);
    const meter = screen.getByRole('meter', { name: 'Draft tokens kept' });
    expect(meter).toHaveAttribute('aria-valuetext', '5.6 of 7');
    const states = Array.from(meter.children).map((dot) => dot.getAttribute('data-state'));
    expect(states).toEqual(['on', 'on', 'on', 'on', 'on', 'part', 'off']);
  });

  it('rounds to the nearest half dot', () => {
    render(<DotsMeter filled={5.8} total={7} aria-label="Kept" />);
    const states = Array.from(screen.getByRole('meter').children).map((dot) =>
      dot.getAttribute('data-state'),
    );
    expect(states).toEqual(['on', 'on', 'on', 'on', 'on', 'on', 'off']);
  });
});
