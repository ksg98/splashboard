import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('announces what is loading', () => {
    render(<Spinner label="Checking for updates" />);
    expect(screen.getByRole('status', { name: 'Checking for updates' })).toBeInTheDocument();
  });

  it('can be decorative', () => {
    render(<Spinner decorative />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
