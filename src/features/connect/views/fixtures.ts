/**
 * Demo props for the Connect views (gallery and tests). Values match the
 * reference: MacBook Pro M3 Max 64 GB, Qwen3.8-27B (the Splash package),
 * Splash 1.2.0 on 127.0.0.1:8000.
 */
import type { ConnectAgent, ConnectApi, ConnectEngine } from './types';

export const engineReady: ConnectEngine = { model: 'Qwen3.8-27B', state: 'ready' };
export const engineStarting: ConnectEngine = { model: 'Qwen3.8-27B', state: 'starting' };
export const engineStopped: ConnectEngine = { model: 'Qwen3.8-27B', state: 'stopped' };

export const agents: ConnectAgent[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    description: 'Anthropic’s agent, with every model tier mapped to Qwen3.8-27B',
    status: 'installed',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Open-source agent with plan and build modes',
    status: 'installed',
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI’s agent, with hosted web search turned off',
    status: 'installed',
  },
  {
    id: 'hermes',
    name: 'Hermes',
    description: 'Nous Research’s agent with tools and memory',
    status: 'not-installed',
  },
  {
    id: 'pi',
    name: 'Pi',
    description: 'A small agent you can extend',
    status: 'installed',
  },
];

/** Claude Code hidden with its session still going; Pi still being looked for. */
export const agentsMixed: ConnectAgent[] = agents.map((agent) =>
  agent.id === 'claude'
    ? { ...agent, status: 'running' }
    : agent.id === 'pi'
      ? { ...agent, status: 'checking' }
      : agent,
);

export const api: ConnectApi = {
  baseUrl: 'http://127.0.0.1:8000/v1',
  apiKey: 'sk-splash-2b9c41e07d5a7f3a',
  model: 'incoai/Qwen3.8-27B-Splash',
};

export const apiNoKey: ConnectApi = { ...api, apiKey: null };

export const terminal = {
  agent: { id: 'claude', name: 'Claude Code' },
  folder: '~/Projects/splashboard',
  model: 'Qwen3.8-27B',
  port: 8000,
} as const;

/** One piece of a transcript line: plain, dim (tool details) or bold (prompts). */
export type TranscriptSegment = string | { dim: string } | { b: string };

export type TranscriptLine =
  TranscriptSegment[] | { box: TranscriptSegment[][] } | { input: true; hint: string };

/** A static Claude Code session, for previews of the terminal sheet. */
export const claudeTranscript: TranscriptLine[] = [
  [{ dim: 'splashboard %' }, ' splash claude'],
  ['Starting Claude Code: incoai/Qwen3.8-27B-Splash · 131072 context tokens'],
  [],
  {
    box: [
      [{ b: 'Claude Code' }],
      [{ dim: 'Model     incoai/Qwen3.8-27B-Splash (via Splash)' }],
      [{ dim: 'Folder    ~/Projects/splashboard' }],
    ],
  },
  [],
  [{ b: '> Make the status poller back off while the window is hidden' }],
  [],
  ['  Read ', { dim: 'src/engine/useStatus.ts (84 lines)' }],
  ['  Read ', { dim: 'src/engine/client.ts (126 lines)' }],
  ['  Search ', { dim: '"visibilitychange" in src (0 results)' }],
  [],
  ['  The poller asks /status every 500 ms, even when the window is hidden.'],
  ['  I’ll poll every 2 s while it’s hidden and stop when the server is stopped.'],
  [],
  ['  Edit ', { dim: 'src/engine/useStatus.ts (+14 −3)' }],
  [{ dim: '     31  -  const interval = 500;' }],
  [{ dim: '     31  +  const interval = document.hidden ? 2000 : 500;' }],
  [{ dim: '     32  +  useEffect(() => {' }],
  [{ dim: '     33  +    const onChange = () => schedule(document.hidden ? 2000 : 500);' }],
  [{ dim: '     34  +    document.addEventListener("visibilitychange", onChange);' }],
  ['  Run ', { dim: 'npm test -- useStatus (12 passed, 0.8 s)' }],
  [],
  ['  Done. Polling drops to 0.5 Hz in the background and stops when the'],
  ['  server is stopped, so a hidden window costs almost nothing.'],
  [],
  [{ b: '> Also skip a poll if the previous one hasn’t returned yet' }],
  [],
  ['  Read ', { dim: 'src/engine/useStatus.ts (95 lines)' }],
  ['  Edit ', { dim: 'src/engine/useStatus.ts (+6 −1)' }],
  ['  Run ', { dim: 'npm test -- useStatus (13 passed, 0.8 s)' }],
  [],
  ['  Added an in-flight flag. A slow /status reply now delays the next poll'],
  ['  instead of stacking requests behind it.'],
  [],
  [{ b: '> Run the whole suite before I commit' }],
  [],
  ['  Run ', { dim: 'npm test (148 passed, 6.4 s)' }],
  [],
  ['  All 148 tests pass. The change is ready to commit.'],
  [],
  { input: true, hint: '  ? for shortcuts' },
];
