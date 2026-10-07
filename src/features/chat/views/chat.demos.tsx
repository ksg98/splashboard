/**
 * Gallery-only compositions of the chat views. The window frame here (traffic
 * lights, nav rows, engine row) is a static stand-in for the real shell, so
 * the chat states can be compared with design/minimal-ref/shots side by side.
 */
import { Activity, Box, Search, Settings, SquarePen, SquareTerminal } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { StatusDot, type StatusTone } from '@/components/ui/StatusDot';
import { ChatThread } from './ChatThread';
import { Composer, type ComposerProps } from './Composer';
import {
  activeChatId,
  doneTurns,
  engineReady,
  historyGroups,
  MODEL_NAME,
  pickerModels,
  pickerValue,
  searchableChats,
  suggestions,
} from './fixtures';
import { ModelPickerTitle } from './ModelPickerTitle';
import { NewChatEmptyState } from './NewChatEmptyState';
import { SearchChats } from './SearchChats';
import { SidebarHistory } from './SidebarHistory';
import type { ChatImage, ChatTurn, ComposerEngine, ThinkingEffort } from './types';
import './chat.demos.css';

const ENGINE_WORD: Record<ComposerEngine['state'], { word: string; tone: StatusTone }> = {
  ready: { word: 'Ready', tone: 'ok' },
  busy: { word: 'Thinking', tone: 'busy' },
  starting: { word: 'Starting…', tone: 'warn' },
  stopped: { word: 'Stopped', tone: 'off' },
};

function NavRow({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="chd-nav-row">
      {icon}
      <span>{label}</span>
    </div>
  );
}

interface ComposerDemoProps extends Partial<
  Omit<ComposerProps, 'value' | 'onChange' | 'effort' | 'onEffortChange'>
> {
  initialValue?: string;
  initialAttachments?: ChatImage[];
  initialEffort?: ThinkingEffort;
}

/** A composer with its own state, so the gallery can type, attach and pick. */
export function ComposerDemo({
  initialValue = '',
  initialAttachments = [],
  initialEffort = 'medium',
  ...rest
}: ComposerDemoProps) {
  const [value, setValue] = useState(initialValue);
  const [attachments, setAttachments] = useState<ChatImage[]>(initialAttachments);
  const [effort, setEffort] = useState<ThinkingEffort>(initialEffort);
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSubmit={() => {
        setValue('');
        setAttachments([]);
      }}
      onStop={() => undefined}
      attachments={attachments}
      onAddImages={(files) =>
        setAttachments((list) => [
          ...list,
          ...files.map((file) => ({
            id: `${file.name}-${file.size}-${list.length}`,
            name: file.name,
            src: URL.createObjectURL(file),
            sizeBytes: file.size,
          })),
        ])
      }
      onRemoveAttachment={(id) => setAttachments((list) => list.filter((image) => image.id !== id))}
      effort={effort}
      onEffortChange={setEffort}
      onStartEngine={() => undefined}
      {...rest}
    />
  );
}

export interface ChatWindowDemoProps {
  /** Omit for the new-chat empty state. */
  turns?: ChatTurn[];
  engine?: ComposerEngine;
  composer?: ComposerDemoProps;
  initialTurnId?: string;
  defaultStatsOpen?: string;
  defaultThoughtOpen?: string[];
  modelMenuOpen?: boolean;
  sidebarQuery?: string;
  search?: { query: string };
  activeId?: string | null;
}

/** A 1440×900 window: sidebar stand-in plus the chat views. */
export function ChatWindowDemo({
  turns,
  engine = engineReady,
  composer = {},
  initialTurnId,
  defaultStatsOpen,
  defaultThoughtOpen,
  modelMenuOpen,
  sidebarQuery,
  search,
  activeId = activeChatId,
}: ChatWindowDemoProps) {
  const [model, setModel] = useState(pickerValue);
  const [searchOpen, setSearchOpen] = useState(Boolean(search));
  const [query, setQuery] = useState(search?.query ?? '');
  const generating = composer.generating ?? false;
  const state = ENGINE_WORD[engine.state];

  return (
    <div className="chd-window">
      <aside className="chd-sidebar" aria-label="Sidebar">
        <div className="chd-traffic" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <div className="chd-nav">
          <NavRow icon={<SquarePen size={18} strokeWidth={1.5} />} label="New chat" />
          {sidebarQuery !== undefined ? (
            <div className="chd-side-search">
              <Search size={18} strokeWidth={1.5} />
              <span>{sidebarQuery}</span>
            </div>
          ) : (
            <NavRow icon={<Search size={18} strokeWidth={1.5} />} label="Search chats" />
          )}
          <div className="chd-gap" />
          <NavRow icon={<Activity size={18} strokeWidth={1.5} />} label="Activity" />
          <NavRow icon={<Box size={18} strokeWidth={1.5} />} label="Models" />
          <NavRow icon={<SquareTerminal size={18} strokeWidth={1.5} />} label="Connect" />
        </div>
        <div className="chd-history">
          <SidebarHistory
            groups={historyGroups}
            activeId={turns ? activeId : null}
            onSelect={() => undefined}
            onRename={() => undefined}
            onDelete={() => undefined}
            query={sidebarQuery}
          />
        </div>
        <div className="chd-engine">
          <StatusDot tone={state.tone} />
          <span className="chd-engine-name">{MODEL_NAME}</span>
          <span className="chd-engine-state">{state.word}</span>
          <Settings size={18} strokeWidth={1.5} className="chd-engine-gear" />
        </div>
      </aside>

      <main className="chd-main">
        <header className="chd-toolbar">
          <ModelPickerTitle
            models={pickerModels.map((entry) =>
              entry.id === pickerValue
                ? { ...entry, detail: `Splash package · ${state.word}` }
                : entry,
            )}
            value={model}
            onChange={setModel}
            onManageModels={() => undefined}
            defaultOpen={modelMenuOpen}
          />
        </header>

        {turns ? (
          <>
            <ChatThread
              turns={turns}
              modelName={MODEL_NAME}
              onRegenerate={() => undefined}
              onRetry={() => undefined}
              initialTurnId={initialTurnId}
              defaultStatsOpen={defaultStatsOpen}
              defaultThoughtOpen={defaultThoughtOpen}
            />
            <div className="chd-dock">
              <ComposerDemo engine={engine} generating={generating} {...composer} />
            </div>
          </>
        ) : (
          <NewChatEmptyState
            composer={<ComposerDemo engine={engine} autoFocus {...composer} />}
            suggestions={suggestions}
            onSelectSuggestion={() => undefined}
          />
        )}
      </main>

      {search && (
        <SearchChats
          open={searchOpen}
          onOpenChange={setSearchOpen}
          query={query}
          onQueryChange={setQuery}
          chats={searchableChats}
          onSelect={() => undefined}
        />
      )}
    </div>
  );
}

/** The sidebar list alone, at sidebar width, on the sidebar colour. */
export function SidebarHistoryDemo({
  query,
  renamingId,
  activeId = activeChatId,
}: {
  query?: string;
  renamingId?: string;
  activeId?: string | null;
}) {
  const [groups, setGroups] = useState(historyGroups);
  const [active, setActive] = useState(activeId);
  return (
    <div className="chd-sidebar chd-sidebar--alone">
      <SidebarHistory
        groups={groups}
        activeId={active}
        onSelect={setActive}
        onRename={(id, title) =>
          setGroups((list) =>
            list.map((group) => ({
              ...group,
              items: group.items.map((item) => (item.id === id ? { ...item, title } : item)),
            })),
          )
        }
        onDelete={(id) =>
          setGroups((list) =>
            list.map((group) => ({
              ...group,
              items: group.items.filter((item) => item.id !== id),
            })),
          )
        }
        query={query}
        defaultRenamingId={renamingId}
      />
    </div>
  );
}

/** The thread alone in a fixed-height box, scrolled up so "Jump to latest" shows. */
export function ThreadScrolledDemo() {
  return (
    <div className="chd-thread-box">
      <ChatThread turns={doneTurns} modelName={MODEL_NAME} initialTurnId="u1" />
    </div>
  );
}
