import clsx from 'clsx';
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './CopyButton.css';

export interface CopyButtonProps {
  text: string;
  /** Accessible name, and the visible word with showLabel. Default "Copy". */
  label?: string;
  /** Show the word next to the icon ("Copy" → "Copied"), as in a code block header. */
  showLabel?: boolean;
  /** How to copy. Default: navigator.clipboard.writeText. Throw to signal failure. */
  copy?: (text: string) => Promise<void> | void;
  onCopied?: () => void;
  disabled?: boolean;
  className?: string;
}

/** How long the check stays after a copy. */
export const COPIED_MS = 1500;

async function writeClipboard(text: string): Promise<void> {
  if (!navigator.clipboard) throw new Error('Clipboard unavailable');
  await navigator.clipboard.writeText(text);
}

/** 28px icon button; the copy icon turns into a check for 1.5 s after copying. */
export function CopyButton({
  text,
  label = 'Copy',
  showLabel = false,
  copy = writeClipboard,
  onCopied,
  disabled,
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handleClick = async () => {
    try {
      await copy(text);
    } catch {
      return;
    }
    setCopied(true);
    onCopied?.();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  };

  const Icon = copied ? Check : Copy;

  return (
    <>
      <button
        type="button"
        className={clsx('sb-copy-button', showLabel && 'has-label', className)}
        aria-label={showLabel ? undefined : label}
        data-copied={copied || undefined}
        disabled={disabled}
        onClick={() => void handleClick()}
      >
        <Icon size={showLabel ? 14 : 16} strokeWidth={1.5} aria-hidden="true" />
        {showLabel ? <span>{copied ? 'Copied' : label}</span> : null}
      </button>
      <span className="sb-copy-button__status" role="status">
        {copied ? 'Copied' : ''}
      </span>
    </>
  );
}
