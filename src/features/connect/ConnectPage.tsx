import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { displayModelName, engineWord, startEngine, useLaunchStore } from '@/lib/launch';
import {
  buildConnectorLaunch,
  connectorEntries,
  getConnector,
  useConnectorsStore,
  type AgentId,
} from '@/lib/connectors';
import { useEngineStore } from '@/lib/splash/engine-store';
import { createTerminalController, type TerminalController } from '@/lib/terminal/controller';
import { ConnectView } from './views/ConnectView';
import { TerminalSheet } from './views/TerminalSheet';
import type { ConnectAgent, ConnectEngineState, TerminalStatus } from './views/types';

const DESCRIPTIONS: Record<AgentId, string> = {
  claude: "Anthropic's coding agent, with every model tier mapped to this model",
  opencode: 'Open-source agent with plan and build modes',
  codex: "OpenAI's agent, with hosted web search turned off",
  hermes: "Nous Research's agent with tools and memory",
  pi: 'A small agent you can extend',
};

/** xterm colours for the dark terminal panel (the panel is dark in both themes). */
const TERMINAL_THEME = {
  background: '#1e1e1e',
  foreground: '#e6e6e6',
  cursor: '#e6e6e6',
  selectionBackground: '#3a3d41',
};

interface Session {
  agent: AgentId;
  status: TerminalStatus;
  exitCode: number | null;
  open: boolean;
}

async function openExternal(url: string) {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

export function ConnectPage() {
  const detection = useConnectorsStore((s) => s.agents);
  const status = useConnectorsStore((s) => s.status);
  const detect = useConnectorsStore((s) => s.detect);
  const engineState = useEngineStore((s) => s.state);
  const port = useLaunchStore((s) => s.port);
  const launchModel = useLaunchStore((s) => s.model);
  const [session, setSession] = useState<Session | null>(null);
  const controllerRef = useRef<TerminalController | null>(null);

  useEffect(() => {
    void detect();
  }, [detect]);

  useEffect(
    () => () => {
      controllerRef.current?.dispose({ kill: false });
    },
    [],
  );

  const word = engineWord(engineState);
  const enginePort = engineState.port ?? port;
  const repo = engineState.model ?? launchModel;
  const state: ConnectEngineState = word.serving
    ? engineState.phase === 'busy'
      ? 'busy'
      : 'ready'
    : word.launching
      ? 'starting'
      : 'stopped';

  const agents: ConnectAgent[] = useMemo(
    () =>
      connectorEntries(detection).map((entry) => ({
        id: entry.def.id,
        name: entry.def.label,
        description: DESCRIPTIONS[entry.def.id],
        status:
          session?.agent === entry.def.id && session.status !== 'exited'
            ? 'running'
            : status === 'detecting' || status === 'idle'
              ? 'checking'
              : entry.installed || status === 'unavailable'
                ? 'installed'
                : 'not-installed',
      })),
    [detection, status, session],
  );

  const launch = useCallback(
    async (agent: AgentId) => {
      const controller = controllerRef.current;
      if (!controller) return;
      if (!engineWord(useEngineStore.getState().state).serving) {
        setSession((s) => (s ? { ...s, status: 'starting' } : s));
        await startEngine();
        await new Promise<void>((resolve) => {
          const done = () =>
            engineWord(useEngineStore.getState().state).serving ||
            useEngineStore.getState().state.phase === 'failed';
          if (done()) return resolve();
          const unsubscribe = useEngineStore.subscribe(() => {
            if (done()) {
              unsubscribe();
              resolve();
            }
          });
        });
      }
      try {
        await controller.start(
          buildConnectorLaunch(agent, {
            port: useEngineStore.getState().state.port ?? port,
            splashVersion: useEngineStore.getState().install?.version ?? null,
          }),
        );
      } catch (error) {
        toast(
          error instanceof Error ? error.message : `Couldn't start ${getConnector(agent).label}.`,
          {
            tone: 'error',
          },
        );
      }
    },
    [port],
  );

  const elementRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef<AgentId | null>(null);

  /** A fresh terminal on `element`, starting `agent` in it. */
  const begin = useCallback(
    (element: HTMLElement, agent: AgentId) => {
      controllerRef.current?.dispose();
      const controller = createTerminalController({
        theme: TERMINAL_THEME,
        terminalOptions: {
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          fontSize: 13,
          cursorBlink: true,
        },
        onUnavailable: (message) => toast(message, { tone: 'error' }),
        onStatusChange: (next) =>
          setSession((s) => {
            if (!s) return s;
            if (next === 'running') return { ...s, status: 'running' };
            if (next === 'exited' || next === 'failed') return { ...s, status: 'exited' };
            return s;
          }),
        onExit: (exit) =>
          setSession((s) => (s ? { ...s, status: 'exited', exitCode: exit.code ?? null } : s)),
      });
      controllerRef.current = controller;
      controller.attach(element);
      controller.focus();
      void launch(agent);
    },
    [launch],
  );

  const mount = useCallback(
    (element: HTMLElement) => {
      elementRef.current = element;
      const agent = pendingRef.current;
      pendingRef.current = null;
      if (agent) begin(element, agent);
      else controllerRef.current?.fit();
      return () => {
        if (elementRef.current === element) elementRef.current = null;
      };
    },
    [begin],
  );

  const openAgent = (agent: AgentId) => {
    if (session && session.agent === agent && session.status !== 'exited') {
      setSession({ ...session, open: true });
      return;
    }
    controllerRef.current?.dispose();
    controllerRef.current = null;
    setSession({ agent, status: 'starting', exitCode: null, open: true });
    if (elementRef.current) begin(elementRef.current, agent);
    else pendingRef.current = agent;
  };

  return (
    <>
      <ConnectView
        engine={{ model: displayModelName(repo), state }}
        agents={agents}
        api={{ baseUrl: `http://127.0.0.1:${enginePort}/v1`, apiKey: null, model: repo }}
        onOpenAgent={openAgent}
        onGetAgent={(agent) => void openExternal(getConnector(agent).installUrl)}
      />
      {session && (
        <TerminalSheet
          open={session.open}
          agent={{ id: session.agent, name: getConnector(session.agent).label }}
          folder="~"
          model={displayModelName(repo)}
          port={enginePort}
          status={session.status}
          startingDetail={word.launching ? word.label : undefined}
          exitCode={session.exitCode}
          mount={mount}
          onHide={() => setSession({ ...session, open: false })}
          onEndSession={() => {
            void controllerRef.current?.kill();
            setSession(null);
            controllerRef.current?.dispose();
            controllerRef.current = null;
          }}
          onRestart={() => {
            setSession({ ...session, status: 'starting', exitCode: null, open: true });
            if (elementRef.current) begin(elementRef.current, session.agent);
          }}
        />
      )}
    </>
  );
}
