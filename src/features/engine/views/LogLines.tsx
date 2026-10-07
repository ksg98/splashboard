import { clsx } from 'clsx';
import type { LogLine } from './types';
import './LogLines.css';

export interface LogLinesProps {
  lines: readonly LogLine[];
  /** Accessible name of the log region. */
  'aria-label'?: string;
  className?: string;
}

/** Repo ids such as incoai/Qwen3.8-27B-Splash wrap as a whole, never at their hyphens. */
const REPO_ID = /(?<=^|\s)([A-Za-z][\w.-]*\/[A-Za-z][\w.-]*(?:@[0-9a-f]{6,})?)/g;

function Message({ text }: { text: string }) {
  const parts = text.split(REPO_ID);
  return (
    <span className="eng-log-m">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="eng-log-id">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  );
}

/**
 * Monospaced log lines in two columns: the time Splashboard received the line,
 * then the message, which wraps with a hanging indent. Errors get a red dot in
 * the gutter (and always say "Error" or "error:" themselves).
 */
export function LogLines({
  lines,
  'aria-label': ariaLabel = 'Splash log',
  className,
}: LogLinesProps) {
  return (
    <div className={clsx('eng-log', className)} role="log" aria-label={ariaLabel} data-selectable>
      {lines.map((line) => (
        <div key={line.id} className="eng-log-line" data-kind={line.kind}>
          {line.kind === 'error' ? (
            <span className="eng-log-err" role="img" aria-label="Error" />
          ) : null}
          <span className="eng-log-t">{line.time}</span>
          <Message text={line.text} />
        </div>
      ))}
    </div>
  );
}
