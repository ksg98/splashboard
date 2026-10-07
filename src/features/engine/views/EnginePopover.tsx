import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { MeterBar } from '@/components/ui/Meter';
import { StatusDot } from '@/components/ui/StatusDot';
import type { EngineStateLabel, StartPhase } from './types';
import { oneDecimal, percentNumber, wholeNumber } from './wording';
import './EnginePopover.css';

export type EnginePopoverKind = 'live' | 'starting' | 'stopped' | 'failed';

export interface EnginePopoverProps {
  /** "Qwen3.8-27B" */
  model: string;
  /** "Splash 1.2.0" */
  version: string;
  /** "127.0.0.1:8000" */
  address: string;
  /** "2 h 14 min"; shown while the server runs. */
  uptime: string;
  /** The engine word and dot: Ready, Thinking, Starting…, Stopped. */
  state: EngineStateLabel;
  /** Decode tokens per second (last 10 s). */
  speed?: number;
  /** Draft acceptance, 0..1. */
  acceptance?: number;
  /** GPU memory in use, GB. */
  memory?: number;
  onRestart: () => void;
  onStop: () => void;
  onStart: () => void;
  onOpenActivity: () => void;
  onOpenLaunchSettings: () => void;
  /** "Open Models ⌘3": with the sidebar hidden this popover is the way to the engine's pages. */
  onOpenModels?: () => void;
  /** Which layout to show. Default: from `state.tone` (ok/busy live, warn starting, off stopped, error failed). */
  kind?: EnginePopoverKind;
  /** Starting…: the phase, seconds so far and progress. */
  phase?: StartPhase;
  /** Stopped or failed: "today at 11:27". */
  lastRan?: string;
  /** Stopped: what Start does. */
  startNote?: string;
  /** Failed: one plain-English clause ("another copy of Splash is using port 8000"). */
  failure?: string;
}

function kindFromTone(tone: EngineStateLabel['tone']): EnginePopoverKind {
  if (tone === 'warn') return 'starting';
  if (tone === 'off') return 'stopped';
  if (tone === 'error') return 'failed';
  return 'live';
}

function Stat({
  value,
  unit,
  tight,
  caption,
}: {
  value: string;
  unit: string;
  tight?: boolean;
  caption: string;
}) {
  return (
    <div className="eng-pop-stat">
      <div className="eng-pop-num">
        {value}
        <small className={tight ? 'is-tight' : undefined}>{unit}</small>
      </div>
      <div className="eng-pop-cap">{caption}</div>
    </div>
  );
}

function NavItem({
  label,
  shortcut,
  onSelect,
}: {
  label: string;
  shortcut?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="eng-pop-item"
      onClick={onSelect}
      data-closes-popover=""
      aria-keyshortcuts={shortcut ? shortcut.replace('⌘', 'Meta+') : undefined}
    >
      <span className="eng-pop-item-text">{label}</span>
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </button>
  );
}

/**
 * The engine popover, opened from the sidebar engine row or, with the sidebar
 * hidden, from the toolbar chip. Name and state; then, by state, three numbers
 * with Restart and Stop, the start phase with Stop, or one black Start; then
 * the engine's pages. Only the content: the caller supplies the Popover.
 */
export function EnginePopover({
  model,
  version,
  address,
  uptime,
  state,
  speed,
  acceptance,
  memory,
  onRestart,
  onStop,
  onStart,
  onOpenActivity,
  onOpenLaunchSettings,
  onOpenModels,
  kind,
  phase,
  lastRan,
  startNote = 'Starts with your launch settings, ready in about 25 seconds.',
  failure,
}: EnginePopoverProps) {
  const shown = kind ?? kindFromTone(state.tone);
  let sub: string;
  let body: ReactNode;

  switch (shown) {
    case 'live':
      sub = `${version} · ${address} · up ${uptime}`;
      body = (
        <>
          <div className="eng-pop-stats" role="group" aria-label="Live numbers">
            <Stat
              value={speed === undefined ? '—' : wholeNumber(speed)}
              unit="tok/s"
              caption="Speed"
            />
            <Stat
              value={acceptance === undefined ? '—' : percentNumber(acceptance)}
              unit="%"
              tight
              caption="Drafts accepted"
            />
            <Stat
              value={memory === undefined ? '—' : oneDecimal(memory)}
              unit="GB"
              caption="Memory"
            />
          </div>
          <div className="eng-pop-actions">
            <Button variant="secondary" onClick={onRestart}>
              Restart
            </Button>
            <Button variant="secondary" onClick={onStop}>
              Stop
            </Button>
          </div>
        </>
      );
      break;
    case 'starting':
      sub = `${version} · ${address}`;
      body = (
        <>
          <div className="eng-pop-progress">
            <div className="eng-pop-progress-label">
              <span>{phase?.label ?? 'Preparing'}</span>
              <span className="eng-pop-elapsed">
                {phase ? `${Math.round(phase.elapsedSeconds)} s` : ''}
              </span>
            </div>
            <MeterBar value={phase?.progress ?? 0} aria-label={`Starting ${model}`} />
          </div>
          <div className="eng-pop-actions is-single">
            <Button variant="secondary" onClick={onStop}>
              Stop
            </Button>
          </div>
        </>
      );
      break;
    case 'stopped':
      sub = lastRan ? `Last ran ${lastRan} · ${version}` : version;
      body = (
        <>
          <p className="eng-pop-note">{startNote}</p>
          <div className="eng-pop-actions is-single">
            <Button variant="primary" onClick={onStart}>
              Start
            </Button>
          </div>
        </>
      );
      break;
    case 'failed':
      sub = lastRan ? `Stopped ${lastRan} · ${version}` : version;
      body = (
        <>
          <p className="eng-pop-note">
            {failure ? `Splash couldn’t start: ${failure}.` : 'Splash stopped with an error.'} The
            log in Activity has the details.
          </p>
          <div className="eng-pop-actions is-single">
            <Button variant="primary" onClick={onRestart}>
              Restart
            </Button>
          </div>
        </>
      );
      break;
  }

  return (
    <div className="eng-pop" data-kind={shown}>
      <div className="eng-pop-head">
        <span className="eng-pop-title">{model}</span>
        <span className="eng-pop-state">
          <StatusDot tone={state.tone} label={state.label} />
        </span>
      </div>
      <div className="eng-pop-sub">{sub}</div>
      {body}
      <div className="eng-pop-sep" role="separator" />
      <nav aria-label="Engine pages">
        <NavItem label="Open Activity" shortcut="⌘2" onSelect={onOpenActivity} />
        {onOpenModels ? (
          <NavItem label="Open Models" shortcut="⌘3" onSelect={onOpenModels} />
        ) : null}
        <NavItem label="Launch settings…" onSelect={onOpenLaunchSettings} />
      </nav>
    </div>
  );
}
