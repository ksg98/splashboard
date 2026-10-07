import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { Disclosure } from '@/components/ui/Disclosure';
import { StatusDot } from '@/components/ui/StatusDot';
import { FirstRunSheet } from './FirstRunSheet';
import { formatProgressSize, formatSpeed, formatTimeLeft } from './format';
import { LogTail, ProgressBlock } from './Progress';
import type { DownloadState, ModelOption } from './types';

export const DEFAULT_DOWNLOAD_FOLDER = '~/.cache/huggingface/hub';

export interface DownloadSheetProps {
  model: Pick<ModelOption, 'id' | 'name'>;
  state: DownloadState;
  /** The download's output, oldest first ("Fetching 14 file(s), 17.60 GB, from …"). */
  log: readonly string[];
  /** Where the files go. Default ~/.cache/huggingface/hub. */
  folder?: string;
  /** Default "Step 2 of 3". */
  stepLabel?: string;
  /** Controlled "Show details". Uncontrolled it starts closed, and opens by itself on failure. */
  logOpen?: boolean;
  onLogOpenChange?: (open: boolean) => void;
  /** While downloading: stop and keep what's downloaded (the sheet then shows Paused). */
  onCancel: () => void;
  /** Paused: pick up where it stopped. */
  onResume?: () => void;
  /** Failed: start again (Splash reuses the files already there). */
  onRetry?: () => void;
  /** Paused or failed: close the sheet. */
  onClose?: () => void;
}

/** Step 2: the model download, with bytes, speed, time left, Cancel and Resume. */
export function DownloadSheet({
  model,
  state,
  log,
  folder = DEFAULT_DOWNLOAD_FOLDER,
  stepLabel = 'Step 2 of 3',
  logOpen,
  onLogOpenChange,
  onCancel,
  onResume,
  onRetry,
  onClose,
}: DownloadSheetProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const detailsOpen = logOpen ?? userOpen ?? state.kind === 'failed';
  const setDetailsOpen = (open: boolean) => {
    setUserOpen(open);
    onLogOpenChange?.(open);
  };

  const note = (
    <>
      Saves to <code className="sb-fr-code">{folder}</code>
    </>
  );
  const progressLabel = `Downloading ${model.name}`;
  const keepsNote = 'Cancel keeps what’s downloaded, so it picks up from there next time.';

  const details = (
    <div className="sb-fr-details">
      <Disclosure
        label="Show details"
        openLabel="Hide details"
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      >
        <LogTail
          lines={log}
          label="Download log"
          action={
            state.kind === 'failed' && log.length > 0 ? (
              <CopyButton text={log.join('\n')} label="Copy log" />
            ) : null
          }
        />
      </Disclosure>
    </div>
  );

  if (state.kind === 'paused') {
    const size = formatProgressSize(state.receivedBytes, state.totalBytes);
    return (
      <FirstRunSheet
        title="Download paused"
        subtitle={stepLabel}
        onEscape={onClose}
        note={note}
        actions={
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={onResume}>
              Resume
            </Button>
          </>
        }
      >
        <ProgressBlock
          title={model.id}
          value={size}
          progress={state.totalBytes > 0 ? state.receivedBytes / state.totalBytes : 0}
          progressLabel={progressLabel}
          progressValueText={`Paused at ${size}`}
          foot="What’s downloaded is kept. Resume picks up from there."
        />
        {details}
      </FirstRunSheet>
    );
  }

  if (state.kind === 'failed') {
    const known = state.receivedBytes !== undefined && state.totalBytes !== undefined;
    return (
      <FirstRunSheet
        title={`${model.name} couldn’t be downloaded`}
        subtitle={stepLabel}
        onEscape={onClose}
        note={note}
        actions={
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={onRetry}>
              Try again
            </Button>
          </>
        }
      >
        <div className="sb-fr-result" role="alert">
          <StatusDot tone="error" className="sb-fr-result__dot" />
          <p className="sb-fr-text">
            {state.message}
            {known ? (
              <span className="sb-fr-text--secondary">
                {' '}
                {formatProgressSize(state.receivedBytes ?? 0, state.totalBytes ?? 0)} is kept for
                next time.
              </span>
            ) : null}
          </p>
        </div>
        {details}
      </FirstRunSheet>
    );
  }

  if (state.kind === 'working') {
    return (
      <FirstRunSheet
        title={`Downloading ${model.name}`}
        subtitle={stepLabel}
        note={note}
        actions={<Button onClick={onCancel}>Cancel</Button>}
      >
        <ProgressBlock
          title={model.id}
          value={`${state.label}…`}
          progress={null}
          progressLabel={progressLabel}
          progressValueText={state.label}
          foot={keepsNote}
        />
        {details}
      </FirstRunSheet>
    );
  }

  // Downloading
  const size = formatProgressSize(state.receivedBytes, state.totalBytes);
  const parts = [size];
  if (state.bytesPerSecond) parts.push(formatSpeed(state.bytesPerSecond));
  if (state.secondsLeft !== undefined && state.secondsLeft !== null) {
    parts.push(formatTimeLeft(state.secondsLeft));
  }

  return (
    <FirstRunSheet
      title={`Downloading ${model.name}`}
      subtitle={stepLabel}
      note={note}
      actions={<Button onClick={onCancel}>Cancel</Button>}
    >
      <ProgressBlock
        title={model.id}
        value={parts.join(' · ')}
        progress={state.totalBytes > 0 ? state.receivedBytes / state.totalBytes : null}
        progressLabel={progressLabel}
        progressValueText={size}
        foot={keepsNote}
      />
      {details}
    </FirstRunSheet>
  );
}
