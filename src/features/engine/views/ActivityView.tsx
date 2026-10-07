import { clsx } from 'clsx';
import { useState, type UIEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Chart, type ChartData } from '@/components/ui/Chart';
import { Disclosure } from '@/components/ui/Disclosure';
import { DotsMeter, MeterBar } from '@/components/ui/Meter';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { ActivityDetailsList } from './ActivityDetailsList';
import { LogLines } from './LogLines';
import { LogSheet } from './LogSheet';
import type {
  ActivityDetails,
  ActivityStats,
  ActivityStatus,
  LogSource,
  SpeedHistory,
} from './types';
import { useControllable } from './useControllable';
import {
  DASH,
  chartMax,
  gbOf,
  isLive,
  oneDecimal,
  percentNumber,
  plural,
  stateLabel,
  wholeNumber,
} from './wording';
import './ActivityView.css';

/** Plot height, x labels included; the failure lines take exactly this much too. */
const CHART_HEIGHT = 200;

export interface ActivityViewProps {
  /** Display name of the model the server runs: "Qwen3.8-27B". */
  model: string;
  status: ActivityStatus;
  /** The four summary cards; ignored unless the server is running. */
  stats: ActivityStats | null;
  /** Tokens per second for the last minute; ignored unless the server is running. */
  speed: SpeedHistory | null;
  /** "Show details"; null when there is nothing to show (server off). */
  details: ActivityDetails | null;
  log: LogSource;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  /** Save the log to a file. Without it the sheet offers Copy only. */
  onSaveLog?: (text: string) => void;
  detailsOpen?: boolean;
  defaultDetailsOpen?: boolean;
  onDetailsOpenChange?: (open: boolean) => void;
  logOpen?: boolean;
  defaultLogOpen?: boolean;
  onLogOpenChange?: (open: boolean) => void;
}

/** The one status line under the title. Anything that comes and goes lives inside it. */
function StatusLine({ model, status }: { model: string; status: ActivityStatus }) {
  const { label, tone } = stateLabel(status);
  let text: string;
  switch (status.kind) {
    case 'ready':
    case 'busy':
      text = [
        label,
        status.requests > 0 ? plural(status.requests, 'request') : null,
        `up ${status.uptime}`,
      ]
        .filter(Boolean)
        .join(' · ');
      break;
    case 'idle':
      text = `${label} · weights released, reloads on next message · up ${status.uptime}`;
      break;
    case 'starting':
      text = `${label} · ${status.phase.label} · ${Math.round(status.phase.elapsedSeconds)} s`;
      break;
    case 'stopped':
      text = `${label} · last ran ${status.lastRan}`;
      break;
    case 'failed':
      text = `${label} · ${status.reason}`;
      break;
  }
  return (
    <div className="eng-sub" role="status">
      <StatusDot tone={tone} pulse={status.kind === 'busy'} />
      <span className="eng-sub-text">{text}</span>
      {status.kind === 'starting' ? (
        <span className="eng-sub-meter">
          <MeterBar value={status.phase.progress} aria-label={`Starting ${model}`} />
        </span>
      ) : null}
    </div>
  );
}

function Actions({
  status,
  onStart,
  onStop,
  onRestart,
}: Pick<ActivityViewProps, 'status' | 'onStart' | 'onStop' | 'onRestart'>) {
  if (isLive(status)) {
    return (
      <>
        <Button variant="secondary" onClick={onRestart}>
          Restart
        </Button>
        <Button variant="secondary" onClick={onStop}>
          Stop
        </Button>
      </>
    );
  }
  if (status.kind === 'starting') {
    return (
      <Button variant="secondary" onClick={onStop}>
        Stop
      </Button>
    );
  }
  if (status.kind === 'failed') {
    return (
      <Button variant="primary" onClick={onRestart}>
        Restart
      </Button>
    );
  }
  return (
    <Button variant="primary" onClick={onStart}>
      Start
    </Button>
  );
}

function SummaryCards({ status, stats }: { status: ActivityStatus; stats: ActivityStats | null }) {
  const live = isLive(status) && stats !== null;
  // With the server off a card shows a dash and says why, never stale numbers.
  const off = status.kind === 'starting' ? 'Starting…' : 'Not running';
  if (!live) {
    return (
      <StatGrid className="eng-stats">
        {['Speed', 'Draft acceptance', 'Memory', 'Prompt cache'].map((label) => (
          <StatCard key={label} label={label} value={DASH} caption={off} />
        ))}
      </StatGrid>
    );
  }
  const kept = stats.draftAcceptance * stats.draftTokensPerStep;
  return (
    <StatGrid className="eng-stats">
      <StatCard
        label="Speed"
        value={wholeNumber(stats.tokensPerSecond)}
        unit="tok/s"
        caption="Average over 10 seconds"
      />
      <StatCard
        label="Draft acceptance"
        value={percentNumber(stats.draftAcceptance)}
        unit="%"
        caption={`${oneDecimal(kept)} of ${stats.draftTokensPerStep} kept`}
      >
        <DotsMeter
          filled={kept}
          total={stats.draftTokensPerStep}
          aria-label="Draft tokens kept per step"
        />
      </StatCard>
      <StatCard
        label="Memory"
        value={oneDecimal(stats.memoryUsedGB)}
        unit={`of ${oneDecimal(stats.memoryTotalGB)} GB`}
      >
        <MeterBar
          value={stats.memoryTotalGB > 0 ? stats.memoryUsedGB / stats.memoryTotalGB : 0}
          aria-label="Memory in use"
          valueText={gbOf(stats.memoryUsedGB, stats.memoryTotalGB)}
        />
      </StatCard>
      <StatCard
        label="Prompt cache"
        value={percentNumber(stats.promptCacheReuse)}
        unit="%"
        caption="Reused in the last hour"
      />
    </StatGrid>
  );
}

function speedSummary(values: readonly (number | null)[]): string {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return 'No speed data for the last minute';
  const min = Math.round(Math.min(...present));
  const max = Math.round(Math.max(...present));
  return `Tokens per second over the last minute, between ${min} and ${max}`;
}

/** The chart is drawn on the window, under a section label: no box. */
function SpeedChart({
  model,
  status,
  speed,
}: {
  model: string;
  status: ActivityStatus;
  speed: SpeedHistory | null;
}) {
  const live = isLive(status) && speed !== null && speed.t.length > 1;
  // Server off: the same axes with one sentence that says why, so nothing moves on start.
  const empty =
    status.kind === 'starting'
      ? `Speed appears once ${model} is ready`
      : `Start ${model} to see its speed`;
  const data: ChartData = live ? [speed.t, speed.tokensPerSecond] : [[], []];
  return (
    <Chart
      className="eng-chart"
      title="Tokens per second"
      readout="Last minute"
      data={data}
      series={[{ label: 'Speed', unit: 'tok/s' }]}
      yMin={0}
      yMax={live ? chartMax(speed.tokensPerSecond) : 120}
      height={CHART_HEIGHT}
      xLabels={['1 min ago', 'Now']}
      emptyMessage={live ? undefined : empty}
      aria-label={live ? speedSummary(speed.tokensPerSecond) : empty}
    />
  );
}

/** Failed: the last lines Splash printed take the chart's place, at the chart's height. */
function FailureLines({
  status,
  onShowLog,
}: {
  status: Extract<ActivityStatus, { kind: 'failed' }>;
  onShowLog: () => void;
}) {
  return (
    <section className="eng-chart" aria-labelledby="eng-fail-title">
      <div className="eng-section-head">
        <h2 className="eng-section-title" id="eng-fail-title">
          Last lines from Splash
        </h2>
        <span className="eng-section-readout">
          Stopped {status.at}
          <Button variant="ghost" size="sm" className="eng-fail-showlog" onClick={onShowLog}>
            Show log
          </Button>
        </span>
      </div>
      <div className="eng-fail-body">
        <LogLines
          lines={status.lastLines}
          aria-label="Last lines from Splash"
          className="eng-fail-log"
        />
      </div>
    </section>
  );
}

/**
 * Activity: the engine state with its actions, four numbers, one speed chart,
 * and everything else behind "Show details". Purely presentational.
 */
export function ActivityView({
  model,
  status,
  stats,
  speed,
  details,
  log,
  onStart,
  onStop,
  onRestart,
  onSaveLog,
  detailsOpen,
  defaultDetailsOpen = false,
  onDetailsOpenChange,
  logOpen,
  defaultLogOpen = false,
  onLogOpenChange,
}: ActivityViewProps) {
  const [showDetails, setShowDetails] = useControllable(
    detailsOpen,
    defaultDetailsOpen,
    onDetailsOpenChange,
  );
  const [showLog, setShowLog] = useControllable(logOpen, defaultLogOpen, onLogOpenChange);
  const [scrolled, setScrolled] = useState(false);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const next = event.currentTarget.scrollTop > 0;
    if (next !== scrolled) setScrolled(next);
  };
  const live = isLive(status);

  return (
    <div
      className={clsx('eng-page', scrolled && 'is-scrolled')}
      onScroll={onScroll}
      data-status={status.kind}
    >
      <div className="eng-page-inner">
        <header className="eng-head">
          <div className="eng-head-text">
            <h1 className="eng-title">Activity</h1>
            <StatusLine model={model} status={status} />
          </div>
          <div className="eng-actions">
            <Actions status={status} onStart={onStart} onStop={onStop} onRestart={onRestart} />
          </div>
        </header>

        <SummaryCards status={status} stats={stats} />

        {status.kind === 'failed' ? (
          <FailureLines status={status} onShowLog={() => setShowLog(true)} />
        ) : (
          <SpeedChart model={model} status={status} speed={speed} />
        )}

        <div className="eng-details">
          <Disclosure
            label="Show details"
            openLabel="Hide details"
            open={showDetails}
            onOpenChange={setShowDetails}
          >
            {live && details ? (
              <ActivityDetailsList details={details} />
            ) : (
              <p className="eng-details-off">
                {status.kind === 'starting'
                  ? `Details appear once ${model} is ready.`
                  : `Details appear while ${model} is running.`}
              </p>
            )}
            <div className="eng-log-row">
              <Button variant="secondary" onClick={() => setShowLog(true)}>
                Show log
              </Button>
              <span className="eng-log-row-note">
                The last 10,000 lines from Splash, kept by Splashboard.
              </span>
            </div>
          </Disclosure>
        </div>
      </div>

      <LogSheet
        open={showLog}
        onOpenChange={setShowLog}
        lines={log.lines}
        meta={log.meta}
        onSave={onSaveLog}
      />
    </div>
  );
}
