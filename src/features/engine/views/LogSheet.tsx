import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CopyButton } from '@/components/ui/CopyButton';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import { Segmented } from '@/components/ui/Segmented';
import { LogLines } from './LogLines';
import type { LogLine } from './types';
import { logText } from './wording';
import './LogSheet.css';

export type LogFilter = 'all' | 'requests' | 'errors';

const FILTERS: { value: LogFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'requests', label: 'Requests' },
  { value: 'errors', label: 'Errors' },
];

function matches(line: LogLine, filter: LogFilter): boolean {
  if (filter === 'requests') return line.kind === 'request';
  if (filter === 'errors') return line.kind === 'error';
  return true;
}

export interface LogSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: readonly LogLine[];
  /** "Splash 1.2.0 · 127.0.0.1:8000 · started 09:12" */
  meta: string;
  /** Save the shown lines to a file. Without it only Copy is offered. */
  onSave?: (text: string) => void;
  defaultFilter?: LogFilter;
}

/**
 * The log sheet: everything Splash printed, verbatim, each line stamped with
 * the time Splashboard received it. Opens scrolled to the newest line.
 */
export function LogSheet({
  open,
  onOpenChange,
  lines,
  meta,
  onSave,
  defaultFilter = 'all',
}: LogSheetProps) {
  const [filter, setFilter] = useState<LogFilter>(defaultFilter);
  const shown = filter === 'all' ? lines : lines.filter((line) => matches(line, filter));
  const text = logText(shown);
  const contentRef = useRef<HTMLDivElement>(null);

  // Newest line first in view, on open and whenever the filter changes.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const scroller = contentRef.current?.parentElement;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, filter, shown.length]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Log"
      description={meta}
      width={860}
      bodyClassName="eng-logsheet-body"
      headerActions={
        <>
          <Segmented value={filter} options={FILTERS} onChange={setFilter} aria-label="Show" />
          <span className="eng-logsheet-gap" />
          <CopyButton text={text} label="Copy log" />
          {onSave ? (
            <IconButton
              label="Save log…"
              icon={<Download strokeWidth={1.5} size={18} />}
              onClick={() => onSave(text)}
            />
          ) : null}
        </>
      }
    >
      <div ref={contentRef}>
        {shown.length > 0 ? (
          <LogLines lines={shown} />
        ) : (
          <p className="eng-logsheet-empty">
            {filter === 'errors' ? 'No errors since Splash started.' : 'Nothing logged yet.'}
          </p>
        )}
      </div>
    </Dialog>
  );
}
