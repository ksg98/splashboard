import { Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { Disclosure } from '@/components/ui/Disclosure';
import { StatusDot } from '@/components/ui/StatusDot';
import { FirstRunSheet } from './FirstRunSheet';
import { formatProgressSize, sentenceTimeLeft } from './format';
import { LogTail, ProgressBlock } from './Progress';
import type { InstallState } from './types';

export const SPLASH_INSTALL_COMMAND = 'brew install incoai/tap/splash';
export const HOMEBREW_INSTALLER_COMMAND =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

export interface InstallSheetProps {
  state: InstallState;
  /** brew's stdout and stderr, oldest first; the sheet shows the live end. */
  log: readonly string[];
  /** Default "Step 1 of 3". */
  stepLabel?: string;
  /** Controlled "Show details". Uncontrolled it starts closed, and opens by itself on failure. */
  logOpen?: boolean;
  onLogOpenChange?: (open: boolean) => void;
  /** Running: stops brew. Otherwise: closes the sheet. */
  onCancel: () => void;
  /** Failed: run the install again. */
  onRetry?: () => void;
  /** Succeeded: on to step 2. */
  onContinue?: () => void;
  /** No Homebrew: run Homebrew's installer in the built-in terminal. */
  onOpenTerminal?: () => void;
  /** No Homebrew: open brew.sh in the browser. */
  onOpenHomebrewSite?: () => void;
}

/** Step 1: `brew install incoai/tap/splash`, with progress, a log tail and every outcome. */
export function InstallSheet({
  state,
  log,
  stepLabel = 'Step 1 of 3',
  logOpen,
  onLogOpenChange,
  onCancel,
  onRetry,
  onContinue,
  onOpenTerminal,
  onOpenHomebrewSite,
}: InstallSheetProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const detailsOpen = logOpen ?? userOpen ?? state.kind === 'failed';
  const setDetailsOpen = (open: boolean) => {
    setUserOpen(open);
    onLogOpenChange?.(open);
  };

  const commandNote = (
    <>
      Runs <code className="sb-fr-code">{SPLASH_INSTALL_COMMAND}</code>
    </>
  );

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
          label="Install log"
          action={
            state.kind === 'failed' && log.length > 0 ? (
              <CopyButton text={log.join('\n')} label="Copy log" />
            ) : null
          }
        />
      </Disclosure>
    </div>
  );

  if (state.kind === 'no-homebrew') {
    return (
      <FirstRunSheet
        title="Homebrew isn’t installed"
        subtitle={stepLabel}
        onEscape={onCancel}
        note={
          onOpenHomebrewSite ? (
            <>
              Or get it from{' '}
              <button type="button" className="sb-fr-link" onClick={onOpenHomebrewSite}>
                brew.sh
              </button>
            </>
          ) : null
        }
        actions={
          <>
            <Button onClick={onCancel}>Cancel</Button>
            <Button variant="primary" onClick={onOpenTerminal}>
              Install in terminal
            </Button>
          </>
        }
      >
        <p className="sb-fr-text">
          Splash installs with Homebrew, the package manager for macOS, and it isn’t on this Mac
          yet.
        </p>
        <p className="sb-fr-text sb-fr-text--secondary">
          Homebrew’s installer asks for your Mac password, so it runs in the built-in terminal. When
          it finishes, Splashboard picks up here and installs Splash.
        </p>
        <div className="sb-fr-command">
          <pre className="sb-fr-command__text">{HOMEBREW_INSTALLER_COMMAND}</pre>
          <CopyButton text={HOMEBREW_INSTALLER_COMMAND} label="Copy Homebrew install command" />
        </div>
      </FirstRunSheet>
    );
  }

  if (state.kind === 'succeeded') {
    return (
      <FirstRunSheet
        title="Splash is installed"
        subtitle={stepLabel}
        onEscape={onContinue}
        note={commandNote}
        actions={
          <Button variant="primary" onClick={onContinue}>
            Continue
          </Button>
        }
      >
        <div className="sb-fr-result">
          <span className="sb-fr-result__icon" aria-hidden>
            <Check strokeWidth={2.4} />
          </span>
          <p className="sb-fr-text">
            Splash {state.version} is installed and this Mac passed its check. Next, download a
            model.
          </p>
        </div>
        {details}
      </FirstRunSheet>
    );
  }

  if (state.kind === 'failed') {
    return (
      <FirstRunSheet
        title="Splash couldn’t be installed"
        subtitle={stepLabel}
        onEscape={onCancel}
        note={commandNote}
        actions={
          <>
            <Button onClick={onCancel}>Close</Button>
            <Button variant="primary" onClick={onRetry}>
              Try again
            </Button>
          </>
        }
      >
        <div className="sb-fr-result" role="alert">
          <StatusDot tone="error" className="sb-fr-result__dot" />
          <p className="sb-fr-text">{state.message}</p>
        </div>
        {details}
      </FirstRunSheet>
    );
  }

  // Running
  const hasBytes = state.receivedBytes !== undefined && state.totalBytes !== undefined;
  const bytes = hasBytes ? formatProgressSize(state.receivedBytes ?? 0, state.totalBytes ?? 0) : '';
  const foot =
    state.secondsLeft !== undefined && state.secondsLeft !== null
      ? sentenceTimeLeft(state.secondsLeft)
      : 'This usually takes about a minute.';

  return (
    <FirstRunSheet
      title="Installing Splash"
      subtitle={stepLabel}
      note={commandNote}
      actions={<Button onClick={onCancel}>Cancel</Button>}
    >
      <ProgressBlock
        title={state.phase}
        value={bytes || undefined}
        progress={state.progress}
        progressLabel="Installing Splash"
        progressValueText={bytes || undefined}
        foot={foot}
      />
      {details}
    </FirstRunSheet>
  );
}
