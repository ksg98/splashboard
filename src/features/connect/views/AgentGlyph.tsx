import type { AgentId } from '@/lib/connectors/catalog';
import './AgentGlyph.css';

/**
 * Monochrome line glyphs for the five agents `splash <agent>` connects to.
 * Drawn on a 24-unit grid like the rest of the icons (1.5 px stroke at 18 px),
 * so they sit beside lucide icons without looking borrowed. No brand marks.
 */
const GLYPHS: Record<AgentId, readonly string[]> = {
  // Claude Code: a six-point asterisk.
  claude: ['M12 4.5v15', 'M5.5 8.25l13 7.5', 'M5.5 15.75l13-7.5'],
  // OpenCode: braces.
  opencode: [
    'M9 4.75c-1.6 0-2.4.8-2.4 2.4v2.1c0 1.3-.7 2.2-2.1 2.75 1.4.55 2.1 1.45 2.1 2.75v2.1c0 1.6.8 2.4 2.4 2.4',
    'M15 4.75c1.6 0 2.4.8 2.4 2.4v2.1c0 1.3.7 2.2 2.1 2.75-1.4.55-2.1 1.45-2.1 2.75v2.1c0 1.6-.8 2.4-2.4 2.4',
  ],
  // Codex: a prompt.
  codex: ['M5.5 7.5l4.5 4.5-4.5 4.5', 'M12.5 17h6'],
  // Hermes: a paper plane (the messenger).
  hermes: ['M20.5 3.5L3.5 10.75l6.75 2.75 2.75 6.75z', 'M10.25 13.5l10.25-10'],
  // Pi: the letter.
  pi: ['M5 7.5h14', 'M9.25 7.5v11', 'M15 7.5v8.75c0 1.25.75 2 2 2h1'],
};

export interface AgentGlyphProps {
  id: AgentId;
  /** Rendered size in px (default 18, the size inside a 32 px tile). */
  size?: number;
}

export function AgentGlyph({ id, size = 18 }: AgentGlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[id].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * The 32 px icon tile used for agents in Connect and in the terminal sheet
 * header: the one tile treatment of the app (gray fill, no border, no shadow).
 */
export function AgentTile({ id }: { id: AgentId }) {
  return (
    <span className="agent-tile" aria-hidden="true" data-agent={id}>
      <AgentGlyph id={id} />
    </span>
  );
}
