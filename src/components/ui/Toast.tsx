import { clsx } from 'clsx';
import { Toast as RadixToast, VisuallyHidden } from 'radix-ui';
import { useSyncExternalStore } from 'react';
import './Toast.css';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** One text button on the right ("Undo", "Retry"). */
  action?: ToastAction;
  /** error: a red dot before the text, announced assertively, shown longer. */
  tone?: 'default' | 'error';
  /** Milliseconds before it dismisses itself. Infinity keeps it. Default 4 s (6 s for errors). */
  duration?: number;
  /** Reusing an id replaces that toast instead of stacking a new one. */
  id?: string;
}

interface ToastRecord {
  id: string;
  message: string;
  action?: ToastAction;
  tone: 'default' | 'error';
  duration: number;
  open: boolean;
}

const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 6000;
/** Older toasts close once this many are showing. */
const MAX_VISIBLE = 3;
/** Long enough for the exit animation before the record is dropped. */
const REMOVE_AFTER_MS = 400;

let records: ToastRecord[] = [];
let counter = 0;
const listeners = new Set<() => void>();

function setRecords(next: ToastRecord[]) {
  records = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return records;
}

function scheduleRemoval(id: string) {
  setTimeout(() => {
    setRecords(records.filter((record) => record.id !== id || record.open));
  }, REMOVE_AFTER_MS);
}

/**
 * Shows a small note at the bottom centre of the window. Returns its id.
 * Needs one <Toaster /> mounted (the app shell mounts it).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function toast(message: string, opts: ToastOptions = {}): string {
  counter += 1;
  const id = opts.id ?? `toast-${counter}`;
  const tone = opts.tone ?? 'default';
  const record: ToastRecord = {
    id,
    message,
    action: opts.action,
    tone,
    duration: opts.duration ?? (tone === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS),
    open: true,
  };
  let next = [...records.filter((existing) => existing.id !== id), record];
  const showing = next.filter((existing) => existing.open);
  if (showing.length > MAX_VISIBLE) {
    const closing = new Set(showing.slice(0, showing.length - MAX_VISIBLE).map((r) => r.id));
    next = next.map((existing) =>
      closing.has(existing.id) ? { ...existing, open: false } : existing,
    );
    closing.forEach(scheduleRemoval);
  }
  setRecords(next);
  return id;
}

/** Closes a toast early (with its exit animation). */
// eslint-disable-next-line react-refresh/only-export-components
export function dismissToast(id: string) {
  if (!records.some((record) => record.id === id && record.open)) return;
  setRecords(records.map((record) => (record.id === id ? { ...record, open: false } : record)));
  scheduleRemoval(id);
}

/** Mount once. Renders the toasts raised with toast(); F8 moves focus to them. */
export function Toaster({ label = 'Notifications' }: { label?: string }) {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <RadixToast.Provider swipeDirection="down" duration={DEFAULT_DURATION_MS} label={label}>
      {items.map((item) => (
        <RadixToast.Root
          key={item.id}
          open={item.open}
          duration={item.duration}
          type={item.tone === 'error' ? 'foreground' : 'background'}
          onOpenChange={(open) => {
            if (!open) dismissToast(item.id);
          }}
          className={clsx('sb-toast', item.action && 'sb-toast--with-action')}
          data-tone={item.tone}
        >
          {item.tone === 'error' ? <span className="sb-toast__dot" aria-hidden /> : null}
          <RadixToast.Description className="sb-toast__message">
            {item.tone === 'error' ? <VisuallyHidden.Root>Error: </VisuallyHidden.Root> : null}
            {item.message}
          </RadixToast.Description>
          {item.action ? (
            <RadixToast.Action altText={item.action.label} asChild>
              <button type="button" className="sb-toast__action" onClick={item.action.onClick}>
                {item.action.label}
              </button>
            </RadixToast.Action>
          ) : null}
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport className="sb-toaster" />
    </RadixToast.Provider>
  );
}
