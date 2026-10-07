import type { GalleryEntry } from '@/app/gallery/types';
import { demoEngineStates } from './fixtures';
import { ShellDemo } from './shell.demos';

export const gallery: GalleryEntry[] = [
  {
    id: 'shell-window',
    title: 'Window, new chat (nothing selected)',
    group: 'Shell',
    frame: 'window',
    render: () => <ShellDemo />,
  },
  {
    id: 'shell-conversation',
    title: 'Window, conversation open, Thinking',
    group: 'Shell',
    frame: 'window',
    render: () => (
      <ShellDemo activeId="c-ttft" engine={demoEngineStates.thinking} page="conversation" />
    ),
  },
  {
    id: 'shell-models',
    title: 'Window, Models current',
    group: 'Shell',
    frame: 'window',
    render: () => <ShellDemo activeNav="models" />,
  },
  {
    id: 'shell-activity-stopped',
    title: 'Window, Activity current, server stopped',
    group: 'Shell',
    frame: 'window',
    render: () => <ShellDemo activeNav="activity" engine={demoEngineStates.stopped} />,
  },
  {
    id: 'shell-starting',
    title: 'Window, server starting',
    group: 'Shell',
    frame: 'window',
    render: () => <ShellDemo engine={demoEngineStates.starting} />,
  },
  {
    id: 'shell-collapsed',
    title: 'Window, sidebar hidden',
    group: 'Shell',
    frame: 'window',
    render: () => (
      <ShellDemo
        collapsed
        activeId="c-ttft"
        engine={demoEngineStates.thinking}
        page="conversation"
      />
    ),
  },
  {
    id: 'shell-search',
    title: 'Window, Search chats filtered to “Splash”',
    group: 'Shell',
    frame: 'window',
    render: () => <ShellDemo query="Splash" />,
  },
  {
    id: 'shell-search-empty',
    title: 'Window, Search chats with no match',
    group: 'Shell',
    frame: 'window',
    render: () => <ShellDemo query="benchmark" />,
  },
];
