/** Gallery boards for the basic primitives (basics.gallery.tsx). */
import {
  ArrowUp,
  ArrowUpRight,
  Copy,
  Info,
  PanelLeft,
  Plus,
  RotateCw,
  Settings,
  Square,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Kbd } from './Kbd';
import { ProgressRing } from './ProgressRing';
import { Spinner } from './Spinner';
import { StatusDot } from './StatusDot';

const ICON = { size: 18, strokeWidth: 1.5 } as const;

function Board({ children }: { children: ReactNode }) {
  return <div className="flex w-[880px] flex-col gap-7">{children}</div>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] items-center gap-4">
      <span className="text-xs text-fg-secondary">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Buttons() {
  return (
    <Board>
      <Section title="Button">
        <Row label="Primary">
          <Button variant="primary" size="sm">
            Start
          </Button>
          <Button variant="primary">Start</Button>
          <Button variant="primary" size="lg">
            Install Splash
          </Button>
          <Button variant="primary" disabled>
            Start
          </Button>
          <Button variant="primary" loading>
            Starting…
          </Button>
        </Row>
        <Row label="Secondary">
          <Button size="sm">Retry</Button>
          <Button>Restart</Button>
          <Button>Stop</Button>
          <Button size="lg">Cancel</Button>
          <Button disabled>Run</Button>
          <Button loading>Checking</Button>
        </Row>
        <Row label="Leaves Splashboard">
          <Button iconEnd={<ArrowUpRight strokeWidth={1.5} />}>Get</Button>
          <Button iconEnd={<ArrowUpRight strokeWidth={1.5} />}>Open in Terminal</Button>
        </Row>
        <Row label="Ghost (text button)">
          <Button variant="ghost">Start now</Button>
          <Button variant="ghost" size="sm">
            Regenerate…
          </Button>
          <Button variant="ghost" disabled>
            Start now
          </Button>
        </Row>
        <Row label="Destructive">
          <Button variant="destructive">Uninstall Splash…</Button>
          <Button variant="destructive" size="sm">
            Delete
          </Button>
        </Row>
        <Row label="In a row">
          <div className="flex w-[520px] items-center justify-between rounded-md bg-group px-3 py-2">
            <span>Hugging Face token</span>
            <Button>Edit…</Button>
          </div>
        </Row>
        <Row label="Dialog footer">
          <div className="flex w-[520px] items-center justify-end gap-2 border-t border-hairline pt-3">
            <Button>Cancel</Button>
            <Button variant="primary">Save and restart</Button>
          </div>
        </Row>
      </Section>
    </Board>
  );
}

export function IconButtons() {
  return (
    <Board>
      <Section title="IconButton">
        <Row label="Ghost sm · md · lg">
          <IconButton size="sm" label="Copy" icon={<Copy {...ICON} />} />
          <IconButton size="sm" label="Regenerate" icon={<RotateCw {...ICON} />} />
          <IconButton size="sm" label="Show stats" icon={<Info {...ICON} />} aria-pressed />
          <IconButton label="Hide sidebar" icon={<PanelLeft {...ICON} />} />
          <IconButton label="Settings" icon={<Settings {...ICON} />} />
          <IconButton size="lg" label="Add photos and files" icon={<Plus {...ICON} />} />
          <IconButton label="Settings" icon={<Settings {...ICON} />} disabled />
        </Row>
        <Row label="Secondary">
          <IconButton variant="secondary" size="sm" label="Copy" icon={<Copy {...ICON} />} />
          <IconButton variant="secondary" label="Settings" icon={<Settings {...ICON} />} />
          <IconButton variant="secondary" size="lg" label="Add" icon={<Plus {...ICON} />} />
        </Row>
        <Row label="Send · stop">
          <IconButton
            variant="primary"
            size="lg"
            label="Send"
            icon={<ArrowUp size={18} strokeWidth={2} />}
          />
          <IconButton
            variant="primary"
            size="lg"
            label="Send"
            icon={<ArrowUp size={18} strokeWidth={2} />}
            disabled
          />
          <IconButton
            variant="primary"
            size="lg"
            label="Stop generating"
            icon={<Square size={14} fill="currentColor" strokeWidth={0} />}
          />
        </Row>
      </Section>
    </Board>
  );
}

export function Indicators() {
  return (
    <Board>
      <Section title="StatusDot">
        <Row label="With label">
          <StatusDot tone="ok" label="Ready" />
          <StatusDot tone="busy" label="Thinking" />
          <StatusDot tone="warn" label="Starting…" />
          <StatusDot tone="off" label="Stopped" />
          <StatusDot tone="error" label="Error" />
        </Row>
        <Row label="Dot only, word beside">
          <span className="inline-flex items-center gap-2.5">
            <StatusDot tone="ok" />
            <span className="font-medium">{'Qwen3.8-27B'}</span>
            <span className="text-xs text-fg-secondary">Ready</span>
          </span>
          <span className="inline-flex items-center gap-2 text-fg-secondary">
            <StatusDot tone="warn" pulse />
            Restart required to apply changes
          </span>
        </Row>
      </Section>
      <Section title="Spinner">
        <Row label="12 · 16 · 20 px">
          <Spinner size={12} />
          <Spinner />
          <Spinner size={20} label="Checking for updates" />
          <span className="inline-flex items-center gap-2 text-fg-secondary">
            <Spinner size={14} decorative />
            Checking for updates…
          </span>
        </Row>
      </Section>
      <Section title="ProgressRing">
        <Row label="Download ring">
          <ProgressRing value={0} label="Downloading Qwen3.6-35B-A3B" />
          <ProgressRing
            value={0.42}
            label="Downloading Qwen3.6-35B-A3B"
            onCancel={() => undefined}
          />
          <ProgressRing
            value={0.8}
            label="Downloading Qwen3.8-27B (MLX 4-bit)"
            onCancel={() => undefined}
          />
          <ProgressRing value={1} label="Downloaded" />
          <ProgressRing value={0.6} size={20} label="Installing Splash" />
        </Row>
      </Section>
      <Section title="Kbd">
        <Row label="Shortcuts">
          <Kbd>⌘N</Kbd>
          <Kbd>⌘K</Kbd>
          <Kbd>⌘2</Kbd>
          <Kbd>⌘\</Kbd>
          <Kbd>⌘,</Kbd>
          <span className="inline-flex w-[220px] items-center justify-between rounded-xs bg-hover px-2.5 py-1.5">
            Open Activity <Kbd>⌘2</Kbd>
          </span>
        </Row>
      </Section>
    </Board>
  );
}
