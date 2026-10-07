import clsx from 'clsx';
import { Check } from 'lucide-react';
import {
  createContext,
  useContext,
  useMemo,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import './Markdown.css';

export interface MarkdownProps {
  /** The Markdown source (GFM: tables, task lists, strikethrough, autolinks, footnotes). */
  children: string;
  /** Adds the pulsing caret after the last character while the reply streams. */
  streaming?: boolean;
  /** Called instead of navigating when a link is clicked; open it in the system browser. */
  onLinkClick?: (href: string) => void;
  /** Passed to every code block's Copy button (defaults to navigator.clipboard). */
  onCopyCode?: (code: string) => void | Promise<void>;
  className?: string;
}

/* ---------- hast helpers (types come from react-markdown's own hast dependency) ---------- */

type HastElement = NonNullable<ExtraProps['node']>;
type HastChild = HastElement['children'][number];
interface HastParent {
  children: HastChild[];
}

/** Elements the caret goes after rather than inside. */
const INLINE = new Set([
  'a',
  'abbr',
  'b',
  'br',
  'code',
  'del',
  'em',
  'hr',
  'i',
  'img',
  'input',
  'kbd',
  'mark',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'u',
]);

function lastContent(children: HastChild[]): HastChild | undefined {
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (!child || child.type === 'comment') continue;
    if (child.type === 'text' && child.value.trim() === '') continue;
    return child;
  }
  return undefined;
}

/**
 * Rehype plugin: puts the streaming caret at the end of the last text, as
 * deep as the last block goes (paragraph, list item, table cell, quote). A
 * trailing code block is flagged instead, and CodeBlock draws its own caret.
 */
function rehypeStreamingCaret() {
  return (tree: HastParent) => {
    let target: HastParent = tree;
    for (;;) {
      const last = lastContent(target.children);
      if (!last || last.type !== 'element' || INLINE.has(last.tagName)) break;
      if (last.tagName === 'pre') {
        last.properties = { ...last.properties, dataCaret: 'true' };
        return;
      }
      target = last;
    }
    const caret: HastElement = {
      type: 'element',
      tagName: 'span',
      properties: { className: ['sb-caret'], ariaHidden: 'true' },
      children: [],
    };
    target.children.push(caret);
  };
}

function textOf(node: HastChild): string {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return '';
  return node.children.map(textOf).join('');
}

function classList(node: HastElement | undefined): string[] {
  const value = node?.properties.className;
  return Array.isArray(value) ? value.map(String) : [];
}

/* ---------- element overrides (module level, so they keep their identity across renders) ---------- */

interface MarkdownCallbacks {
  onLinkClick: (href: string) => void;
  onCopyCode?: (code: string) => void | Promise<void>;
}

const noop = () => undefined;
const CallbacksContext = createContext<MarkdownCallbacks>({ onLinkClick: noop });

function Link({
  href,
  children,
  node: _node,
  ...rest
}: ComponentPropsWithoutRef<'a'> & ExtraProps) {
  const { onLinkClick } = useContext(CallbacksContext);
  const inPage = href?.startsWith('#') ?? false;
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!href || inPage) return;
    event.preventDefault();
    onLinkClick(href);
  };
  return (
    <a
      {...rest}
      href={href}
      target={inPage ? undefined : '_blank'}
      rel={inPage ? undefined : 'noreferrer noopener'}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

/** Remote images are not loaded (a reply must not phone home); they become links. */
function Image({ src, alt }: ComponentPropsWithoutRef<'img'> & ExtraProps) {
  const href = typeof src === 'string' && src !== '' ? src : undefined;
  const label = alt || 'Image';
  return href ? <Link href={href}>{label}</Link> : <span>{label}</span>;
}

function Pre({ node }: ComponentPropsWithoutRef<'pre'> & ExtraProps) {
  const { onCopyCode } = useContext(CallbacksContext);
  const code = node?.children.find(
    (child): child is HastElement => child.type === 'element' && child.tagName === 'code',
  );
  const language = classList(code)
    .find((name) => name.startsWith('language-'))
    ?.slice('language-'.length);
  const text = code ? textOf(code).replace(/\n$/, '') : '';
  const streaming = node?.properties.dataCaret !== undefined;
  return <CodeBlock code={text} language={language} streaming={streaming} onCopy={onCopyCode} />;
}

function InlineCode({
  className,
  node: _node,
  ...rest
}: ComponentPropsWithoutRef<'code'> & ExtraProps) {
  return <code {...rest} className={clsx('sb-md__code', className)} />;
}

function Table({ node: _node, ...rest }: ComponentPropsWithoutRef<'table'> & ExtraProps) {
  return (
    <div className="sb-md__table">
      <table {...rest} />
    </div>
  );
}

/** GFM task-list boxes: drawn read-only, never a live checkbox. */
function TaskBox({
  type,
  checked,
  node: _node,
  ...rest
}: ComponentPropsWithoutRef<'input'> & ExtraProps) {
  if (type !== 'checkbox') return <input type={type} {...rest} />;
  return (
    <span
      className="sb-md__task"
      role="img"
      aria-label={checked ? 'Done' : 'Not done'}
      data-checked={checked || undefined}
    >
      {checked ? <Check size={12} strokeWidth={2.25} aria-hidden="true" /> : null}
    </span>
  );
}

const components: Components = {
  a: Link,
  img: Image,
  pre: Pre,
  code: InlineCode,
  table: Table,
  input: TaskBox,
};

const remarkPlugins = [remarkGfm];
const streamingRehypePlugins = [rehypeStreamingCaret];
const noRehypePlugins: never[] = [];

/**
 * Renders an assistant reply: GFM Markdown with code blocks, tables, lists,
 * quotes and links, in the chat body type (16 px / 1.65). Raw HTML in the
 * source is shown as text, never rendered.
 */
export function Markdown({
  children,
  streaming = false,
  onLinkClick = noop,
  onCopyCode,
  className,
}: MarkdownProps): ReactNode {
  const callbacks = useMemo(() => ({ onLinkClick, onCopyCode }), [onLinkClick, onCopyCode]);
  return (
    <CallbacksContext.Provider value={callbacks}>
      <div
        className={clsx('sb-md', className)}
        data-selectable
        data-streaming={streaming || undefined}
      >
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={streaming ? streamingRehypePlugins : noRehypePlugins}
          components={components}
        >
          {children}
        </ReactMarkdown>
      </div>
    </CallbacksContext.Provider>
  );
}
