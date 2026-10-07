import { Check, Droplet } from 'lucide-react';
import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { StatusDot } from '@/components/ui/StatusDot';
import { formatProgressSize, formatSize } from './format';
import { ProgressBar } from './Progress';
import type { FirstRunStep, MacInfo, ModelOption, PartialDownload, StartProgress } from './types';
import './Welcome.css';

/** Where the title sits, from the top of the window, while a sheet is up. */
const LIFTED_TITLE_TOP = 60;
/** Gap between the bottom of the steps and the sheet. */
const SHEET_GAP = 28;

const STEP_ORDER: FirstRunStep[] = ['install', 'download', 'start'];

type StepState = 'done' | 'current' | 'upcoming';

function stepState(index: number, step: FirstRunStep): StepState {
  if (step === 'done') return 'done';
  const current = STEP_ORDER.indexOf(step);
  if (index < current) return 'done';
  return index === current ? 'current' : 'upcoming';
}

/** offsetTop summed up to `ancestor`; layout position, so transforms don't count. */
function offsetTopWithin(node: HTMLElement, ancestor: HTMLElement): number {
  let top = 0;
  let current: HTMLElement | null = node;
  while (current && current !== ancestor) {
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return top;
}

export interface WelcomeProps {
  /** The current step; `done` once the engine is ready. */
  step: FirstRunStep;
  /** The model step 2 downloads (the recommended one unless the user chose another). */
  model: Pick<ModelOption, 'name' | 'sizeBytes' | 'quant' | 'format' | 'publisher' | 'recommended'>;
  mac: MacInfo;
  /** Shown once step 1 is done: "Splash 1.2.0 is installed." */
  splashVersion?: string;
  /** Step 3 while the engine starts: the phase and seconds replace the help line in place. */
  starting?: StartProgress | null;
  /** Step 2 after a cancelled download: the button reads Resume download. */
  partialDownload?: PartialDownload | null;
  /** Where the engine listens, shown when ready: "127.0.0.1:8000". */
  address?: string;
  onInstall?: () => void;
  onDownload?: () => void;
  /** Opens the model choice. Shown as "Change…" on step 2 until the download is done. */
  onChooseModel?: () => void;
  onStart?: () => void;
  /** Ready: hand off to a new chat. */
  onOpenChat?: () => void;
  /**
   * An install, download or model-choice sheet. The welcome stays visible
   * under the scrim, lifted so its title and steps sit above the sheet.
   */
  sheet?: ReactNode;
}

/** First run: welcome, three steps (Install Splash, Download a model, Start) and one primary button. */
export function Welcome({
  step,
  model,
  mac,
  splashVersion,
  starting,
  partialDownload,
  address,
  onInstall,
  onDownload,
  onChooseModel,
  onStart,
  onOpenChat,
  sheet,
}: WelcomeProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stepsRef = useRef<HTMLOListElement>(null);
  const lifted = sheet !== undefined && sheet !== null && sheet !== false;

  // Lift the welcome so the title sits near the top and the sheet hangs below the steps.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const title = titleRef.current;
    const steps = stepsRef.current;
    if (!lifted || !root || !title || !steps) return;
    const measure = () => {
      const lift = Math.max(0, offsetTopWithin(title, root) - LIFTED_TITLE_TOP);
      const stepsBottom = offsetTopWithin(steps, root) + steps.offsetHeight - lift;
      root.style.setProperty('--sb-fr-lift', `${lift}px`);
      root.style.setProperty('--sb-fr-sheet-top', `${Math.round(stepsBottom + SHEET_GAP)}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(root);
    return () => observer?.disconnect();
  }, [lifted]);

  const size = formatSize(model.sizeBytes);
  const isStarting = step === 'start' && starting !== undefined && starting !== null;

  const downloadHelp = partialDownload
    ? `Paused at ${formatProgressSize(partialDownload.receivedBytes, partialDownload.totalBytes)}. Resume picks up from there.`
    : model.recommended
      ? `${size}. Recommended for this Mac’s ${mac.memoryGb} GB of memory.`
      : `${size}. ${model.format === 'MLX' ? `MLX ${model.quant}` : model.format}, from ${model.publisher}.`;

  const steps = [
    {
      label: 'Install Splash',
      todo: 'The engine and its tools, installed with Homebrew.',
      done: splashVersion ? `Splash ${splashVersion} is installed.` : 'Splash is installed.',
    },
    {
      label: `Download ${model.name}`,
      todo: downloadHelp,
      done: `Downloaded, ${size}.`,
    },
    {
      label: 'Start',
      todo: 'Chat here, or connect Claude Code, Codex and other agents.',
      done: address
        ? `Running at ${address}. Chat here, or connect an agent.`
        : 'Running. Chat here, or connect an agent.',
    },
  ];

  let cta: { label: string; onClick?: () => void; disabled?: boolean };
  switch (step) {
    case 'install':
      cta = { label: 'Install Splash', onClick: onInstall, disabled: !mac.ready };
      break;
    case 'download':
      cta = {
        label: partialDownload ? 'Resume download' : `Download ${model.name}`,
        onClick: onDownload,
      };
      break;
    case 'start':
      cta = isStarting
        ? { label: 'Starting…', disabled: true }
        : { label: 'Start', onClick: onStart };
      break;
    case 'done':
      cta = { label: 'Start chatting', onClick: onOpenChat };
      break;
  }

  const canChangeModel = onChooseModel !== undefined && (step === 'install' || step === 'download');

  return (
    <div className="sb-fr" ref={rootRef} data-lifted={lifted || undefined}>
      <section className="sb-fr__view" aria-labelledby={titleId} inert={lifted}>
        <div className="sb-fr__inner">
          <div className="sb-fr__mark" aria-hidden>
            <Droplet strokeWidth={1.25} />
          </div>
          <h1 ref={titleRef} id={titleId} className="sb-fr__title">
            Welcome to Splashboard
          </h1>
          <p className="sb-fr__sub">
            Run Qwen models privately on this Mac with Splash, Inco’s inference engine for Apple
            silicon.
          </p>

          <ol ref={stepsRef} className="sb-fr__steps" aria-label="Setup">
            {steps.map((item, index) => {
              const state = stepState(index, step);
              const showProgress = index === 2 && isStarting && starting;
              return (
                <li
                  key={item.label}
                  className="sb-fr-step"
                  data-state={state}
                  aria-current={state === 'current' ? 'step' : undefined}
                >
                  <span className="sb-fr-step__num">
                    {state === 'done' ? (
                      <>
                        <Check strokeWidth={2.6} aria-hidden />
                        <span className="sr-only">Done:</span>
                      </>
                    ) : (
                      <span aria-hidden>{index + 1}</span>
                    )}
                  </span>
                  <div className="sb-fr-step__text">
                    <div className="sb-fr-step__label">{item.label}</div>
                    {showProgress ? (
                      <div className="sb-fr-step__progress">
                        <ProgressBar
                          value={starting.progress}
                          label={`Starting ${model.name}`}
                          valueText={`${starting.phase}, ${starting.seconds} seconds`}
                        />
                        <span>
                          {starting.phase} · {starting.seconds} s
                        </span>
                      </div>
                    ) : (
                      <p
                        className="sb-fr-step__help"
                        title={state === 'done' ? item.done : item.todo}
                      >
                        {state === 'done' ? item.done : item.todo}
                      </p>
                    )}
                  </div>
                  {index === 1 && canChangeModel ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="sb-fr-step__action"
                      onClick={onChooseModel}
                      aria-label="Change model"
                    >
                      Change…
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>

          <Button
            variant="primary"
            size="lg"
            className="sb-fr__cta"
            onClick={cta.onClick}
            disabled={cta.disabled}
          >
            {cta.label}
          </Button>

          {mac.ready ? (
            <p className="sb-fr__compat">
              <Check strokeWidth={2.4} aria-hidden />
              This Mac is ready: {mac.model}, {mac.chip}, {mac.memoryGb} GB, macOS {mac.macos}
            </p>
          ) : (
            <p className="sb-fr__compat" data-tone="error" role="alert">
              <StatusDot tone="error" />
              {mac.problem ?? 'Splash can’t run on this Mac.'}
            </p>
          )}
        </div>
      </section>
      {lifted ? <div className="sb-fr__scrim">{sheet}</div> : null}
    </div>
  );
}
