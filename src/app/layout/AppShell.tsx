import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { toast } from '@/components/ui/Toast';
import { groupConversations, useChatStore } from '@/lib/chat/store';
import { ModelPickerTitle } from '@/features/chat/views/ModelPickerTitle';
import { SidebarHistory } from '@/features/chat/views/SidebarHistory';
import { useEngineDisplay, useTelemetry } from '@/features/engine/useEngineDisplay';
import { EnginePopover } from '@/features/engine/views/EnginePopover';
import { EngineStatusRow } from '@/features/engine/views/EngineStatusRow';
import { EngineToolbarChip } from '@/features/engine/views/EngineToolbarChip';
import { Toaster } from '@/components/ui/Toast';
import { restartEngine, startEngine, useLaunchStore } from '@/lib/launch';
import { formatLabel, gigabytes, runnableModels } from '@/lib/models/runnable';
import { connectModelsEvents, useModelsStore } from '@/lib/models/store';
import { connectEngineEvents, useEngineStore } from '@/lib/splash/engine-store';
import { features } from '../features';
import { AppShellView } from './AppShellView';
import type { ShellNavId } from './shortcuts';
import { useShellShortcuts } from './useShellShortcuts';

const COLLAPSED_KEY = 'splashboard:sidebar-collapsed';

function featurePath(id: string, fallback: string): string {
  return `/${features.find((feature) => feature.id === id)?.path ?? fallback}`;
}

/** Sidebar destinations -> the feature routes that implement them. */
const NAV_PATHS: Record<ShellNavId, string> = {
  chat: featurePath('chat', 'chat'),
  activity: featurePath('engine', 'engine'),
  models: featurePath('models', 'models'),
  connect: featurePath('connect', 'connect'),
};
const SETTINGS_PATH = featurePath('settings', 'settings');

function navFromPath(pathname: string): ShellNavId | null {
  const match = (Object.keys(NAV_PATHS) as ShellNavId[]).find(
    (id) => pathname === NAV_PATHS[id] || pathname.startsWith(`${NAV_PATHS[id]}/`),
  );
  // "chat" is a conversation, highlighted by the history list, not a sidebar row.
  return match && match !== 'chat' ? match : null;
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function storeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(COLLAPSED_KEY, '1');
    else window.localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // Storage unavailable: the sidebar state lasts for this session only.
  }
}

function reportFailure(result: unknown, fallback: string) {
  if (result) return;
  toast(useEngineStore.getState().error?.message ?? fallback, { tone: 'error' });
}

/** The routed window frame: AppShellView around the active feature. */
export function AppShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [query, setQuery] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const loadChats = useChatStore((s) => s.load);
  const installed = useModelsStore((s) => s.installed);
  const catalog = useModelsStore((s) => s.catalog);
  const launchModel = useLaunchStore((s) => s.model);
  const display = useEngineDisplay();
  useTelemetry();

  useEffect(() => {
    void connectEngineEvents();
    void connectModelsEvents();
    void useEngineStore.getState().detect();
    void useLaunchStore.getState().load();
    void useModelsStore.getState().refreshAll();
    void loadChats();
  }, [loadChats]);

  const toggleSidebar = useCallback(() => {
    setCollapsed((current) => {
      storeCollapsed(!current);
      return !current;
    });
  }, []);
  const newChat = useCallback(() => {
    useChatStore.getState().newChat();
    void navigate(NAV_PATHS.chat);
  }, [navigate]);
  const openSearch = useCallback(() => {
    setCollapsed(false);
    storeCollapsed(false);
    setQuery((current) => current ?? '');
  }, []);
  const go = useCallback(
    (id: ShellNavId) => {
      setPopoverOpen(false);
      void navigate(NAV_PATHS[id]);
    },
    [navigate],
  );
  const openSettings = useCallback(() => {
    setPopoverOpen(false);
    void navigate(SETTINGS_PATH);
  }, [navigate]);
  const openLaunchSettings = useCallback(() => {
    setPopoverOpen(false);
    void navigate(`${NAV_PATHS.models}?launch=1`);
  }, [navigate]);

  useShellShortcuts({
    onNewChat: newChat,
    onSearch: openSearch,
    onToggleSidebar: toggleSidebar,
    onNavigate: go,
    onOpenSettings: openSettings,
  });

  const groups = useMemo(
    () =>
      groupConversations(conversations).map((group) => ({
        label: group.label,
        items: group.items.map((c) => ({ id: c.id, title: c.title })),
      })),
    [conversations],
  );

  const onChat = pathname === NAV_PATHS.chat || pathname.startsWith(`${NAV_PATHS.chat}/`);
  const runnable = useMemo(() => runnableModels(installed, catalog?.entries), [installed, catalog]);
  const pickerModels = useMemo(() => {
    const list = runnable.map((model) => ({
      id: model.model,
      name: model.name,
      detail: [
        formatLabel(model.format),
        model.model === display.repo ? display.word.label : gigabytes(model.sizeBytes),
      ]
        .filter(Boolean)
        .join(' · '),
    }));
    if (!list.some((entry) => entry.id === display.repo)) {
      list.unshift({ id: display.repo, name: display.model, detail: display.word.label });
    }
    return list;
  }, [runnable, display.repo, display.model, display.word.label]);

  const switchModel = useCallback(
    (model: string) => {
      if (model === launchModel && display.word.serving) return;
      useLaunchStore.getState().update({ model });
      if (!useEngineStore.getState().available) return;
      const action = display.word.serving || display.word.launching ? restartEngine() : startEngine(model);
      void action.then((result) => reportFailure(result, 'Splash could not start that model.'));
    },
    [launchModel, display.word.serving, display.word.launching],
  );

  const stats = display.stats;
  const popover = (
    <EnginePopover
      model={display.model}
      version={display.version}
      address={display.address}
      uptime={display.uptime}
      state={display.word}
      speed={stats?.tokensPerSecond}
      acceptance={stats?.draftAcceptance}
      memory={stats?.memoryUsedGB}
      phase={display.startPhase}
      lastRan={display.status.kind === 'stopped' ? display.status.lastRan : undefined}
      failure={display.status.kind === 'failed' ? display.status.reason : undefined}
      startNote={`Starts ${display.model} on ${display.address}.`}
      onStart={() => void startEngine().then((r) => reportFailure(r, 'Splash could not start.'))}
      onStop={() =>
        void useEngineStore
          .getState()
          .stop()
          .then((r) => reportFailure(r, 'Splash could not stop.'))
      }
      onRestart={() => void restartEngine().then((r) => reportFailure(r, 'Splash could not restart.'))}
      onOpenActivity={() => go('activity')}
      onOpenLaunchSettings={openLaunchSettings}
      onOpenModels={() => go('models')}
    />
  );

  return (
    <>
      <AppShellView
        collapsed={collapsed}
        onToggleSidebar={toggleSidebar}
        onNewChat={newChat}
        onSearch={openSearch}
        search={
          query === null
            ? null
            : { value: query, onChange: setQuery, onClose: () => setQuery(null) }
        }
        activeNav={navFromPath(pathname)}
        onNavigate={go}
        navHrefs={NAV_PATHS}
        sidebarHistory={
          <SidebarHistory
            groups={groups}
            activeId={onChat ? activeId : null}
            query={query ?? undefined}
            onSelect={(id) => {
              useChatStore.getState().selectConversation(id);
              void navigate(NAV_PATHS.chat);
            }}
            onRename={(id, title) => useChatStore.getState().rename(id, title)}
            onDelete={(id) => useChatStore.getState().remove(id)}
          />
        }
        engineRow={
          <EngineStatusRow
            model={display.model}
            state={display.word}
            popover={popover}
            onOpenSettings={openSettings}
            open={popoverOpen && !collapsed}
            onOpenChange={setPopoverOpen}
          />
        }
        toolbar={
          onChat ? (
            <ModelPickerTitle
              models={pickerModels}
              value={display.repo}
              onChange={switchModel}
              onManageModels={() => go('models')}
            />
          ) : null
        }
        toolbarEngine={
          <EngineToolbarChip
            model={display.model}
            state={display.word}
            popover={popover}
            open={popoverOpen && collapsed}
            onOpenChange={setPopoverOpen}
          />
        }
      >
        <Outlet />
      </AppShellView>
      {/* Mounted once per layout (AppShell or BareLayout, never both). */}
      <Toaster />
    </>
  );
}
