import clsx from 'clsx';
import { ArrowUp, ChevronDown, ImagePlus, Lightbulb, Plus, Square, X } from 'lucide-react';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { MeterBar } from '@/components/ui/Meter';
import { StatusDot } from '@/components/ui/StatusDot';
import { EFFORT_OPTIONS, effortOption, imageMeta } from './format';
import type { ChatImage, ComposerEngine, ThinkingEffort } from './types';
import './Composer.css';

/** The field grows to this height, then scrolls. */
const MAX_FIELD_HEIGHT = 216;

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Send. Also allowed while the server is stopped or starting: wiring starts it (or waits) and then sends. */
  onSubmit: () => void;
  /** A reply is being written: Send becomes a stop square. */
  generating?: boolean;
  onStop?: () => void;
  /** Images waiting to be sent, shown as chips above the field. */
  attachments?: ChatImage[];
  /** Images chosen with "+", dropped on the composer or pasted. */
  onAddImages?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  effort: ThinkingEffort;
  onEffortChange: (effort: ThinkingEffort) => void;
  /**
   * The server behind the model. Stopped and Starting… add one quiet status
   * line inside the top of the composer; the composer itself stays usable.
   */
  engine?: ComposerEngine;
  /** "Start now" in the stopped status line. */
  onStartEngine?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Turns the whole composer off (e.g. no model installed). */
  disabled?: boolean;
  className?: string;
  /** Opens with the thinking menu showing (gallery). */
  defaultEffortMenuOpen?: boolean;
}

function imageFiles(list: FileList | null | undefined): File[] {
  return list ? Array.from(list).filter((file) => file.type.startsWith('image/')) : [];
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * The floating composer: optional engine status line, image chips, an
 * auto-growing field, then "+", the thinking pop-up and the round send button
 * that turns into a stop square while a reply is written.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  generating = false,
  onStop,
  attachments = [],
  onAddImages,
  onRemoveAttachment,
  effort,
  onEffortChange,
  engine,
  onStartEngine,
  placeholder = 'Ask anything',
  autoFocus = false,
  disabled = false,
  className,
  defaultEffortMenuOpen,
}: ComposerProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const fieldId = useId();

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    const next = Math.min(field.scrollHeight, MAX_FIELD_HEIGHT);
    field.style.height = `${Math.max(next, 38)}px`;
    field.style.overflowY = field.scrollHeight > MAX_FIELD_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  const canSend = !disabled && !generating && (value.trim().length > 0 || attachments.length > 0);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (canSend) onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onAddImages) return;
    const files = imageFiles(event.clipboardData?.files);
    if (files.length) {
      event.preventDefault();
      onAddImages(files);
    }
  };

  const onDragEnter = (event: DragEvent) => {
    if (!onAddImages || disabled || !hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (event: DragEvent) => {
    if (!onAddImages || disabled || !hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    if (!onAddImages || disabled) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = imageFiles(event.dataTransfer?.files);
    if (files.length) onAddImages(files);
  };

  const current = effortOption(effort);
  const effortItems: MenuItem[] = [
    { type: 'heading', label: 'Thinking' },
    ...EFFORT_OPTIONS.map((option): MenuItem => ({
      id: option.value,
      label: option.label,
      description: option.description,
      checked: option.value === effort,
      onSelect: () => onEffortChange(option.value),
    })),
  ];

  const status =
    engine && (engine.state === 'stopped' || engine.state === 'starting') ? engine : undefined;

  return (
    <form
      className={clsx(
        'ch-composer',
        dragging && 'is-dragging',
        disabled && 'is-disabled',
        className,
      )}
      aria-label="Message composer"
      onSubmit={submit}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {status?.state === 'stopped' && (
        <div className="ch-composer-status" role="status">
          <StatusDot tone="off" />
          <span className="ch-composer-status-text">
            {status.modelName} isn’t running. Sending a message starts it.
          </span>
          {onStartEngine && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ch-text-button"
              onClick={onStartEngine}
              disabled={disabled}
            >
              Start now
            </Button>
          )}
        </div>
      )}
      {status?.state === 'starting' && (
        <div className="ch-composer-status" role="status">
          <StatusDot tone="warn" />
          <span className="ch-composer-status-text">Starting {status.modelName}…</span>
          {(status.phase || status.elapsedSeconds !== undefined) && (
            <span className="ch-composer-status-sub">
              {[
                status.phase,
                status.elapsedSeconds !== undefined ? `${Math.floor(status.elapsedSeconds)} s` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
          {status.progress !== undefined && (
            <span className="ch-composer-meter">
              <MeterBar value={status.progress} aria-label={`Starting ${status.modelName}`} />
            </span>
          )}
        </div>
      )}

      {attachments.length > 0 && (
        <ul className="ch-attachments" aria-label="Attached images">
          {attachments.map((image) => (
            <li key={image.id} className="ch-chip">
              <span className="ch-chip-thumb" aria-hidden>
                <img src={image.src} alt="" draggable={false} />
              </span>
              <span className="ch-chip-text">
                <span className="ch-chip-name">{image.name}</span>
                <span className="ch-chip-meta">{imageMeta(image)}</span>
              </span>
              {onRemoveAttachment && (
                <button
                  type="button"
                  className="ch-chip-remove"
                  aria-label={`Remove ${image.name}`}
                  onClick={() => onRemoveAttachment(image.id)}
                >
                  <X size={12} strokeWidth={2} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <label className="ch-sr-only" htmlFor={fieldId}>
        Message
      </label>
      <textarea
        ref={fieldRef}
        id={fieldId}
        className="ch-field"
        rows={1}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        spellCheck
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />

      <div className="ch-composer-bar">
        {onAddImages && (
          <>
            <IconButton
              label="Add images"
              size="lg"
              className="ch-add"
              icon={<Plus size={18} strokeWidth={1.5} aria-hidden />}
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              type="button"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                const files = imageFiles(event.target.files);
                if (files.length) onAddImages(files);
                event.target.value = '';
              }}
            />
          </>
        )}

        <Menu
          side="top"
          align="start"
          width={260}
          items={effortItems}
          aria-label="Thinking"
          defaultOpen={defaultEffortMenuOpen}
          trigger={
            <button
              type="button"
              className="ch-effort"
              aria-label={`Thinking: ${current.label}`}
              disabled={disabled}
            >
              <Lightbulb size={16} strokeWidth={1.5} aria-hidden />
              <span>{current.pill}</span>
              <ChevronDown size={12} strokeWidth={2} aria-hidden className="ch-effort-chevron" />
            </button>
          }
        />

        <span className="ch-composer-spacer" />

        {generating ? (
          <IconButton
            label="Stop"
            variant="primary"
            size="lg"
            type="button"
            className="ch-send"
            icon={<Square size={12} strokeWidth={0} fill="currentColor" aria-hidden />}
            onClick={onStop}
          />
        ) : (
          <IconButton
            label="Send"
            variant="primary"
            size="lg"
            type="submit"
            className="ch-send"
            icon={<ArrowUp size={18} strokeWidth={2} aria-hidden />}
            disabled={!canSend}
          />
        )}
      </div>

      {dragging && (
        <div className="ch-drop" aria-hidden>
          <ImagePlus size={18} strokeWidth={1.5} />
          <span>Drop images to attach</span>
        </div>
      )}
    </form>
  );
}
