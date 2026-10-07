/** The window with demo slots, for shell.gallery.tsx. */
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { AppShellView } from './AppShellView';
import { demoEngineStates, demoHistory, demoModel } from './fixtures';
import {
  PlaceholderEngineRow,
  PlaceholderHistory,
  type ShellEngineState,
} from './ShellPlaceholders';
import type { ShellNavId } from './shortcuts';
import { ToolbarEngineChip } from './ToolbarEngineChip';

/** Stand-in for chat's ModelPickerTitle: 16 px semibold name and a chevron. */
function DemoModelTitle() {
  return (
    <button
      type="button"
      aria-haspopup="menu"
      className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-body font-semibold transition-colors duration-150 hover:bg-hover"
    >
      {demoModel}
      <ChevronDown size={14} strokeWidth={1.5} className="text-fg-secondary" aria-hidden />
    </button>
  );
}

function DemoNewChat() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 pb-[9vh]">
      <h1 className="text-title-1 leading-[34px] font-semibold">What can I help with?</h1>
    </div>
  );
}

function DemoPage({
  title,
  status,
  state,
}: {
  title: string;
  status: string;
  state: ShellEngineState;
}) {
  return (
    <div className="mx-auto w-full max-w-[var(--page-column)] px-[var(--page-gutter)] pt-1">
      <div className="flex items-center justify-between">
        <h1 className="text-title-1 leading-[34px] font-semibold">{title}</h1>
        {state.tone === 'off' ? <Button variant="primary">Start</Button> : null}
      </div>
      <p className="mt-0.5 leading-[18px] text-fg-secondary">{status}</p>
    </div>
  );
}

interface DemoProps {
  collapsed?: boolean;
  activeNav?: ShellNavId | null;
  activeId?: string | null;
  engine?: ShellEngineState;
  query?: string | null;
  page?: 'new-chat' | 'conversation' | 'activity' | 'models';
}

export function ShellDemo({
  collapsed: initialCollapsed = false,
  activeNav: initialNav = null,
  activeId: initialId = null,
  engine = demoEngineStates.ready,
  query: initialQuery = null,
  page = 'new-chat',
}: DemoProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [activeNav, setActiveNav] = useState<ShellNavId | null>(initialNav);
  const [activeId, setActiveId] = useState<string | null>(initialId);
  const [query, setQuery] = useState<string | null>(initialQuery);

  const showChatTitle = activeNav === null;
  let content = <DemoNewChat />;
  if (activeNav === 'activity') {
    content = (
      <DemoPage
        title="Activity"
        state={engine}
        status={
          engine.tone === 'off'
            ? 'Stopped · last ran today at 11:27'
            : `${engine.label} · ${demoModel} · up 2 h 14 min`
        }
      />
    );
  } else if (activeNav === 'models') {
    content = (
      <DemoPage
        title="Models"
        state={engine}
        status="Splash runs one model at a time. Models use 38.0 GB on this Mac."
      />
    );
  } else if (activeNav === 'connect') {
    content = (
      <DemoPage
        title="Connect"
        state={engine}
        status="Point coding agents at Splash on 127.0.0.1:8000."
      />
    );
  } else if (page === 'conversation' && activeId) {
    content = <div className="flex-1" />;
  }

  return (
    <AppShellView
      trafficLights
      collapsed={collapsed}
      onToggleSidebar={() => setCollapsed((value) => !value)}
      onNewChat={() => {
        setActiveNav(null);
        setActiveId(null);
      }}
      onSearch={() => setQuery('')}
      search={
        query === null ? null : { value: query, onChange: setQuery, onClose: () => setQuery(null) }
      }
      activeNav={activeNav}
      onNavigate={(id) => {
        setActiveNav(id === 'chat' ? null : id);
        if (id !== 'chat') setActiveId(null);
      }}
      toolbar={showChatTitle ? <DemoModelTitle /> : null}
      toolbarEngine={<ToolbarEngineChip model={demoModel} state={engine} />}
      sidebarHistory={
        <PlaceholderHistory
          groups={demoHistory}
          activeId={activeNav ? null : activeId}
          query={query ?? ''}
          onSelect={(id) => {
            setActiveId(id);
            setActiveNav(null);
          }}
        />
      }
      engineRow={
        <PlaceholderEngineRow model={demoModel} state={engine} onOpenSettings={() => undefined} />
      }
    >
      {content}
    </AppShellView>
  );
}
