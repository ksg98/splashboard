import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActivityView, type ActivityViewProps } from './ActivityView';
import * as fx from './fixtures';

// uPlot needs a real canvas; the chart's own tests cover drawing.
vi.mock('@/components/ui/Chart', () => ({
  Chart: ({ title, emptyMessage }: { title?: string; emptyMessage?: string }) => (
    <div data-testid="chart">
      <h2>{title}</h2>
      {emptyMessage ? <p>{emptyMessage}</p> : null}
    </div>
  ),
}));

function renderActivity(props: Partial<ActivityViewProps> = {}) {
  const handlers = { onStart: vi.fn(), onStop: vi.fn(), onRestart: vi.fn() };
  render(
    <ActivityView
      model={fx.DEMO_MODEL}
      status={fx.status.busy}
      stats={fx.stats}
      speed={fx.speedHistory}
      details={fx.details}
      log={fx.log}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('ActivityView', () => {
  it('shows the state line, the four numbers and the chart while thinking', () => {
    renderActivity();
    expect(screen.getByRole('heading', { level: 1, name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Thinking · 1 request · up 2 h 14 min');
    expect(screen.getByRole('group', { name: 'Speed' })).toHaveTextContent('92tok/s');
    expect(screen.getByRole('group', { name: 'Draft acceptance' })).toHaveTextContent(
      '5.6 of 7 kept',
    );
    expect(screen.getByRole('group', { name: 'Memory' })).toHaveTextContent('31.4of 48 GB');
    expect(screen.getByRole('group', { name: 'Prompt cache' })).toHaveTextContent(
      'Reused in the last hour',
    );
    expect(screen.getByRole('heading', { name: 'Tokens per second' })).toBeInTheDocument();
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });

  it('offers Restart and Stop while running', async () => {
    const user = userEvent.setup();
    const handlers = renderActivity();
    await user.click(screen.getByRole('button', { name: 'Restart' }));
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(handlers.onRestart).toHaveBeenCalledOnce();
    expect(handlers.onStop).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
  });

  it('shows dashes that say why when stopped, and one Start', async () => {
    const user = userEvent.setup();
    const handlers = renderActivity({ status: fx.status.stopped, stats: null, speed: null });
    expect(screen.getByRole('status')).toHaveTextContent('Stopped · last ran today at 11:27');
    expect(screen.getAllByText('Not running')).toHaveLength(4);
    expect(screen.getByText('Start Qwen3.8-27B to see its speed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(handlers.onStart).toHaveBeenCalledOnce();
  });

  it('keeps the start progress inside the status line', () => {
    renderActivity({ status: fx.status.starting, stats: null, speed: null });
    const line = screen.getByRole('status');
    expect(line).toHaveTextContent('Starting… · Loading weights · 3 s');
    expect(within(line).getByRole('meter', { name: 'Starting Qwen3.8-27B' })).toBeInTheDocument();
    expect(screen.getAllByText('Starting…', { selector: '.sb-stat__caption' })).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('shows the last lines and a Restart when Splash could not start', () => {
    renderActivity({ status: fx.status.failed, stats: null, speed: null, details: null });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Couldn’t start · another copy of Splash is using port 8000',
    );
    const lines = screen.getByRole('log', { name: 'Last lines from Splash' });
    expect(lines).toHaveTextContent('error: Splash is already serving');
    expect(within(lines).getByRole('img', { name: 'Error' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
  });

  it('says the weights are released when idle', () => {
    renderActivity({
      status: fx.status.idle,
      stats: fx.idleStats,
      speed: fx.idleSpeedHistory,
      details: fx.idleDetails,
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Ready · weights released, reloads on next message',
    );
  });

  it('reveals one column of plain-English details', async () => {
    const user = userEvent.setup();
    renderActivity();
    await user.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const titles = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual([
      'Requests',
      'Speed',
      'Working memory',
      'Prompt cache',
      'Engine',
      'Images',
    ]);
    expect(screen.getByText('1 of 4 at once')).toBeInTheDocument();
    expect(screen.getByText('5.5 of 16 GB')).toBeInTheDocument();
    expect(screen.getByText('Compact (8-bit)')).toBeInTheDocument();
    expect(screen.getByText('128K tokens')).toBeInTheDocument();
    expect(screen.queryByText(/lanes|pages/i)).not.toBeInTheDocument();
  });

  it('opens the log sheet from Show log', async () => {
    const user = userEvent.setup();
    renderActivity({ defaultDetailsOpen: true });
    await user.click(screen.getByRole('button', { name: 'Show log' }));
    const sheet = screen.getByRole('dialog', { name: 'Log' });
    expect(within(sheet).getByRole('log')).toHaveTextContent('Ready · incoai/Qwen3.8-27B-Splash');
  });
});
