import { useState, type ReactNode } from 'react';
import { ConnectView } from './ConnectView';
import {
  agents as defaultAgents,
  api as defaultApi,
  claudeTranscript,
  engineReady,
  terminal,
} from './fixtures';
import { TerminalSheet } from './TerminalSheet';
import { TerminalTranscript } from './TerminalTranscript';
import type { AgentId, ConnectAgent, ConnectApi, ConnectEngine, TerminalStatus } from './types';
import './ConnectDemo.css';

/**
 * Gallery only: the main column of the window (sidebar width and toolbar
 * height left empty) so a view sits where it sits in the app.
 */
export function DemoWindow({ children }: { children: ReactNode }) {
  return (
    <div className="cdemo-window">
      <div className="cdemo-sidebar" aria-hidden="true" />
      <div className="cdemo-main">
        <div className="cdemo-toolbar" aria-hidden="true" />
        <div className="cdemo-content">{children}</div>
      </div>
    </div>
  );
}

export interface ConnectDemoProps {
  engine?: ConnectEngine;
  agents?: ConnectAgent[];
  api?: ConnectApi;
  /** Opens the terminal sheet on load. */
  terminalOpen?: boolean;
  terminalStatus?: TerminalStatus;
}

/** Gallery only: Connect with working Open / Hide / End session, on demo data. */
export function ConnectDemo({
  engine = engineReady,
  agents = defaultAgents,
  api = defaultApi,
  terminalOpen = false,
  terminalStatus = 'running',
}: ConnectDemoProps) {
  const [openAgent, setOpenAgent] = useState<AgentId | null>(terminalOpen ? 'claude' : null);
  const [status, setStatus] = useState<TerminalStatus>(terminalStatus);
  const current = agents.find((agent) => agent.id === openAgent);
  return (
    <DemoWindow>
      <ConnectView
        engine={engine}
        agents={agents}
        api={api}
        onOpenAgent={(id) => {
          setStatus('running');
          setOpenAgent(id);
        }}
        onGetAgent={() => undefined}
      />
      {current ? (
        <TerminalSheet
          open
          agent={{ id: current.id, name: current.name }}
          folder={terminal.folder}
          model={terminal.model}
          port={terminal.port}
          status={status}
          startingDetail="Loading weights · 3 s"
          exitCode={0}
          transcript={<TerminalTranscript lines={claudeTranscript} />}
          onHide={() => setOpenAgent(null)}
          onEndSession={() => setStatus('exited')}
          onRestart={() => setStatus('running')}
          onOpenInTerminal={() => undefined}
          onChangeFolder={() => undefined}
        />
      ) : null}
    </DemoWindow>
  );
}
