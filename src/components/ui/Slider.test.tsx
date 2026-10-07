import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Slider } from './Slider';

beforeAll(() => {
  // Radix measures the thumb; jsdom has no ResizeObserver.
  if (!('ResizeObserver' in globalThis)) {
    class NoopResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: NoopResizeObserver,
      configurable: true,
      writable: true,
    });
  }
});

describe('Slider', () => {
  it('names the thumb, shows the formatted value and steps with the keyboard', () => {
    const onChange = vi.fn();
    render(
      <Slider
        aria-label="Context length"
        value={128}
        min={8}
        max={256}
        step={8}
        onChange={onChange}
        formatValue={(value) => `${value}K`}
      />,
    );
    const thumb = screen.getByRole('slider', { name: 'Context length' });
    expect(thumb).toHaveAttribute('aria-valuenow', '128');
    expect(thumb).toHaveAttribute('aria-valuetext', '128K');
    expect(screen.getByText('128K')).toBeInTheDocument();

    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(136);
  });

  it('draws named ends and ticks instead of a number', () => {
    const { container } = render(
      <Slider
        aria-label="Reply share during long prompts"
        value={2}
        min={0}
        max={4}
        step={1}
        onChange={() => undefined}
        formatValue={(value) =>
          ['Long prompt first', 'b', 'Balanced', 'd', 'Replies first'][value] ?? ''
        }
        ends={['Long prompt first', 'Replies first']}
      />,
    );
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Balanced');
    expect(screen.getByText('Long prompt first')).toBeInTheDocument();
    expect(screen.getByText('Replies first')).toBeInTheDocument();
    expect(container.querySelectorAll('.sb-slider__ticks > i')).toHaveLength(5);
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });
});
