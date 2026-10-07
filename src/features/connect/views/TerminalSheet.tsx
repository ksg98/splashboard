import { ExternalLink, Folder } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog, ScrollEdge } from '@/components/ui/Dialog';
import { StatusDot } from '@/components/ui/StatusDot';
import { AgentTile } from './AgentGlyph';
import type { AgentId, TerminalStatus } from './types';
import './TerminalSheet.css';

export interface TerminalSheetProps {
  open: boolean;
  agent: { id: AgentId; name: string };
  /** The working folder the agent runs in, as shown: "~/Projects/splashboard". */
  folder: string;
  /** The model the agent talks to, e.g. "Qwen3.8-27B". */
  model: string;
  port: number;
  status: TerminalStatus;
  /** starting: what the server is doing ("Loading weights · 3 s"). */
  startingDetail?: string;
  /** exited: the agent's exit code, when known. */
  exitCode?: number | null;
  /**
   * Attaches the live terminal (xterm.js) to the panel's host element and
   * returns its cleanup. Called once per mount of the host.
   */
  mount?: (element: HTMLElement) => () => void;
  /** Static content for the panel when there is no `mount` (previews, tests). */
  transcript?: ReactNode;
  /** Hide: closes the sheet and keeps the session going (also Esc). */
  onHide: () => void;
  /** End session: quits the agent. */
  onEndSession: () => void;
  /** Open in Terminal ↗: runs the same command in Terminal.app. */
  onOpenInTerminal?: () => void;
  /** The folder chip: choose another working folder (before or between sessions). */
  onChangeFolder?: () => void;
  /** exited: start the agent again in the same folder. */
  onRestart?: () => void;
}

function TerminalHost({ mount }: { mount: (element: HTMLElement) => () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef(mount);
  useEffect(() => {
    mountRef.current = mount;
  }, [mount]);
  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    return mountRef.current(element);
  }, []);
  return <div ref={hostRef} className="ts-host" data-terminal-host />;
}

function TranscriptView({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Open on the newest line, snapped to the 20 px line grid so no glyph is sliced.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const bottom = element.scrollHeight - element.clientHeight;
    element.scrollTop = Math.max(0, Math.ceil(bottom / 20) * 20);
  }, []);
  return (
    <ScrollEdge ref={ref} size="sm" className="ts-scroll" data-selectable>
      {children}
    </ScrollEdge>
  );
}

function FooterNote({
  status,
  agent,
  model,
  startingDetail,
  exitCode,
}: {
  status: TerminalStatus;
  agent: string;
  model: string;
  startingDetail?: string;
  exitCode?: number | null;
}) {
  if (status === 'starting') {
    return (
      <>
        <StatusDot tone="warn" />
        <span>
          Starting {model}
          {startingDetail ? ` · ${startingDetail}` : '…'} · {agent} opens when it’s ready
        </span>
      </>
    );
  }
  if (status === 'exited') {
    return (
      <>
        <StatusDot tone="off" />
        <span>
          {agent} ended
          {exitCode !== undefined && exitCode !== null ? ` · exit code ${exitCode}` : ''}
        </span>
      </>
    );
  }
  return (
    <>
      <StatusDot tone="ok" />
      <span>{agent} is running · Hide keeps the session going; reopen it from Connect</span>
    </>
  );
}

/**
 * The agent terminal: a large sheet (1040 px, 90% of the window) with a dark
 * monospace panel. There is no ✕, so closing never ends an agent by
 * accident: Hide (and Esc) keeps the session, End session quits it.
 */
export function TerminalSheet({
  open,
  agent,
  folder,
  model,
  port,
  status,
  startingDetail,
  exitCode,
  mount,
  transcript,
  onHide,
  onEndSession,
  onOpenInTerminal,
  onChangeFolder,
  onRestart,
}: TerminalSheetProps) {
  const exited = status === 'exited';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onHide();
      }}
      title={`${agent.name} — ${folder}`}
      layout="bare"
      width={1040}
      className="ts-sheet"
    >
      <div className="ts-head">
        <AgentTile id={agent.id} />
        <div className="ts-heading">
          <div className="ts-title">{agent.name}</div>
          <div className="ts-sub">
            {onChangeFolder ? (
              <button
                type="button"
                className="ts-chip ts-chip--button"
                onClick={onChangeFolder}
                aria-label={`Working folder: ${folder}. Choose another folder`}
              >
                <Folder size={14} strokeWidth={1.5} aria-hidden />
                <span className="ts-chip-text">{folder}</span>
              </button>
            ) : (
              <span className="ts-chip" aria-label={`Working folder: ${folder}`}>
                <Folder size={14} strokeWidth={1.5} aria-hidden />
                <span className="ts-chip-text">{folder}</span>
              </span>
            )}
            <span>
              {model} on port {port}
            </span>
          </div>
        </div>
        {onOpenInTerminal ? (
          <Button
            variant="secondary"
            iconEnd={<ExternalLink size={14} strokeWidth={2} aria-hidden />}
            onClick={onOpenInTerminal}
          >
            Open in Terminal
          </Button>
        ) : null}
      </div>

      <div className="ts-panel" role="log" aria-label={`${agent.name} terminal`}>
        {mount ? <TerminalHost mount={mount} /> : <TranscriptView>{transcript}</TranscriptView>}
      </div>

      <div className="ts-foot">
        <p className="ts-note" role="status">
          <FooterNote
            status={status}
            agent={agent.name}
            model={model}
            startingDetail={startingDetail}
            exitCode={exitCode}
          />
        </p>
        {exited ? (
          <>
            {onRestart ? (
              <Button variant="secondary" onClick={onRestart}>
                Start again
              </Button>
            ) : null}
            <Button variant="primary" onClick={onHide}>
              Close
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onEndSession} title={`Quit ${agent.name}`}>
              End session
            </Button>
            <Button variant="primary" onClick={onHide}>
              Hide
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
