/**
 * Connector detection state (zustand). `detect()` asks Rust which agents are
 * installed; in a plain browser the status is 'unavailable'.
 */
import { create } from 'zustand';
import { isTauri } from '../env';
import { CONNECTORS, type AgentId, type ConnectorDef } from './catalog';
import { detectConnectors, type AgentDetection } from './detect';

export type DetectionStatus = 'idle' | 'detecting' | 'ready' | 'error' | 'unavailable';

export interface ConnectorsState {
  status: DetectionStatus;
  agents: Partial<Record<AgentId, AgentDetection>>;
  splashPath: string | null;
  searchPath: string | null;
  error: string | null;
  /** Epoch ms of the last successful detection. */
  detectedAt: number | null;
  /** Runs detection; concurrent calls share one run. */
  detect: () => Promise<void>;
}

let inFlight: Promise<void> | null = null;

const initial = {
  status: 'idle' as DetectionStatus,
  agents: {},
  splashPath: null,
  searchPath: null,
  error: null,
  detectedAt: null,
};

export const useConnectorsStore = create<ConnectorsState>()((set) => ({
  ...initial,
  detect: () => {
    if (!isTauri()) {
      set({ status: 'unavailable', error: null });
      return Promise.resolve();
    }
    if (inFlight) return inFlight;
    set({ status: 'detecting', error: null });
    inFlight = detectConnectors()
      .then((result) => {
        const agents: Partial<Record<AgentId, AgentDetection>> = {};
        for (const agent of result.agents) agents[agent.id] = agent;
        set({
          status: 'ready',
          agents,
          splashPath: result.splashPath,
          searchPath: result.searchPath,
          detectedAt: Date.now(),
        });
      })
      .catch((error: unknown) => {
        set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },
}));

/** Restores the initial state (tests). */
export function resetConnectorsStore(): void {
  inFlight = null;
  useConnectorsStore.setState(initial);
}

export interface ConnectorEntry {
  def: ConnectorDef;
  detection: AgentDetection | null;
  installed: boolean;
}

/**
 * The catalog joined with detection results. Returns a new array: in a
 * component, memoise on `agents` (or select with `useShallow`).
 */
export function connectorEntries(
  agents: Partial<Record<AgentId, AgentDetection>>,
): ConnectorEntry[] {
  return CONNECTORS.map((def) => {
    const detection = agents[def.id] ?? null;
    return { def, detection, installed: detection?.found ?? false };
  });
}
