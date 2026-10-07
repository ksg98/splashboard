import { formatBytes, formatNumber } from '@/lib/format';
import type { ChatImage, ThinkingEffort, TurnStats } from './types';

export interface EffortOption {
  value: ThinkingEffort;
  label: string;
  description: string;
  /** What the composer pill says. */
  pill: string;
}

/** The thinking levels, with the one-line explanations from the reference. */
export const EFFORT_OPTIONS: readonly EffortOption[] = [
  {
    value: 'none',
    label: 'None',
    description: 'Answer right away, no thinking',
    pill: 'Thinking off',
  },
  { value: 'low', label: 'Low', description: 'Think briefly', pill: 'Low thinking' },
  { value: 'medium', label: 'Medium', description: 'Balanced', pill: 'Medium thinking' },
  {
    value: 'high',
    label: 'High',
    description: 'Think longest, for hard problems',
    pill: 'High thinking',
  },
];

export function effortOption(value: ThinkingEffort): EffortOption {
  return EFFORT_OPTIONS.find((option) => option.value === value) ?? EFFORT_OPTIONS[2]!;
}

/** "Thought for 1 second", "Thought for 8 seconds". */
export function thoughtLabel(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return 'Thought for a moment';
  const whole = Math.max(1, Math.round(seconds));
  return `Thought for ${whole} ${whole === 1 ? 'second' : 'seconds'}`;
}

function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count, 0)} ${count === 1 ? one : many}`;
}

/**
 * The per-turn stats line, in plain English, one fact per part:
 * "94 tok/s", "0.42 s to first token", "2,786 of 3,120 prompt tokens cached",
 * "418 thinking tokens", "1,206 output tokens", and the finish reason only
 * when the reply did not end normally.
 */
export function statsParts(stats: TurnStats): string[] {
  const parts = [
    `${formatNumber(stats.tokensPerSecond, 0)} tok/s`,
    `${stats.timeToFirstTokenSeconds.toFixed(2)} s to first token`,
    stats.cachedTokens > 0
      ? `${formatNumber(stats.cachedTokens, 0)} of ${plural(stats.promptTokens, 'prompt token', 'prompt tokens')} cached`
      : plural(stats.promptTokens, 'prompt token', 'prompt tokens'),
    stats.thinkingTokens > 0
      ? plural(stats.thinkingTokens, 'thinking token', 'thinking tokens')
      : 'no thinking',
    plural(stats.outputTokens, 'output token', 'output tokens'),
  ];
  const ending = finishLabel(stats.finishReason);
  if (ending) parts.push(ending);
  return parts;
}

/** Plain-English finish reason; empty for a normal finish. */
export function finishLabel(reason: TurnStats['finishReason']): string {
  switch (reason) {
    case 'length':
      return 'cut off at the reply length limit';
    case 'tool_calls':
      return 'ended to call a tool';
    // The reply itself says "You stopped this reply."
    case 'cancelled':
      return '';
    case 'error':
      return 'ended with an error';
    default:
      return '';
  }
}

/** "Image · 412 KB" on the composer chip. */
export function imageMeta(image: ChatImage): string {
  return image.sizeBytes === undefined
    ? 'Image'
    : `Image · ${formatBytes(image.sizeBytes, { decimals: image.sizeBytes < 1024 * 1024 ? 0 : 1 })}`;
}

export interface TextRange {
  text: string;
  match: boolean;
}

/** Splits `text` around every case-insensitive occurrence of `query`. */
export function splitMatches(text: string, query: string): TextRange[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, match: false }];
  const haystack = text.toLowerCase();
  const out: TextRange[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    if (at > from) out.push({ text: text.slice(from, at), match: false });
    out.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) out.push({ text: text.slice(from), match: false });
  return out.length ? out : [{ text, match: false }];
}
