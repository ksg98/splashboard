import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MeterBar } from './Meter';
import { StatCard, StatGrid, STAT_EMPTY_VALUE } from './StatCard';

describe('StatCard', () => {
  it('shows the label, the number with its unit and the footer line', () => {
    render(<StatCard label="Speed" value="92" unit="tok/s" caption="Average over 10 seconds" />);
    const card = screen.getByRole('group', { name: 'Speed' });
    expect(card).toHaveTextContent('92tok/s');
    expect(card).toHaveTextContent('Average over 10 seconds');
  });

  it('sets a percent unit tight against the number', () => {
    render(<StatCard label="Prompt cache" value="87" unit="%" />);
    expect(screen.getByText('%')).toHaveClass('sb-stat__unit--tight');
  });

  it('renders footer graphics before the caption', () => {
    render(
      <StatGrid>
        <StatCard label="Memory" value="31.4" unit="of 48 GB">
          <MeterBar value={0.654} aria-label="GPU memory in use" />
        </StatCard>
      </StatGrid>,
    );
    expect(screen.getByRole('meter', { name: 'GPU memory in use' })).toBeInTheDocument();
  });

  it('shows a quiet dash and no unit while there is no data', () => {
    render(<StatCard label="Speed" value={STAT_EMPTY_VALUE} unit="tok/s" caption="Not running" />);
    const card = screen.getByRole('group', { name: 'Speed' });
    expect(card).not.toHaveTextContent('tok/s');
    expect(card).toHaveTextContent('No data');
    expect(card).toHaveTextContent('Not running');
    expect(card.querySelector('.sb-stat__dash')).toHaveTextContent('—');
  });
});
