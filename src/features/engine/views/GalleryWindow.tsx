import { PanelLeft, SquarePen } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { EnginePopover, type EnginePopoverProps } from './EnginePopover';
import { EngineStatusRow } from './EngineStatusRow';
import { EngineToolbarChip } from './EngineToolbarChip';
import * as fx from './fixtures';
import './engine.gallery.css';

const noop = () => undefined;

const actions = {
  onRestart: noop,
  onStop: noop,
  onStart: noop,
  onOpenActivity: noop,
  onOpenLaunchSettings: noop,
  onOpenModels: noop,
};

export type GalleryEngineState = keyof typeof fx.popover;

/** The engine popover content for a demo state (gallery only). */
export function DemoEnginePopover({
  demo,
  ...extra
}: { demo: GalleryEngineState } & Partial<EnginePopoverProps>) {
  return <EnginePopover {...fx.popover[demo]} {...actions} {...extra} />;
}

/**
 * Gallery only: a stand-in for the app window (1440×900), the 260px sidebar
 * with the engine row at its foot and the main area under a 52px toolbar. The
 * real shell is built elsewhere; this only places the views where it puts them.
 */
export function GalleryWindow({
  children,
  state = 'busy',
  popoverOpen = false,
}: {
  children?: ReactNode;
  state?: GalleryEngineState;
  popoverOpen?: boolean;
}) {
  return (
    <div className="eng-gallery-window">
      <aside className="eng-gallery-sidebar" aria-label="Sidebar">
        <div className="eng-gallery-spacer" />
        <EngineStatusRow
          model={fx.DEMO_MODEL}
          state={fx.popover[state].state}
          popover={<DemoEnginePopover demo={state} />}
          onOpenSettings={noop}
          defaultOpen={popoverOpen}
        />
      </aside>
      <main className="eng-gallery-main">
        <div className="eng-gallery-toolbar" />
        <div className="eng-gallery-content">{children}</div>
      </main>
    </div>
  );
}

/** Gallery only: the window with the sidebar hidden and the engine chip open. */
export function GalleryCollapsedWindow({ state = 'busy' }: { state?: GalleryEngineState }) {
  return (
    <div className="eng-gallery-window is-collapsed">
      <main className="eng-gallery-main">
        <div className="eng-gallery-toolbar is-collapsed">
          <IconButton label="Show sidebar" icon={<PanelLeft strokeWidth={1.5} size={18} />} />
          <IconButton label="New chat" icon={<SquarePen strokeWidth={1.5} size={18} />} />
          <span className="eng-gallery-flex" />
          <EngineToolbarChip
            model={fx.DEMO_MODEL}
            state={fx.popover[state].state}
            popover={<DemoEnginePopover demo={state} />}
            defaultOpen
          />
        </div>
      </main>
    </div>
  );
}
