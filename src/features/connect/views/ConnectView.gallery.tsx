import type { GalleryEntry } from '@/app/gallery/types';
import { ConnectDemo } from './ConnectDemo';
import { agentsMixed, apiNoKey, engineStarting, engineStopped } from './fixtures';

export const gallery: GalleryEntry[] = [
  {
    id: 'connect-view',
    title: 'Connect',
    group: 'Connect',
    frame: 'fill',
    render: () => <ConnectDemo />,
  },
  {
    id: 'connect-view-stopped',
    title: 'Connect (server stopped)',
    group: 'Connect',
    frame: 'fill',
    render: () => <ConnectDemo engine={engineStopped} />,
  },
  {
    id: 'connect-view-starting',
    title: 'Connect (server starting)',
    group: 'Connect',
    frame: 'fill',
    render: () => <ConnectDemo engine={engineStarting} />,
  },
  {
    id: 'connect-view-states',
    title: 'Connect (session running, checking, no API key)',
    group: 'Connect',
    frame: 'fill',
    render: () => <ConnectDemo agents={agentsMixed} api={apiNoKey} />,
  },
  {
    id: 'connect-terminal',
    title: 'Agent terminal (Claude Code running)',
    group: 'Connect',
    frame: 'fill',
    render: () => <ConnectDemo terminalOpen />,
  },
  {
    id: 'connect-terminal-starting',
    title: 'Agent terminal (server starting)',
    group: 'Connect',
    frame: 'fill',
    render: () => <ConnectDemo engine={engineStarting} terminalOpen terminalStatus="starting" />,
  },
  {
    id: 'connect-terminal-exited',
    title: 'Agent terminal (session ended)',
    group: 'Connect',
    frame: 'fill',
    render: () => <ConnectDemo terminalOpen terminalStatus="exited" />,
  },
];
