/*
 * Demo compositions of the overlay primitives for overlays.gallery.tsx, each
 * rendered open by default. Gallery only; not used by the app.
 */
import {
  ChevronDown,
  Info,
  Lightbulb,
  MoreHorizontal,
  Pencil,
  Settings,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { FormGroup, FormRow, FormSection, FormValue } from './Form';
import { IconButton } from './IconButton';
import { ContextMenu, Menu, type MenuItem } from './Menu';
import { Popover } from './Popover';
import { PopUpButton } from './PopUpButton';
import { dismissToast, toast, Toaster } from './Toast';
import { Tooltip } from './Tooltip';
import {
  engineSample,
  installedModels,
  presetOptions,
  thinkingOptions,
  thinkingPillLabel,
  versionOptions,
  type ModelId,
  type PresetId,
  type ThinkingLevel,
  type VersionId,
} from './overlays.fixtures';

const noop = () => undefined;

/** The window background behind an overlay, with the trigger placed where the app puts it. */
function Stage({
  children,
  align = 'center',
}: {
  children: ReactNode;
  align?: 'center' | 'top' | 'bottom';
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: align === 'top' ? 'flex-start' : align === 'bottom' ? 'flex-end' : 'center',
        padding: align === 'center' ? 32 : '120px 32px',
        boxSizing: 'border-box',
        background: 'var(--bg-window)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-sm)',
      }}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- Menus */

export function EngineActionsMenu() {
  const items: MenuItem[] = [
    { id: 'activity', label: 'Open Activity', shortcut: '⌘2', onSelect: noop },
    { id: 'models', label: 'Open Models', shortcut: '⌘3', onSelect: noop },
    { id: 'connect', label: 'Open Connect', shortcut: '⌘4', onSelect: noop },
    { type: 'separator' },
    { id: 'launch', label: 'Launch settings…', onSelect: noop },
  ];
  return (
    <Stage align="top">
      <Menu
        defaultOpen
        width={260}
        aria-label="Engine"
        items={items}
        trigger={
          <IconButton label="More engine actions" icon={<MoreHorizontal strokeWidth={1.5} />} />
        }
      />
    </Stage>
  );
}

export function ModelTitleMenu() {
  const [model, setModel] = useState<ModelId>('qwen3.8-27b');
  const current = installedModels.find((entry) => entry.id === model);
  const items: MenuItem[] = [
    ...installedModels.map((entry): MenuItem => ({
      id: entry.id,
      label: entry.name,
      description: entry.detail,
      checked: entry.id === model,
      onSelect: () => setModel(entry.id),
    })),
    { type: 'note', label: 'Switching models restarts the server.' },
    { type: 'separator' },
    { id: 'manage', label: 'Manage models…', onSelect: noop },
  ];
  return (
    <Stage align="top">
      <Menu
        defaultOpen
        width={300}
        aria-label="Model"
        items={items}
        trigger={
          <button
            type="button"
            aria-label={`Model: ${current?.name ?? ''}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 36,
              padding: '0 10px',
              border: 0,
              borderRadius: 'var(--radius-md)',
              background: 'var(--fill-hover)',
              color: 'var(--text-primary)',
              font: 'inherit',
              fontSize: 'var(--text-body)',
              fontWeight: 600,
            }}
          >
            {current?.name}
            <ChevronDown size={16} strokeWidth={1.5} color="var(--text-secondary)" aria-hidden />
          </button>
        }
      />
    </Stage>
  );
}

export function ConversationContextMenu() {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const timer = window.setTimeout(() => {
      row.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + 120,
          clientY: rect.top + rect.height / 2 + 6,
        }),
      );
    }, 50);
    return () => window.clearTimeout(timer);
  }, []);
  const items: MenuItem[] = [
    { id: 'rename', label: 'Rename', icon: <Pencil strokeWidth={1.5} />, onSelect: noop },
    { type: 'separator' },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 strokeWidth={1.5} />,
      destructive: true,
      onSelect: noop,
    },
  ];
  return (
    <Stage align="top">
      <ContextMenu items={items} aria-label="Conversation" width={200}>
        <div
          ref={rowRef}
          tabIndex={0}
          style={{
            width: 244,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--fill-selected)',
          }}
        >
          Time to first token in Python
        </div>
      </ContextMenu>
    </Stage>
  );
}

/* ---------------------------------------------------------------- Pop-ups */

export function VersionPopUp() {
  const [version, setVersion] = useState<VersionId>('mlx-community');
  return (
    <Stage align="top">
      <PopUpButton
        defaultOpen
        aria-label="Version of Qwen3.8-27B"
        heading="Version"
        note="Also on this Mac: Splash package."
        menuWidth={320}
        value={version}
        options={versionOptions}
        onChange={setVersion}
      />
    </Stage>
  );
}

export function ThinkingPopUp() {
  const [level, setLevel] = useState<ThinkingLevel>('medium');
  return (
    <Stage align="bottom">
      <PopUpButton
        defaultOpen
        variant="plain"
        side="top"
        aria-label="Thinking"
        heading="Thinking"
        menuWidth={260}
        icon={<Lightbulb strokeWidth={1.5} />}
        value={level}
        valueLabel={thinkingPillLabel[level]}
        options={thinkingOptions}
        onChange={setLevel}
      />
    </Stage>
  );
}

/* ---------------------------------------------------------------- Popover, tooltip */

export function InfoPopover() {
  return (
    <Stage align="top">
      <Popover
        defaultOpen
        width={280}
        aria-label="Draft acceptance"
        trigger={<IconButton label="About draft acceptance" icon={<Info strokeWidth={1.5} />} />}
      >
        <div style={{ padding: '8px 10px 10px' }}>
          <div style={{ fontWeight: 600 }}>Draft acceptance</div>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 'var(--text-xs)',
              lineHeight: 'var(--leading-read)',
              color: 'var(--text-secondary)',
            }}
          >
            The draft model proposes 7 tokens at a time and {engineSample.model} keeps{' '}
            {engineSample.acceptance.kept} of them on average, which is where most of the speed
            comes from.
          </p>
        </div>
      </Popover>
    </Stage>
  );
}

export function SettingsTooltip() {
  return (
    <Stage>
      <Tooltip open content="Settings" shortcut="⌘,">
        <IconButton label="Settings" icon={<Settings strokeWidth={1.5} />} />
      </Tooltip>
    </Stage>
  );
}

/* ---------------------------------------------------------------- Dialogs */

function LaunchSettingsBody() {
  const [preset, setPreset] = useState<PresetId>('recommended');
  const [thinking, setThinking] = useState<ThinkingLevel>('medium');
  return (
    <>
      <FormSection footnote="Qwen3.8-27B with a 32 GB SSD cache that keeps coding agents’ long prompts ready across restarts.">
        <FormGroup>
          <FormRow
            label="Preset"
            control={
              <PopUpButton
                aria-label="Preset"
                value={preset}
                options={presetOptions}
                onChange={setPreset}
              />
            }
          />
        </FormGroup>
      </FormSection>
      <FormSection title="Model">
        <FormGroup>
          <FormRow label="Model" control={<FormValue>{engineSample.model}</FormValue>} />
          <FormRow
            label="Draft model"
            help="Proposes 7 tokens at a time for the main model to check, which is where most of the speed comes from."
            control={<FormValue>Automatic</FormValue>}
          />
          <FormRow
            label="Default thinking"
            help="Used when an app doesn’t ask for a level."
            control={
              <PopUpButton
                aria-label="Default thinking"
                value={thinking}
                options={thinkingOptions}
                onChange={setThinking}
              />
            }
          />
        </FormGroup>
      </FormSection>
      <FormSection
        title="Memory & context"
        footnote="Automatic uses as much memory as macOS considers safe for the GPU. Coding agents need about 100K of context."
      >
        <FormGroup>
          <FormRow label="GPU memory limit" control={<FormValue>Automatic (48 GB)</FormValue>} />
          <FormRow
            label="Context length"
            help="Changed from Automatic (256K)"
            control={<FormValue>{engineSample.context}</FormValue>}
          />
          <FormRow label="Largest image size" control={<FormValue>4.2 MP</FormValue>} />
        </FormGroup>
      </FormSection>
      <FormSection title="Network & security">
        <FormGroup>
          <FormRow label="Port" control={<FormValue>8000</FormValue>} />
          <FormRow label="Listen on" control={<FormValue>This Mac only</FormValue>} />
          <FormRow
            label="Allowed web origins"
            control={<FormValue monospace>tauri://localhost</FormValue>}
          />
        </FormGroup>
      </FormSection>
    </>
  );
}

function RestartNote() {
  return (
    <>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'var(--status-warn)',
          flex: 'none',
        }}
      />
      Restart required to apply changes
    </>
  );
}

export function LaunchSettingsDialog({ scrolled = false }: { scrolled?: boolean }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!scrolled || !open) return;
    const timer = window.setTimeout(() => {
      const body = document.querySelector('.sb-dialog__body');
      if (body) body.scrollTop = 150;
    }, 50);
    return () => window.clearTimeout(timer);
  }, [scrolled, open]);
  return (
    <Stage>
      <Button onClick={() => setOpen(true)}>Launch settings</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Launch settings"
        description={`${engineSample.model} · ${engineSample.repo}`}
        height={820}
        footerNote={<RestartNote />}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Save and restart
            </Button>
          </>
        }
      >
        <LaunchSettingsBody />
      </Dialog>
    </Stage>
  );
}

export function UninstallDialog() {
  const [open, setOpen] = useState(true);
  return (
    <Stage>
      <Button onClick={() => setOpen(true)}>Uninstall Splash…</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        width={440}
        scroll={false}
        title="Uninstall Splash?"
        description="Splash 1.2.0 · 127.0.0.1:8000"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => setOpen(false)}>
              Uninstall
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, lineHeight: 'var(--leading-read)', color: 'var(--text-secondary)' }}>
          The server stops and Splash is removed from this Mac. Downloaded models stay where they
          are, so you can remove them in Models.
        </p>
      </Dialog>
    </Stage>
  );
}

/* ---------------------------------------------------------------- Toasts */

export function ToastStack() {
  useEffect(() => {
    const ids = [
      toast('Copied to clipboard', { duration: Infinity, id: 'gallery-copied' }),
      toast('Chat deleted', {
        duration: Infinity,
        id: 'gallery-deleted',
        action: { label: 'Undo', onClick: noop },
      }),
      toast('Couldn’t reach Splash at 127.0.0.1:8000', {
        duration: Infinity,
        tone: 'error',
        id: 'gallery-error',
        action: { label: 'Retry', onClick: noop },
      }),
    ];
    return () => ids.forEach(dismissToast);
  }, []);
  return (
    <Stage>
      <Button onClick={() => toast('Copied to clipboard')}>Show a toast</Button>
      <Toaster />
    </Stage>
  );
}
