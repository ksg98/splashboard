import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Kbd } from './Kbd';

describe('Kbd', () => {
  it('renders a kbd element', () => {
    render(<Kbd>⌘2</Kbd>);
    const kbd = screen.getByText('⌘2');
    expect(kbd.tagName).toBe('KBD');
    expect(kbd).toHaveClass('sb-kbd');
  });
});
