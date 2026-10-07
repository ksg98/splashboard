import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Chart, type ChartData } from './Chart';
import { chartSeries, tokensPerSecondMinute } from './renderers.fixtures';

// jsdom has no canvas: replace uPlot with a recorder.
const plots = vi.hoisted(() => [] as FakePlotShape[]);

interface FakePlotShape {
  options: Record<string, unknown>;
  data: unknown;
  setData: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  setCursor: ReturnType<typeof vi.fn>;
  redraw: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  cursor: { idx: number | null };
  fireCursor: (idx: number | null) => void;
}

vi.mock('uplot', () => {
  class FakePlot {
    static pxRatio = 1;
    options: Record<string, unknown>;
    data: unknown;
    width: number;
    height: number;
    cursor = { idx: null as number | null };
    scales = { y: { min: 0, max: 120 } };
    setData = vi.fn((data: unknown) => {
      this.data = data;
    });
    setSize = vi.fn();
    setCursor = vi.fn();
    redraw = vi.fn();
    destroy = vi.fn();
    valToPos = vi.fn(() => 10);
    constructor(
      options: Record<string, unknown> & { width: number; height: number },
      data: unknown,
    ) {
      this.options = options;
      this.data = data;
      this.width = options.width;
      this.height = options.height;
      plots.push(this as unknown as FakePlotShape);
    }
    fireCursor(idx: number | null) {
      this.cursor.idx = idx;
      const hooks = this.options.hooks as { setCursor?: ((u: unknown) => void)[] };
      hooks.setCursor?.forEach((hook) => hook(this));
    }
  }
  return { default: FakePlot };
});

const END = 1_780_000_000;

describe('Chart', () => {
  beforeEach(() => {
    plots.length = 0;
  });

  it('draws one plot with the section label, readout and end labels', () => {
    render(
      <Chart
        title="Tokens per second"
        readout="Last minute"
        data={tokensPerSecondMinute(END)}
        series={chartSeries}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Tokens per second' })).toBeInTheDocument();
    expect(screen.getByText('Last minute')).toBeInTheDocument();
    expect(screen.getByText('1 min ago')).toBeInTheDocument();
    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(
      /^Tokens per second, 1 min ago to now: between 60 and 9\d tok\/s/,
    );
    expect(plots).toHaveLength(1);
    expect(plots[0]?.options.height).toBe(182);
  });

  it('updates the existing plot with new data instead of re-creating it', () => {
    const first = tokensPerSecondMinute(END);
    const { rerender } = render(<Chart data={first} series={chartSeries} />);
    const next: ChartData = tokensPerSecondMinute(END + 1);
    rerender(<Chart data={next} series={chartSeries} />);
    expect(plots).toHaveLength(1);
    expect(plots[0]?.setData).toHaveBeenLastCalledWith(next);
  });

  it('shows the hovered point in the readout', () => {
    render(
      <Chart
        title="Tokens per second"
        readout="Last minute"
        data={tokensPerSecondMinute(END)}
        series={chartSeries}
      />,
    );
    act(() => plots[0]?.fireCursor(35));
    expect(screen.getByText('60 tok/s · 24 s ago')).toBeInTheDocument();
    act(() => plots[0]?.fireCursor(null));
    expect(screen.getByText('Last minute')).toBeInTheDocument();
  });

  it('moves through points with the arrow keys', () => {
    render(<Chart data={tokensPerSecondMinute(END)} series={chartSeries} />);
    const plot = screen.getByRole('img');
    expect(plot).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(plots[0]?.setCursor).toHaveBeenCalled();
  });

  it('draws no line and says why when there is no data', () => {
    render(
      <Chart
        title="Tokens per second"
        data={[[], []]}
        series={chartSeries}
        yMax={120}
        emptyMessage="Start Qwen3.8-27B to see its speed"
      />,
    );
    expect(screen.getByText('Start Qwen3.8-27B to see its speed')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Tokens per second: Start Qwen3.8-27B to see its speed',
    );
    expect(screen.getByRole('img')).not.toHaveAttribute('tabindex');
    const data = plots[0]?.data as (number | null)[][];
    expect(data[1]).toEqual([null, null]);
  });
});
