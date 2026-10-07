import { clsx } from 'clsx';
import { Activity, Box, PanelLeft, Search, SquarePen, SquareTerminal, X } from 'lucide-react';
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { Kbd } from '@/components/ui/Kbd';
import { Tooltip, TooltipProvider } from '@/components/ui/Tooltip';
import { ariaShortcut, SHELL_SHORTCUTS, type ShellNavId } from './shortcuts';
import './AppShellView.css';

export type { ShellNavId } from './shortcuts';

export interface ShellSearchState {
  value: string;
  onChange: (value: string) => void;
  /** Esc, or leaving an empty field, returns to the "Search chats" row. */
  onClose: () => void;
  placeholder?: string;
}

export interface AppShellViewProps {
  /** Middle of the sidebar (SidebarHistory). Placed in a scrolling column with no padding of its own. */
  sidebarHistory?: ReactNode;
  /** Bottom of the sidebar (EngineStatusRow, which carries the Settings gear). */
  engineRow?: ReactNode;
  /** Left of the toolbar, after the collapsed-sidebar buttons (the chat puts ModelPickerTitle here). */
  toolbar?: ReactNode;
  /** The page. Fills the area under the toolbar; pages scroll inside themselves. */
  children?: ReactNode;
  /** Sidebar hidden (⌘\). The traffic lights stay; the toolbar gains Show sidebar, New chat and `toolbarEngine`. */
  collapsed?: boolean;
  onToggleSidebar: () => void;
  onNewChat: () => void;
  /** "Search chats" pressed. Pass `search` to swap the row for the inline field. */
  onSearch: () => void;
  /** The current destination; New chat and Search chats are actions and never take the selected fill. */
  activeNav?: ShellNavId | null;
  onNavigate: (id: ShellNavId) => void;

  /** Optional. While set, "Search chats" is an inline rounded field with a clear button. */
  search?: ShellSearchState | null;
  /** Optional. Shown at the toolbar's right end while the sidebar is hidden: ToolbarEngineChip in a Popover. */
  toolbarEngine?: ReactNode;
  /** Optional. Renders Activity, Models and Connect as links to these paths (clicks still go through onNavigate). */
  navHrefs?: Partial<Record<ShellNavId, string>>;
  /** Optional. Draws the macOS traffic lights (gallery and browser previews; Tauri draws the real ones). */
  trafficLights?: boolean;
  /** Optional. Id of the sidebar history region, for the search field's aria-controls. */
  historyId?: string;
  className?: string;
}

interface NavRowDef {
  id: Exclude<ShellNavId, 'chat'>;
  label: string;
  icon: ReactNode;
}

const ICON = { size: 18, strokeWidth: 1.5, 'aria-hidden': true } as const;

const DESTINATIONS: NavRowDef[] = [
  { id: 'activity', label: 'Activity', icon: <Activity {...ICON} /> },
  { id: 'models', label: 'Models', icon: <Box {...ICON} /> },
  { id: 'connect', label: 'Connect', icon: <SquareTerminal {...ICON} /> },
];

function isPlainClick(event: MouseEvent): boolean {
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0);
}

function SideRow({
  label,
  icon,
  shortcut,
  current = false,
  href,
  onActivate,
}: {
  label: string;
  icon: ReactNode;
  shortcut: string;
  current?: boolean;
  href?: string;
  onActivate: () => void;
}) {
  const content = (
    <>
      {icon}
      <span className="sb-side-item__label">{label}</span>
      <span className="sb-side-item__hint" aria-hidden>
        <Kbd>{shortcut}</Kbd>
      </span>
    </>
  );
  const shared = {
    className: 'sb-side-item',
    'aria-current': current ? ('page' as const) : undefined,
    'aria-keyshortcuts': ariaShortcut(shortcut),
  };
  return (
    <Tooltip content={label} shortcut={shortcut} side="right">
      {href ? (
        <a
          {...shared}
          href={href}
          onClick={(event) => {
            if (!isPlainClick(event)) return;
            event.preventDefault();
            onActivate();
          }}
        >
          {content}
        </a>
      ) : (
        <button {...shared} type="button" onClick={onActivate}>
          {content}
        </button>
      )}
    </Tooltip>
  );
}

function SearchField({ search, controls }: { search: ShellSearchState; controls?: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const { value, onChange, onClose, placeholder = 'Search chats' } = search;
  return (
    <div className="sb-side-search" role="search">
      <Search {...ICON} />
      <input
        ref={input}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label="Search chats"
        aria-controls={controls}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onChange('');
            onClose();
          }
        }}
        onBlur={() => {
          if (!value.trim()) onClose();
        }}
      />
      {value ? (
        <button
          type="button"
          className="sb-side-search__clear"
          aria-label="Clear search"
          // Keep focus in the field while the clear button is pressed.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          <X size={10} strokeWidth={2.8} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The window: a full-height 260 px sidebar (traffic lights over its top-left,
 * Hide sidebar at its top-right, New chat · Search chats · Activity · Models ·
 * Connect, the chat history, the engine row) and the main area with a 52 px
 * toolbar unified with the content. Presentational: every state comes in as
 * props and every action goes out through a callback.
 */
export function AppShellView({
  sidebarHistory,
  engineRow,
  toolbar,
  children,
  collapsed = false,
  onToggleSidebar,
  onNewChat,
  onSearch,
  activeNav = null,
  onNavigate,
  search = null,
  toolbarEngine,
  navHrefs,
  trafficLights = false,
  historyId = 'sb-sidebar-history',
  className,
}: AppShellViewProps) {
  return (
    <TooltipProvider>
      <div className={clsx('sb-shell', collapsed && 'is-collapsed', className)}>
        {trafficLights ? (
          <div className="sb-traffic" aria-hidden>
            <i />
            <i />
            <i />
          </div>
        ) : null}

        <aside
          className="sb-sidebar"
          aria-label="Sidebar"
          inert={collapsed}
          aria-hidden={collapsed || undefined}
        >
          <div className="sb-sidebar__inner">
            <div className="sb-sidebar__head" data-tauri-drag-region>
              <Tooltip
                content="Hide sidebar"
                shortcut={SHELL_SHORTCUTS.toggleSidebar}
                side="bottom"
              >
                <IconButton
                  label="Hide sidebar"
                  icon={<PanelLeft {...ICON} />}
                  aria-keyshortcuts={ariaShortcut(SHELL_SHORTCUTS.toggleSidebar)}
                  onClick={onToggleSidebar}
                />
              </Tooltip>
            </div>

            <nav className="sb-sidebar__nav" aria-label="Main">
              <SideRow
                label="New chat"
                icon={<SquarePen {...ICON} />}
                shortcut={SHELL_SHORTCUTS.newChat}
                onActivate={onNewChat}
              />
              {search ? (
                <SearchField search={search} controls={historyId} />
              ) : (
                <SideRow
                  label="Search chats"
                  icon={<Search {...ICON} />}
                  shortcut={SHELL_SHORTCUTS.search}
                  onActivate={onSearch}
                />
              )}
              <div className="sb-sidebar__gap" aria-hidden />
              {DESTINATIONS.map((row) => (
                <SideRow
                  key={row.id}
                  label={row.label}
                  icon={row.icon}
                  shortcut={SHELL_SHORTCUTS[row.id]}
                  current={activeNav === row.id}
                  href={navHrefs?.[row.id]}
                  onActivate={() => onNavigate(row.id)}
                />
              ))}
            </nav>

            <div className="sb-sidebar__history" id={historyId}>
              {sidebarHistory}
            </div>

            <div className="sb-sidebar__foot">{engineRow}</div>
          </div>
        </aside>

        <div className="sb-main">
          <header className="sb-toolbar" data-tauri-drag-region>
            {collapsed ? (
              <>
                <Tooltip
                  content="Show sidebar"
                  shortcut={SHELL_SHORTCUTS.toggleSidebar}
                  side="bottom"
                >
                  <IconButton
                    label="Show sidebar"
                    icon={<PanelLeft {...ICON} />}
                    aria-keyshortcuts={ariaShortcut(SHELL_SHORTCUTS.toggleSidebar)}
                    onClick={onToggleSidebar}
                  />
                </Tooltip>
                <Tooltip content="New chat" shortcut={SHELL_SHORTCUTS.newChat} side="bottom">
                  <IconButton
                    label="New chat"
                    icon={<SquarePen {...ICON} />}
                    aria-keyshortcuts={ariaShortcut(SHELL_SHORTCUTS.newChat)}
                    onClick={onNewChat}
                  />
                </Tooltip>
              </>
            ) : null}
            {toolbar}
            <div className="sb-toolbar__spacer" data-tauri-drag-region />
            {collapsed ? toolbarEngine : null}
          </header>
          <main className="sb-main__content" id="main">
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
