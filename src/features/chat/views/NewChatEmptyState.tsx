import {
  BookOpen,
  Code,
  FileText,
  Image,
  Sparkles,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { Suggestion, SuggestionIcon } from './types';
import './NewChatEmptyState.css';

const ICONS: Record<SuggestionIcon, LucideIcon> = {
  code: Code,
  image: Image,
  book: BookOpen,
  terminal: SquareTerminal,
  file: FileText,
  sparkles: Sparkles,
};

export interface NewChatEmptyStateProps {
  /** The composer, already wired (usually <Composer autoFocus … />). */
  composer: ReactNode;
  /** Three or four quiet starting points under the composer. */
  suggestions?: Suggestion[];
  onSelectSuggestion?: (suggestion: Suggestion) => void;
  title?: string;
}

/** A new chat: one question, the composer, and a few quiet suggestion chips. */
export function NewChatEmptyState({
  composer,
  suggestions = [],
  onSelectSuggestion,
  title = 'What can I help with?',
}: NewChatEmptyStateProps) {
  return (
    <div className="ch-empty">
      <h1 className="ch-empty-title">{title}</h1>
      <div className="ch-empty-composer">{composer}</div>
      {suggestions.length > 0 && (
        <ul className="ch-suggestions" aria-label="Suggestions">
          {suggestions.map((suggestion) => {
            const Icon = suggestion.icon ? ICONS[suggestion.icon] : undefined;
            return (
              <li key={suggestion.id}>
                <button
                  type="button"
                  className="ch-suggestion"
                  onClick={() => onSelectSuggestion?.(suggestion)}
                >
                  {Icon && <Icon size={16} strokeWidth={1.5} aria-hidden />}
                  {suggestion.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
