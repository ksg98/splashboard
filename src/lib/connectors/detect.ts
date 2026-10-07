/**
 * Agent detection over the `connectors_detect` command
 * (src-tauri/src/pty/connectors.rs): which agents are on the login PATH, with
 * versions.
 */
import { invoke } from '@tauri-apps/api/core';
import { isAgentId, type AgentId } from './catalog';

export interface AgentDetection {
  id: AgentId;
  found: boolean;
  path: string | null;
  /** Parsed from `--version`, e.g. "2.0.14". */
  version: string | null;
  /** First line of `--version`, or why it could not be read. */
  versionOutput: string | null;
}

export interface ConnectorDetection {
  agents: AgentDetection[];
  /** The splash executable agent sessions run. */
  splashPath: string | null;
  /** The PATH sessions get. */
  searchPath: string;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Checks the wire shape; unknown agents are dropped. */
export function parseDetection(raw: unknown): ConnectorDetection {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const agents = (Array.isArray(r.agents) ? r.agents : []).flatMap((a: unknown) => {
    if (typeof a !== 'object' || a === null) return [];
    const x = a as Record<string, unknown>;
    if (!isAgentId(x.id)) return [];
    return [
      {
        id: x.id,
        found: x.found === true,
        path: nullableString(x.path),
        version: nullableString(x.version),
        versionOutput: nullableString(x.versionOutput),
      },
    ];
  });
  return {
    agents,
    splashPath: nullableString(r.splashPath),
    searchPath: nullableString(r.searchPath) ?? '',
  };
}

export async function detectConnectors(): Promise<ConnectorDetection> {
  try {
    return parseDetection(await invoke<unknown>('connectors_detect'));
  } catch (error) {
    if (error instanceof Error) throw error;
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error);
    throw new Error(message, { cause: error });
  }
}
