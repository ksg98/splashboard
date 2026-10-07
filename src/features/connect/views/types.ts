import type { AgentId } from '@/lib/connectors/catalog';

export type { AgentId };

/** The server state words used everywhere: Ready, Thinking, Starting…, Stopped. */
export type ConnectEngineState = 'ready' | 'busy' | 'starting' | 'stopped';

export interface ConnectEngine {
  /** Display name of the model the server runs (or will start), e.g. "Qwen3.8-27B". */
  model: string;
  state: ConnectEngineState;
}

/**
 * installed: Open. not-installed: "Not installed" and Get ↗ (the install page).
 * running: a session is open in Splashboard (Hidden); Show brings it back.
 * checking: still looking for the binary on PATH.
 */
export type AgentStatus = 'installed' | 'not-installed' | 'running' | 'checking';

export interface ConnectAgent {
  id: AgentId;
  name: string;
  /** One line, publisher first: "Anthropic’s agent, with every model tier mapped to Qwen3.8-27B". */
  description: string;
  status: AgentStatus;
}

export interface ConnectApi {
  /** OpenAI-compatible base URL, e.g. "http://127.0.0.1:8000/v1". */
  baseUrl: string;
  /** The server's API key, or null when the server doesn't require one. */
  apiKey: string | null;
  /** The model id clients send, e.g. "incoai/Qwen3.8-27B-Splash". */
  model: string;
}

/** What the terminal sheet's footer says about the agent session. */
export type TerminalStatus = 'starting' | 'running' | 'exited';
