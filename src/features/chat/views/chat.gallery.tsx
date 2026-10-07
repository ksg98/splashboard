import type { GalleryEntry } from '@/app/gallery/types';
import { ChatWindowDemo, ComposerDemo, SidebarHistoryDemo, ThreadScrolledDemo } from './chat.demos';
import {
  cancelledTurns,
  doneTurns,
  draftAttachments,
  draftText,
  engineBusy,
  engineStarting,
  engineStopped,
  errorTurns,
  streamingTurns,
  thinkingTurns,
} from './fixtures';

const GROUP = 'Chat';

export const gallery: GalleryEntry[] = [
  {
    id: 'chat-thinking',
    title: 'Chat: thinking (live reasoning, stop button)',
    group: GROUP,
    frame: 'window',
    render: () => (
      <ChatWindowDemo turns={thinkingTurns} engine={engineBusy} composer={{ generating: true }} />
    ),
  },
  {
    id: 'chat-streaming',
    title: 'Chat: streaming answer',
    group: GROUP,
    frame: 'window',
    render: () => (
      <ChatWindowDemo turns={streamingTurns} engine={engineBusy} composer={{ generating: true }} />
    ),
  },
  {
    id: 'chat-done',
    title: 'Chat: done, draft with an image',
    group: GROUP,
    frame: 'window',
    render: () => (
      <ChatWindowDemo
        turns={doneTurns}
        composer={{ initialValue: draftText, initialAttachments: draftAttachments }}
      />
    ),
  },
  {
    id: 'chat-thought-expanded',
    title: 'Chat: "Thought for 6 seconds" expanded',
    group: GROUP,
    frame: 'window',
    render: () => <ChatWindowDemo turns={doneTurns} defaultThoughtOpen={['a3']} />,
  },
  {
    id: 'chat-stats',
    title: 'Chat: per-turn stats line',
    group: GROUP,
    frame: 'window',
    render: () => (
      <ChatWindowDemo
        turns={thinkingTurns}
        engine={engineBusy}
        composer={{ generating: true }}
        initialTurnId="u2"
        defaultStatsOpen="a2"
      />
    ),
  },
  {
    id: 'chat-effort',
    title: 'Chat: thinking menu',
    group: GROUP,
    frame: 'window',
    render: () => (
      <ChatWindowDemo
        turns={thinkingTurns}
        engine={engineBusy}
        composer={{ generating: true, defaultEffortMenuOpen: true }}
      />
    ),
  },
  {
    id: 'chat-model-menu',
    title: 'Chat: model menu (Splash and MLX only)',
    group: GROUP,
    frame: 'window',
    render: () => <ChatWindowDemo turns={doneTurns} modelMenuOpen />,
  },
  {
    id: 'chat-stopped',
    title: 'Chat: server stopped, draft (Send starts it)',
    group: GROUP,
    frame: 'window',
    render: () => (
      <ChatWindowDemo
        turns={doneTurns}
        engine={engineStopped}
        composer={{ initialValue: draftText, initialAttachments: draftAttachments }}
      />
    ),
  },
  {
    id: 'chat-starting',
    title: 'Chat: server starting',
    group: GROUP,
    frame: 'window',
    render: () => <ChatWindowDemo turns={doneTurns} engine={engineStarting} />,
  },
  {
    id: 'chat-error',
    title: 'Chat: reply failed, Retry',
    group: GROUP,
    frame: 'window',
    render: () => <ChatWindowDemo turns={errorTurns} />,
  },
  {
    id: 'chat-cancelled',
    title: 'Chat: reply stopped by the user',
    group: GROUP,
    frame: 'window',
    render: () => <ChatWindowDemo turns={cancelledTurns} defaultStatsOpen="a3" />,
  },
  {
    id: 'chat-jump-to-latest',
    title: 'Thread scrolled up: Jump to latest',
    group: GROUP,
    frame: 'centered',
    render: () => <ThreadScrolledDemo />,
  },
  {
    id: 'chat-new',
    title: 'New chat: empty state',
    group: GROUP,
    frame: 'window',
    render: () => <ChatWindowDemo />,
  },
  {
    id: 'chat-new-stopped',
    title: 'New chat: server stopped',
    group: GROUP,
    frame: 'window',
    render: () => <ChatWindowDemo engine={engineStopped} />,
  },
  {
    id: 'chat-search',
    title: 'Search chats (⌘K): open',
    group: GROUP,
    frame: 'window',
    render: () => <ChatWindowDemo turns={doneTurns} search={{ query: '' }} />,
  },
  {
    id: 'chat-search-results',
    title: 'Search chats (⌘K): results for "Splash"',
    group: GROUP,
    frame: 'window',
    render: () => <ChatWindowDemo turns={doneTurns} search={{ query: 'Splash' }} />,
  },
  {
    id: 'chat-search-empty',
    title: 'Search chats (⌘K): no results',
    group: GROUP,
    frame: 'window',
    render: () => <ChatWindowDemo turns={doneTurns} search={{ query: 'benchmark' }} />,
  },
  {
    id: 'chat-sidebar-search',
    title: 'Sidebar history filtered for "Splash"',
    group: GROUP,
    frame: 'window',
    render: () => <ChatWindowDemo turns={doneTurns} sidebarQuery="Splash" />,
  },
  {
    id: 'chat-sidebar-history',
    title: 'Sidebar history: groups, current row, hover ⋯',
    group: GROUP,
    frame: 'centered',
    render: () => <SidebarHistoryDemo />,
  },
  {
    id: 'chat-sidebar-rename',
    title: 'Sidebar history: inline rename',
    group: GROUP,
    frame: 'centered',
    render: () => <SidebarHistoryDemo renamingId="c-compare" />,
  },
  {
    id: 'chat-sidebar-empty-search',
    title: 'Sidebar history: no results',
    group: GROUP,
    frame: 'centered',
    render: () => <SidebarHistoryDemo query="benchmark" />,
  },
  {
    id: 'chat-composer',
    title: 'Composer: empty, draft, generating',
    group: GROUP,
    frame: 'centered',
    render: () => (
      <div style={{ display: 'grid', gap: 32, width: 760 }}>
        <ComposerDemo />
        <ComposerDemo initialValue={draftText} initialAttachments={draftAttachments} />
        <ComposerDemo generating initialEffort="high" />
        <ComposerDemo engine={engineStarting} initialEffort="none" />
      </div>
    ),
  },
];
