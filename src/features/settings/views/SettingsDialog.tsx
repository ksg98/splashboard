import { CircleArrowDown, Download, Info, MessageCircle, Settings } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { useId, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogCloseButton, ScrollEdge } from '@/components/ui/Dialog';
import { AboutPane } from './AboutPane';
import { ChatPane } from './ChatPane';
import { GeneralPane } from './GeneralPane';
import { ModelsPane } from './ModelsPane';
import type { SettingsActions, SettingsInfo, SettingsTab, SettingsValues } from './types';
import { UpdatesPane } from './UpdatesPane';
import './SettingsDialog.css';

const TABS: { value: SettingsTab; label: string; icon: ReactNode }[] = [
  { value: 'general', label: 'General', icon: <Settings size={16} strokeWidth={1.5} /> },
  { value: 'chat', label: 'Chat', icon: <MessageCircle size={16} strokeWidth={1.5} /> },
  { value: 'models', label: 'Models & downloads', icon: <Download size={16} strokeWidth={1.5} /> },
  { value: 'updates', label: 'Updates', icon: <CircleArrowDown size={16} strokeWidth={1.5} /> },
  { value: 'about', label: 'About', icon: <Info size={16} strokeWidth={1.5} /> },
];

export interface SettingsDialogProps extends SettingsActions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selected tab (controlled). Leave out to let the dialog keep it. */
  tab?: SettingsTab;
  /** The first tab when uncontrolled. Default "general". */
  defaultTab?: SettingsTab;
  onTabChange?: (tab: SettingsTab) => void;
  values: SettingsValues;
  /** Every edit, as a patch of the values that changed. */
  onChange: (patch: Partial<SettingsValues>) => void;
  info: SettingsInfo;
  /** Opens Chat › Customize on first render (previews, deep links). */
  defaultCustomizeOpen?: boolean;
}

/**
 * Settings, laid out like ChatGPT's: ✕ top left, a vertical tab list, and
 * System Settings inset groups on the right under a page title that stays
 * put while the panel scrolls (rows fade out under it over 16 px).
 */
export function SettingsDialog({
  open,
  onOpenChange,
  tab: tabProp,
  defaultTab = 'general',
  onTabChange,
  values,
  onChange,
  info,
  defaultCustomizeOpen,
  ...actions
}: SettingsDialogProps) {
  const [tabState, setTabState] = useState<SettingsTab>(defaultTab);
  const tab = tabProp ?? tabState;
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const current = TABS.find((candidate) => candidate.value === tab) ?? TABS[0]!;
  const pane = { values, onChange, info, actions };

  const selectTab = (next: string) => {
    const match = TABS.find((candidate) => candidate.value === next);
    if (!match) return;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    if (tabProp === undefined) setTabState(match.value);
    onTabChange?.(match.value);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      layout="bare"
      width={800}
      height={620}
      className="sd-dialog"
    >
      <Tabs.Root
        className="sd-root"
        orientation="vertical"
        value={tab}
        onValueChange={selectTab}
        activationMode="automatic"
      >
        <div className="sd-nav">
          <DialogCloseButton label="Close settings" className="sd-close" />
          <Tabs.List className="sd-tabs" aria-label="Settings sections">
            {TABS.map((item) => (
              <Tabs.Trigger key={item.value} value={item.value} className="sd-tab">
                <span className="sd-tab-icon" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>

        <div className="sd-main">
          <div className="sd-head">
            <h2 className="sd-title" id={titleId}>
              {current.label}
            </h2>
          </div>
          <ScrollEdge ref={bodyRef} className="sd-body" data-settings-body>
            <Tabs.Content value="general" className="sd-panel" aria-labelledby={titleId}>
              <GeneralPane {...pane} />
            </Tabs.Content>
            <Tabs.Content value="chat" className="sd-panel" aria-labelledby={titleId}>
              <ChatPane {...pane} defaultCustomizeOpen={defaultCustomizeOpen} />
            </Tabs.Content>
            <Tabs.Content value="models" className="sd-panel" aria-labelledby={titleId}>
              <ModelsPane {...pane} />
            </Tabs.Content>
            <Tabs.Content value="updates" className="sd-panel" aria-labelledby={titleId}>
              <UpdatesPane {...pane} />
            </Tabs.Content>
            <Tabs.Content value="about" className="sd-panel" aria-labelledby={titleId}>
              <AboutPane {...pane} />
            </Tabs.Content>
          </ScrollEdge>
        </div>
      </Tabs.Root>
    </Dialog>
  );
}
