import { Box } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusDot } from '@/components/ui/StatusDot';
import { ENGINE_WORD, formatPhrase } from './format';
import type { RunningModel } from './types';
import './ModelsView.css';

export interface RunningModelCardProps {
  model: RunningModel;
  onOpenLaunchSettings: (modelId: string) => void;
  onStart: () => void;
  onStop: () => void;
}

/**
 * The model the server runs, on top of the Models page: a gray icon tile,
 * the name, one meta line (format · size · context), the engine word, then
 * Launch settings and Stop, or a black Start when stopped. Text buttons
 * carry no icon.
 */
export function RunningModelCard({
  model,
  onOpenLaunchSettings,
  onStart,
  onStop,
}: RunningModelCardProps) {
  const word = ENGINE_WORD[model.state];
  const hover = [model.repo, model.detail].filter(Boolean).join(' · ');
  return (
    <section className="mv-running" aria-label="Running model">
      <div className="mv-tile" aria-hidden>
        <Box strokeWidth={1.5} />
      </div>
      <div className="mv-running__text" title={hover}>
        <div className="mv-running__name">
          {model.name}
          {model.variant ? <span className="mv-row__variant"> ({model.variant})</span> : null}
        </div>
        <div className="mv-running__meta">
          {formatPhrase(model.format)} · {model.size} · {model.context}
        </div>
      </div>
      <div className="mv-running__side">
        <span className="mv-running__state" role="status">
          <StatusDot tone={word.tone} pulse={word.pulse} />
          <span>{word.label}</span>
        </span>
        <Button onClick={() => onOpenLaunchSettings(model.id)}>Launch settings</Button>
        {model.state === 'stopped' ? (
          <Button variant="primary" onClick={onStart}>
            Start
          </Button>
        ) : (
          <Button onClick={onStop}>Stop</Button>
        )}
      </div>
    </section>
  );
}
