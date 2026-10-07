import { ExternalLink, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { ScrollEdge } from '@/components/ui/Dialog';
import { FormGroup, FormRow, FormSection } from '@/components/ui/Form';
import { IconButton } from '@/components/ui/IconButton';
import { Spinner } from '@/components/ui/Spinner';
import { StatusDot } from '@/components/ui/StatusDot';
import { AgentTile } from './AgentGlyph';
import { maskKey } from './maskKey';
import type { AgentId, ConnectAgent, ConnectApi, ConnectEngine } from './types';
import './ConnectView.css';

export interface ConnectViewProps {
  engine: ConnectEngine;
  agents: ConnectAgent[];
  api: ConnectApi;
  /** Open (or Show, for a running session) an agent in the terminal sheet. */
  onOpenAgent: (id: AgentId) => void;
  /** Get ↗: open the agent's install page in the browser. */
  onGetAgent: (id: AgentId) => void;
  /** How the Copy buttons write to the clipboard. Default: navigator.clipboard. */
  copyText?: (text: string) => Promise<void> | void;
}

function StatusLine({ engine }: { engine: ConnectEngine }) {
  if (engine.state === 'stopped') {
    return (
      <p className="cv-sub">
        <StatusDot tone="off" />
        {engine.model} isn’t running. Opening an agent starts it first.
      </p>
    );
  }
  if (engine.state === 'starting') {
    return (
      <p className="cv-sub">
        <StatusDot tone="warn" />
        {engine.model} is starting. Agents can connect once it’s ready.
      </p>
    );
  }
  return (
    <p className="cv-sub">Use {engine.model} from coding agents and other apps on this Mac.</p>
  );
}

function AgentAction({
  agent,
  onOpen,
  onGet,
}: {
  agent: ConnectAgent;
  onOpen: () => void;
  onGet: () => void;
}) {
  switch (agent.status) {
    case 'checking':
      return (
        <span className="cv-slot">
          <Spinner size={14} label={`Looking for ${agent.name}`} />
        </span>
      );
    case 'not-installed':
      return (
        <>
          <span className="cv-tag">Not installed</span>
          <Button
            variant="secondary"
            iconEnd={<ExternalLink size={14} strokeWidth={2} aria-hidden />}
            aria-label={`Get ${agent.name} (opens its install page)`}
            onClick={onGet}
          >
            Get
          </Button>
        </>
      );
    case 'running':
      return (
        <>
          <span className="cv-tag cv-tag--status">
            <StatusDot tone="ok" />
            Running
          </span>
          <Button variant="secondary" aria-label={`Show ${agent.name}`} onClick={onOpen}>
            Show
          </Button>
        </>
      );
    case 'installed':
      return (
        <Button variant="secondary" aria-label={`Open ${agent.name}`} onClick={onOpen}>
          Open
        </Button>
      );
  }
}

function MonoValue({ children }: { children: string }) {
  return (
    <span className="cv-mono" data-selectable>
      {children}
    </span>
  );
}

function ApiKeyControl({
  apiKey,
  copyText,
}: {
  apiKey: string | null;
  copyText?: (text: string) => Promise<void> | void;
}) {
  const [revealed, setRevealed] = useState(false);
  if (apiKey === null) {
    return (
      <>
        <MonoValue>local</MonoValue>
        <CopyButton text="local" label="Copy API key" copy={copyText} />
      </>
    );
  }
  return (
    <>
      <MonoValue>{revealed ? apiKey : maskKey(apiKey)}</MonoValue>
      <IconButton
        size="sm"
        className="cv-reveal"
        label={revealed ? 'Hide API key' : 'Show API key'}
        aria-pressed={revealed}
        icon={
          revealed ? (
            <EyeOff size={16} strokeWidth={1.5} aria-hidden />
          ) : (
            <Eye size={16} strokeWidth={1.5} aria-hidden />
          )
        }
        onClick={() => setRevealed((value) => !value)}
      />
      <CopyButton text={apiKey} label="Copy API key" copy={copyText} />
    </>
  );
}

/**
 * Connect: the coding agents `splash <agent>` launches, and the API values
 * other apps need. A page in the shell's main column (880 px).
 */
export function ConnectView({
  engine,
  agents,
  api,
  onOpenAgent,
  onGetAgent,
  copyText,
}: ConnectViewProps) {
  return (
    <ScrollEdge className="cv-page">
      <div className="cv-inner">
        <header className="cv-head">
          <h1 className="cv-title">Connect</h1>
          <StatusLine engine={engine} />
        </header>

        <FormSection
          title="Coding agents"
          footnote="Agents open in a terminal inside Splashboard, already pointed at this server. Hermes and Pi save a Splash profile in your home folder the first time."
        >
          <ul className="cv-agents" aria-label="Coding agents">
            {agents.map((agent) => (
              <li key={agent.id} className="cv-agent">
                <AgentTile id={agent.id} />
                <div className="cv-agent-text">
                  <div className="cv-agent-name">{agent.name}</div>
                  <div className="cv-agent-desc">{agent.description}</div>
                </div>
                <div className="cv-agent-actions">
                  <AgentAction
                    agent={agent}
                    onOpen={() => onOpenAgent(agent.id)}
                    onGet={() => onGetAgent(agent.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </FormSection>

        <FormSection
          className="cv-api"
          title="API"
          footnote="Works with any OpenAI-compatible app, such as Cursor, Continue or Open WebUI. Anthropic-style apps use the same address without /v1."
        >
          <FormGroup>
            <FormRow
              label="Base URL"
              control={
                <span className="cv-copy-row">
                  <MonoValue>{api.baseUrl}</MonoValue>
                  <CopyButton text={api.baseUrl} label="Copy base URL" copy={copyText} />
                </span>
              }
            />
            <FormRow
              label="API key"
              help={
                api.apiKey === null
                  ? 'Not required. Apps that insist on a key can send this.'
                  : undefined
              }
              control={
                <span className="cv-copy-row">
                  <ApiKeyControl apiKey={api.apiKey} copyText={copyText} />
                </span>
              }
            />
            <FormRow
              label="Model"
              control={
                <span className="cv-copy-row">
                  <MonoValue>{api.model}</MonoValue>
                  <CopyButton text={api.model} label="Copy model name" copy={copyText} />
                </span>
              }
            />
          </FormGroup>
        </FormSection>
      </div>
    </ScrollEdge>
  );
}
