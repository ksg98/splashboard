import clsx from 'clsx';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import './Chart.css';

/** uPlot AlignedData: x values (unix seconds) first, then one array per series (null = gap). */
export type ChartData = [number[], ...(number | null)[][]];

export interface ChartSeries {
  label: string;
  unit?: string;
}

export interface ChartProps {
  data: ChartData;
  series: ChartSeries[];
  /** Bottom of the y scale (default 0). */
  yMin?: number;
  /** Top of the y scale. Omitted: a round number above the data, split into three steps (0, 40, 80, 120). */
  yMax?: number;
  /** Total height in px, start/end labels included (default 200). */
  height?: number;
  /** Labels under the left and right ends (default "1 min ago" / "Now"). */
  xLabels?: [string, string];
  /** Shows exactly this many seconds ending at the last point, so a short history starts mid-chart. */
  xWindow?: number;
  /** Section label above the plot ("Tokens per second"). */
  title?: string;
  /** Right of the title while not hovering ("Last minute"). Hovering shows the point instead. */
  readout?: string;
  /** No line; this sentence sits in the middle ("Start Qwen3.8-27B to see its speed"). */
  emptyMessage?: string;
  /** Text alternative; defaults to a summary of the range shown. */
  'aria-label'?: string;
  /** Formats y labels and the hover readout (default: rounded, up to 1 decimal under 10). */
  formatValue?: (value: number) => string;
  className?: string;
}

const AXIS_WIDTH = 34;
const AXIS_GAP = 10;
const X_LABELS_HEIGHT = 18;
const PAD_TOP = 8;
const PAD_BOTTOM = 6;
const STEPS = 3;

interface Colors {
  line: string;
  grid: string;
  base: string;
  axis: string;
  surface: string;
}

interface LiveProps {
  yMin: number;
  yMax: number | undefined;
  xWindow: number | undefined;
  empty: boolean;
}

function defaultFormat(value: number): string {
  if (Math.abs(value) >= 10 || Number.isInteger(value)) return Math.round(value).toString();
  return (Math.round(value * 10) / 10).toString();
}

function tickFormat(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** Smallest of 1, 2, 2.5, 4, 5 × 10^k that is at least `raw`. */
function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const base = 10 ** Math.floor(Math.log10(raw));
  for (const multiple of [1, 2, 2.5, 4, 5, 10]) {
    if (multiple * base >= raw - 1e-9) return multiple * base;
  }
  return 10 * base;
}

function yRange(dataMax: number | null, live: LiveProps): uPlot.Range.MinMax {
  const low = live.yMin;
  if (live.yMax !== undefined && live.yMax > low) return [low, live.yMax];
  const top = dataMax !== null && Number.isFinite(dataMax) && !live.empty ? dataMax : low + 100;
  const step = niceStep((top - low) / STEPS);
  return [low, low + step * STEPS];
}

function xRange(
  min: number | null,
  max: number | null,
  xWindow: number | undefined,
): uPlot.Range.MinMax {
  if (max === null || !Number.isFinite(max)) return [0, 1];
  if (xWindow !== undefined && xWindow > 0) return [max - xWindow, max];
  if (min === null || min === max) return [max - 1, max];
  return [min, max];
}

function ySplits(u: uPlot): number[] {
  const low = u.scales.y?.min ?? 0;
  const high = u.scales.y?.max ?? 1;
  const step = (high - low) / STEPS;
  return Array.from({ length: STEPS + 1 }, (_, index) => low + step * index);
}

function hasValues(data: ChartData): boolean {
  return data.slice(1).some((values) => values.some((value) => value !== null));
}

function emptyData(seriesCount: number): uPlot.AlignedData {
  return [[0, 1], ...Array.from({ length: seriesCount }, () => [null, null])] as uPlot.AlignedData;
}

function agoLabel(seconds: number): string {
  if (seconds < 0.5) return 'now';
  if (seconds < 120) return `${Math.round(seconds)} s ago`;
  return `${Math.round(seconds / 60)} min ago`;
}

/** Resolves the token colours to rgb() through a hidden probe; canvases cannot read var(). */
function resolveColors(probe: HTMLElement): Colors {
  const read = (name: string): string => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color || 'currentColor';
  };
  return {
    line: read('--sb-chart-line'),
    grid: read('--sb-chart-grid-line'),
    base: read('--sb-chart-base-line'),
    axis: read('--sb-chart-axis'),
    surface: read('--sb-chart-surface'),
  };
}

/** Bumps whenever the app theme or the system appearance changes. */
function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(bump) : null;
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    const query =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    query?.addEventListener('change', bump);
    return () => {
      observer?.disconnect();
      query?.removeEventListener('change', bump);
    };
  }, []);
  return version;
}

/**
 * A live line chart on uPlot, styled like the Activity "Tokens per second"
 * chart. New data updates the existing plot (no re-creation); it follows its
 * container's width and the app theme. Hover, or focus and use the arrow
 * keys, to read a point.
 */
export function Chart({
  data,
  series,
  yMin = 0,
  yMax,
  height = 200,
  xLabels = ['1 min ago', 'Now'],
  xWindow,
  title,
  readout,
  emptyMessage,
  'aria-label': ariaLabel,
  formatValue = defaultFormat,
  className,
}: ChartProps) {
  const titleId = useId();
  const canvasRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const colorsRef = useRef<Colors>({ line: '', grid: '', base: '', axis: '', surface: '' });
  const empty = emptyMessage !== undefined || !hasValues(data);
  const liveRef = useRef<LiveProps>({ yMin, yMax, xWindow, empty });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const themeVersion = useThemeVersion();
  const plotHeight = Math.max(40, height - X_LABELS_HEIGHT);
  const seriesCount = Math.max(1, series.length);
  const plotData = useMemo(
    () => (empty ? emptyData(seriesCount) : (data as uPlot.AlignedData)),
    [data, empty, seriesCount],
  );
  const initial = useRef({ plotData, plotHeight, series });

  // Keep what the plot's callbacks read in step with the props (runs before the data effect).
  useEffect(() => {
    liveRef.current = { yMin, yMax, xWindow, empty };
    initial.current = { plotData, plotHeight, series };
  });

  // Create the plot once per series count; everything else updates it in place.
  useEffect(() => {
    const host = canvasRef.current;
    const probe = probeRef.current;
    if (!host || !probe) return undefined;
    colorsRef.current = resolveColors(probe);
    const color = (key: keyof Colors) => () => colorsRef.current[key];
    const font = `11px ${getComputedStyle(host).fontFamily || 'system-ui, sans-serif'}`;
    const isLow = (u: uPlot, value: number) => Math.abs(value - (u.scales.y?.min ?? 0)) < 1e-9;
    const { plotData: firstData, plotHeight: firstHeight, series: firstSeries } = initial.current;

    const drawEndDot = (u: uPlot) => {
      if (liveRef.current.empty) return;
      const xs = u.data[0];
      const ys = u.data[1];
      if (!ys) return;
      for (let index = ys.length - 1; index >= 0; index -= 1) {
        const value = ys[index];
        const x = xs[index];
        if (value === null || value === undefined || x === undefined) continue;
        const ctx = u.ctx;
        ctx.save();
        ctx.fillStyle = colorsRef.current.line;
        ctx.beginPath();
        ctx.arc(
          u.valToPos(x, 'x', true),
          u.valToPos(value, 'y', true),
          3.5 * uPlot.pxRatio,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.restore();
        return;
      }
    };

    const options: uPlot.Options = {
      width: Math.max(1, Math.floor(host.clientWidth)),
      height: firstHeight,
      padding: [PAD_TOP, 0, PAD_BOTTOM, 0],
      legend: { show: false },
      select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      cursor: {
        x: true,
        y: false,
        drag: { x: false, y: false, setScale: false },
        points: { size: 8, width: 2, fill: color('surface'), stroke: color('line') },
      },
      scales: {
        x: { time: false, range: (_u, min, max) => xRange(min, max, liveRef.current.xWindow) },
        y: { range: (_u, _min, max) => yRange(max, liveRef.current) },
      },
      axes: [
        { show: false },
        {
          scale: 'y',
          side: 1,
          size: AXIS_WIDTH,
          gap: AXIS_GAP,
          align: 1,
          font,
          stroke: color('axis'),
          ticks: { show: false },
          border: { show: false },
          splits: ySplits,
          values: (_u, splits) => splits.map((value) => tickFormat(value)),
          grid: {
            stroke: color('grid'),
            width: 1,
            filter: (u, splits) => splits.map((value) => (isLow(u, value) ? null : value)),
          },
        },
        {
          // Draws only the zero baseline, a step darker than the gridlines.
          scale: 'y',
          side: 1,
          size: 0,
          gap: 0,
          ticks: { show: false },
          border: { show: false },
          splits: ySplits,
          values: (_u, splits) => splits.map(() => null),
          grid: {
            stroke: color('base'),
            width: 1,
            filter: (u, splits) => splits.map((value) => (isLow(u, value) ? value : null)),
          },
        },
      ],
      series: [
        {},
        ...Array.from({ length: Math.max(1, firstSeries.length) }, (_, index) => ({
          label: firstSeries[index]?.label ?? `Series ${index + 1}`,
          stroke: color(index === 0 ? 'line' : 'axis'),
          width: 2,
          spanGaps: false,
          points: { show: false },
        })),
      ],
      hooks: {
        setCursor: [(u) => setHoverIdx(u.cursor.idx ?? null)],
        draw: [drawEndDot],
      },
    };

    const plot = new uPlot(options, firstData, host);
    plotRef.current = plot;

    const resize =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver((entries) => {
            const width = Math.floor(entries[0]?.contentRect.width ?? 0);
            if (width > 0 && width !== plot.width) plot.setSize({ width, height: plot.height });
          })
        : null;
    resize?.observe(host);

    return () => {
      resize?.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [seriesCount]);

  // Live data: update the existing plot.
  useEffect(() => {
    plotRef.current?.setData(plotData);
  }, [plotData, yMin, yMax, xWindow]);

  useEffect(() => {
    const plot = plotRef.current;
    if (plot && plot.height !== plotHeight) plot.setSize({ width: plot.width, height: plotHeight });
  }, [plotHeight]);

  // Theme switch: re-read the colours and repaint.
  useEffect(() => {
    if (themeVersion === 0 || !probeRef.current) return;
    colorsRef.current = resolveColors(probeRef.current);
    plotRef.current?.redraw(true, true);
  }, [themeVersion]);

  const xs = data[0];
  const ys = data[1] ?? [];
  const unit = series[0]?.unit;
  const hovered =
    !empty && hoverIdx !== null && hoverIdx < xs.length ? (ys[hoverIdx] ?? null) : null;
  const lastX = xs[xs.length - 1];
  const hoverX = hoverIdx !== null ? xs[hoverIdx] : undefined;
  const readoutText =
    hovered !== null && lastX !== undefined && hoverX !== undefined
      ? `${formatValue(hovered)}${unit ? ` ${unit}` : ''} · ${agoLabel(lastX - hoverX)}`
      : readout;

  const summary = (() => {
    const name = title ?? series[0]?.label ?? 'Chart';
    if (empty) return `${name}: ${emptyMessage ?? 'no data yet'}`;
    const values = ys.filter((value): value is number => value !== null);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const last = values[values.length - 1] ?? high;
    const suffix = unit ? ` ${unit}` : '';
    return `${name}, ${xLabels[0]} to ${xLabels[1].toLowerCase()}: between ${formatValue(low)} and ${formatValue(high)}${suffix}, now ${formatValue(last)}${suffix}`;
  })();

  const moveCursor = (index: number) => {
    const plot = plotRef.current;
    const x = xs[index];
    if (!plot || x === undefined) return;
    const y = ys[index];
    plot.setCursor({
      left: plot.valToPos(x, 'x'),
      top: y === null || y === undefined ? 0 : plot.valToPos(y, 'y'),
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (empty || xs.length === 0) return;
    const current = hoverIdx ?? xs.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
        next = Math.max(0, current - 1);
        break;
      case 'ArrowRight':
        next = Math.min(xs.length - 1, current + 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = xs.length - 1;
        break;
      case 'Escape':
        plotRef.current?.setCursor({ left: -10, top: -10 });
        return;
      default:
        return;
    }
    event.preventDefault();
    moveCursor(next);
  };

  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (empty || xs.length === 0 || !event.currentTarget.matches(':focus-visible')) return;
    setKeyboardFocus(true);
    moveCursor(xs.length - 1);
  };

  const handleBlur = () => {
    setKeyboardFocus(false);
    plotRef.current?.setCursor({ left: -10, top: -10 });
  };

  const Root = title ? 'section' : 'div';

  return (
    <Root className={clsx('sb-chart', className)} aria-labelledby={title ? titleId : undefined}>
      <span ref={probeRef} className="sb-chart__probe" aria-hidden="true" />
      {title || readoutText ? (
        <div className="sb-chart__head">
          {title ? (
            <h2 className="sb-chart__title" id={titleId}>
              {title}
            </h2>
          ) : (
            <span />
          )}
          {readoutText ? (
            <span className="sb-chart__readout" aria-live={keyboardFocus ? 'polite' : 'off'}>
              {readoutText}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className="sb-chart__plot"
        role="img"
        aria-label={ariaLabel ?? summary}
        tabIndex={empty ? undefined : 0}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={{ height: plotHeight }}
      >
        <div ref={canvasRef} />
        {emptyMessage ? (
          <p className="sb-chart__empty" aria-hidden="true">
            {emptyMessage}
          </p>
        ) : null}
      </div>
      <div className="sb-chart__x" aria-hidden="true">
        <span>{xLabels[0]}</span>
        <span>{xLabels[1]}</span>
      </div>
    </Root>
  );
}
