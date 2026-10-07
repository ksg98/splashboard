import { useEffect, useState } from 'react';
import { settingsInfo, settingsValues } from './fixtures';
import { SettingsDialog } from './SettingsDialog';
import type { SettingsInfo, SettingsTab, SettingsValues } from './types';
import './SettingsDemo.css';

export interface SettingsDemoProps {
  tab?: SettingsTab;
  values?: SettingsValues;
  info?: SettingsInfo;
  customizeOpen?: boolean;
  /** Scrolls the panel this far on load, to show the pinned title and its fade. */
  scrollTop?: number;
}

/** Gallery only: the Settings dialog over an empty window, editable on demo data. */
export function SettingsDemo({
  tab = 'general',
  values: initialValues = settingsValues,
  info = settingsInfo,
  customizeOpen = false,
  scrollTop = 0,
}: SettingsDemoProps) {
  const [open, setOpen] = useState(true);
  const [values, setValues] = useState(initialValues);

  useEffect(() => {
    if (!open || scrollTop === 0) return;
    // Wait for the panel to open and Customize to grow before scrolling.
    const timer = window.setTimeout(() => {
      document.querySelector('[data-settings-body]')?.scrollTo({ top: scrollTop });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [open, scrollTop]);

  return (
    <div className="sdemo-window">
      <div className="sdemo-sidebar" aria-hidden="true" />
      <div className="sdemo-main">
        {open ? null : (
          <button type="button" className="sdemo-reopen" onClick={() => setOpen(true)}>
            Open Settings
          </button>
        )}
      </div>
      <SettingsDialog
        open={open}
        onOpenChange={setOpen}
        defaultTab={tab}
        values={values}
        onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        info={info}
        defaultCustomizeOpen={customizeOpen}
        onTestToken={() => undefined}
        onChooseFolder={() => undefined}
        onManageModels={() => undefined}
        onCheckForUpdates={() => undefined}
        onUninstallSplash={() => undefined}
        onOpenLink={() => undefined}
      />
    </div>
  );
}
