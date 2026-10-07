/** Gallery-only wrappers for the Models views (dev builds). */
import { useState, type ReactNode } from 'react';
import { modelsViewProps, modelsViewSearch } from './fixtures';
import { LaunchSettingsSheet } from './LaunchSettingsSheet';
import { ModelsView } from './ModelsView';
import type {
  LaunchRow,
  LaunchSection,
  LaunchSettingsSheetProps,
  LaunchValue,
  ModelsViewProps,
} from './types';

/**
 * Stand-in for the shell, so shots line up with the reference: a 260 px
 * sidebar-coloured strip and the 52 px toolbar line above the page.
 */
export function GalleryWindow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'var(--sidebar-width) minmax(0, 1fr)',
        width: '100vw',
        height: '100vh',
        background: 'var(--bg-window)',
      }}
    >
      <div style={{ background: 'var(--bg-sidebar)' }} aria-hidden />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div style={{ height: 'var(--toolbar-height)', flex: 'none' }} aria-hidden />
        <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
      </div>
    </div>
  );
}

/** The page with live search text, so the field can be typed into. */
export function ModelsDemo({ props }: { props: ModelsViewProps }) {
  const [query, setQuery] = useState(props.search.query);
  const search =
    query === props.search.query
      ? props.search
      : query.trim() === ''
        ? { query, status: 'idle' as const, results: [] }
        : { ...modelsViewSearch.search, query };
  return (
    <GalleryWindow>
      <ModelsView {...props} search={search} onSearchChange={setQuery} />
    </GalleryWindow>
  );
}

function updateRow(row: LaunchRow, key: string, value: LaunchValue): LaunchRow {
  if (row.key !== key) return row;
  if (row.control.kind === 'secret' && row.control.enabled !== undefined) {
    return { ...row, control: { ...row.control, enabled: value === true } };
  }
  return { ...row, control: { ...row.control, value } };
}

/** Launch settings over the Models page, with controls that move. */
export function LaunchDemo({ props }: { props: LaunchSettingsSheetProps }) {
  const [sections, setSections] = useState<LaunchSection[]>(props.sections);
  const [preset, setPreset] = useState(props.preset.value);
  const onChange = (key: string, value: LaunchValue) =>
    setSections((current) =>
      current.map((section) => ({
        ...section,
        rows: section.rows.map((row) => updateRow(row, key, value)),
        moreRows: section.moreRows?.map((row) => updateRow(row, key, value)),
      })),
    );
  return (
    <>
      <GalleryWindow>
        <ModelsView {...modelsViewProps} />
      </GalleryWindow>
      <LaunchSettingsSheet
        {...props}
        sections={sections}
        preset={{ ...props.preset, value: preset }}
        onPresetChange={setPreset}
        onChange={onChange}
      />
    </>
  );
}
