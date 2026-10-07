import { create } from 'zustand';

/** An agent `splash <agent>` can connect to the running server (Splash 1.2.0). */
export interface AgentConnector {
  id: 'claude' | 'opencode' | 'codex' | 'hermes' | 'pi';
  label: string;
}

export const AGENTS: AgentConnector[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'opencode', label: 'opencode' },
  { id: 'codex', label: 'Codex' },
  { id: 'hermes', label: 'Hermes' },
  { id: 'pi', label: 'pi' },
];

export interface ConnectState {
  agents: AgentConnector[];
  selectedAgent: AgentConnector['id'] | null;
  selectAgent: (id: AgentConnector['id'] | null) => void;
}

export const useConnectStore = create<ConnectState>()((set) => ({
  agents: AGENTS,
  selectedAgent: null,
  selectAgent: (selectedAgent) => set({ selectedAgent }),
}));
