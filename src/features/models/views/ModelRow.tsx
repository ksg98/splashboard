import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { PopUpButton } from '@/components/ui/PopUpButton';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { FORMAT_WORD, chosenVersion, formatPhrase, modelTitle } from './format';
import type { ModelRowData } from './types';
import './ModelsView.css';

export interface ModelRowProps {
  model: ModelRowData;
  /** Installed rows open their launch settings (row click, Enter or Space). */
  onOpen?: (modelId: string) => void;
  onRun?: (modelId: string) => void;
  onStop?: (modelId: string) => void;
  onGet?: (modelId: string, versionId?: string) => void;
  onCancelDownload?: (modelId: string) => void;
  onVersionChange?: (modelId: string, versionId: string) => void;
}

/**
 * A three-line model row (from the Native direction, in Minimal's tokens):
 * the name, a one-line description, then "size · quant · format" in gray,
 * with the action centred in the shared 60 px action slot.
 */
export function ModelRow({
  model,
  onOpen,
  onRun,
  onStop,
  onGet,
  onCancelDownload,
  onVersionChange,
}: ModelRowProps) {
  const { action } = model;
  const title = modelTitle(model);
  const phrase = formatPhrase(model.format, model.quant);
  const version = chosenVersion(model);
  const versions = model.versions ?? [];
  const opens = Boolean(onOpen) && (action.kind === 'run' || action.kind === 'stop');
  const incompatible = action.kind === 'incompatible';

  const size = version?.size ?? model.size;
  const description = version
    ? `${versions.length - 1} more ${versions.length - 1 === 1 ? 'version' : 'versions'} · ${version.summary}`
    : model.description;

  const metaParts =
    action.kind === 'downloading'
      ? [`Downloading ${action.done}`, action.eta, model.quant, FORMAT_WORD[model.format]]
      : [size, model.quant, FORMAT_WORD[model.format]];
  const meta = metaParts.filter(Boolean).join(' · ');

  const open = () => onOpen?.(model.id);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };
  // Buttons inside an opening row act on their own; the row opens settings.
  const stop = (event: MouseEvent) => event.stopPropagation();

  let control = null;
  switch (action.kind) {
    case 'run':
      control = (
        <Button
          aria-label={`Run ${title}, ${phrase}`}
          onClick={(e) => {
            stop(e);
            onRun?.(model.id);
          }}
        >
          Run
        </Button>
      );
      break;
    case 'stop':
      control = (
        <Button
          aria-label={`Stop ${title}`}
          onClick={(e) => {
            stop(e);
            onStop?.(model.id);
          }}
        >
          Stop
        </Button>
      );
      break;
    case 'get':
      control = (
        <Button
          aria-label={`Get ${title}${version ? `, ${version.label}` : ''}`}
          onClick={(e) => {
            stop(e);
            onGet?.(model.id, version?.id);
          }}
        >
          Get
        </Button>
      );
      break;
    case 'downloading':
      control = (
        <ProgressRing
          value={action.progress}
          size={28}
          label={`Downloading ${title}`}
          onCancel={onCancelDownload ? () => onCancelDownload(model.id) : undefined}
        />
      );
      break;
    case 'installed':
      control = <span className="mv-row__word">Installed</span>;
      break;
    case 'incompatible':
      control = null;
      break;
  }

  return (
    <div
      className={clsx('mv-row', opens && 'mv-row--opens', incompatible && 'mv-row--incompatible')}
      role={opens ? 'button' : undefined}
      tabIndex={opens ? 0 : undefined}
      aria-label={opens ? `${title}, ${phrase}. Show launch settings` : undefined}
      aria-disabled={incompatible || undefined}
      onClick={opens ? open : undefined}
      onKeyDown={opens ? onKeyDown : undefined}
      title={version?.id ?? model.repo}
    >
      <div className="mv-row__text">
        <div className="mv-row__name">
          {model.name}
          {model.variant ? <span className="mv-row__variant"> ({model.variant})</span> : null}
        </div>
        <div className="mv-row__line">{description}</div>
        <div className="mv-row__line mv-row__meta">
          {meta}
          {incompatible ? <span> · {action.reason}</span> : null}
        </div>
      </div>
      <div className="mv-row__aside">
        {incompatible ? (
          <span className="mv-row__word">Not compatible with this Mac</span>
        ) : versions.length > 1 && version ? (
          <span onClick={stop}>
            <PopUpButton
              value={version.id}
              options={versions.map((v) => ({
                value: v.id,
                label: v.label,
                description: v.description,
              }))}
              onChange={(next) => onVersionChange?.(model.id, next)}
              aria-label={`Version of ${title}: ${version.label}`}
              heading="Version"
              align="end"
            />
          </span>
        ) : null}
      </div>
      <div className="mv-row__action">{control}</div>
      <div className="mv-row__chevron" aria-hidden>
        {opens ? <ChevronRight strokeWidth={2.4} /> : null}
      </div>
    </div>
  );
}
