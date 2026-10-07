import clsx from 'clsx';
import { Check, Copy } from 'lucide-react';
import rehypeHighlight from 'rehype-highlight';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import './CodeBlock.css';

export interface CodeBlockProps {
  code: string;
  /** Fence info ("python", "bash", "json"). Unknown languages render as plain text. */
  language?: string;
  /** Shows the pulsing caret after the last character while the reply streams. */
  streaming?: boolean;
  /** Replaces the default clipboard write (navigator.clipboard), e.g. with a Tauri command. */
  onCopy?: (code: string) => void | Promise<void>;
  className?: string;
}

const COPIED_MS = 1400;

/* ---------- Highlighting: rehype-highlight (lowlight, highlight.js grammars) on a tiny hast tree ---------- */

interface HastText {
  type: 'text';
  value: string;
}
interface HastElement {
  type: 'element';
  tagName: string;
  properties: { className?: unknown };
  children: HastNode[];
}
type HastNode = HastText | HastElement | { type: 'comment'; value: string };
type HighlightTransform = (
  tree: { type: 'root'; children: HastNode[] },
  file: { message: (...args: unknown[]) => void },
) => void;

let transform: HighlightTransform | null = null;

/** First word of the fence info, lower-cased ("Python {1,3}" → "python"). */
function languageOf(language: string | undefined): string {
  return (language ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

function highlight(code: string, language: string): HastNode[] {
  const plain: HastNode[] = [{ type: 'text', value: code }];
  if (!language || code === '') return plain;
  const codeElement: HastElement = {
    type: 'element',
    tagName: 'code',
    properties: { className: [`language-${language}`] },
    children: plain,
  };
  const pre: HastElement = {
    type: 'element',
    tagName: 'pre',
    properties: {},
    children: [codeElement],
  };
  try {
    transform ??= rehypeHighlight() as unknown as HighlightTransform;
    // Unknown languages are reported through file.message and left unhighlighted.
    transform({ type: 'root', children: [pre] }, { message: () => undefined });
  } catch {
    return plain;
  }
  return codeElement.children;
}

function renderHast(nodes: HastNode[], prefix = ''): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === 'text') return node.value;
    if (node.type !== 'element') return null;
    const className = node.properties.className;
    return (
      <span
        key={`${prefix}${index}`}
        className={Array.isArray(className) ? className.join(' ') : undefined}
      >
        {renderHast(node.children, `${prefix}${index}.`)}
      </span>
    );
  });
}

async function writeClipboard(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('Clipboard unavailable');
  }
  await navigator.clipboard.writeText(text);
}

/** A fenced code block: language label and Copy in the header, highlighted mono body. */
export function CodeBlock({
  code,
  language,
  streaming = false,
  onCopy,
  className,
}: CodeBlockProps) {
  const lang = languageOf(language);
  const label = lang || 'text';
  const highlighted = useMemo(() => renderHast(highlight(code, lang)), [code, lang]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await (onCopy ? onCopy(code) : writeClipboard(code));
      setCopied(true);
    } catch {
      // Nothing to show: the button simply does not switch to "Copied".
    }
  };

  return (
    <div className={clsx('sb-code', className)} data-selectable>
      <div className="sb-code__head">
        <span className="sb-code__lang">{label}</span>
        <button
          type="button"
          className="sb-code__copy"
          onClick={() => void handleCopy()}
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? (
            <Check size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Copy size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
          <span aria-hidden="true">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      {/* Focusable so long lines can be scrolled from the keyboard. */}
      <pre className="sb-code__pre" tabIndex={0}>
        <code className={clsx('hljs', lang && `language-${lang}`)}>
          {highlighted}
          {streaming ? <span className="sb-caret" aria-hidden="true" /> : null}
        </code>
      </pre>
    </div>
  );
}
