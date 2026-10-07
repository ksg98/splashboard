import clsx from 'clsx';
import {
  useId,
  useMemo,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { FormRowContext, type FormRowContextValue } from './FormRowContext';
import './Form.css';

/* -------------------------------------------------------------------------- */
/* FormSection: a 13px semibold title, one or more groups, a gray footnote.    */
/* -------------------------------------------------------------------------- */

export interface FormSectionProps {
  /** 13px semibold title above the group ("Memory & context"). Optional: a lone preset row has none. */
  title?: ReactNode;
  /** 12px gray text under the group, explaining the group as a whole. */
  footnote?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}

export function FormSection({ title, footnote, children, id, className }: FormSectionProps) {
  const autoId = useId();
  const titleId = title ? `${autoId}-title` : undefined;
  return (
    <section className={clsx('sb-form-section', className)} id={id} aria-labelledby={titleId}>
      {title ? (
        <h3 className="sb-form-section__title" id={titleId}>
          {title}
        </h3>
      ) : null}
      {children}
      {footnote ? <p className="sb-form-footnote">{footnote}</p> : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* FormGroup: the inset rounded group (System Settings).                       */
/* -------------------------------------------------------------------------- */

export interface FormGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function FormGroup({ children, className, ...rest }: FormGroupProps) {
  return (
    <div className={clsx('sb-form-group', className)} {...rest}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* FormRow: label (and a help line) on the left, the control on the right.     */
/* -------------------------------------------------------------------------- */

export interface FormRowProps {
  label: ReactNode;
  /** 12px gray line under the label that explains this row. */
  help?: ReactNode;
  /** The control (Switch, Slider, PopUpButton, a value and a button, …). */
  control: ReactNode;
  /** 12px gray text under the whole row, full width, for a note about this row only. */
  footnote?: ReactNode;
  /** Dims the label and disables every form control in the row. */
  disabled?: boolean;
  /** Why the row is disabled. Shown in place of the help line while disabled. */
  disabledReason?: ReactNode;
  /** A validation message. Shown in place of the help line, in the destructive text colour. */
  error?: ReactNode;
  /** The control's id: the label becomes a real <label for>. */
  htmlFor?: string;
  /** Label and help above, the control below at full width (text areas, lists). */
  stacked?: boolean;
  id?: string;
  className?: string;
}

export function FormRow({
  label,
  help,
  control,
  footnote,
  disabled = false,
  disabledReason,
  error,
  htmlFor,
  stacked = false,
  id,
  className,
}: FormRowProps) {
  const autoId = useId();
  const labelId = `${autoId}-label`;
  const lineId = `${autoId}-line`;
  const footnoteId = `${autoId}-footnote`;

  const showReason = disabled && disabledReason != null;
  const line = error ?? (showReason ? disabledReason : help);
  const lineKind = error != null ? 'error' : showReason ? 'reason' : 'help';
  const hasLine = line != null && line !== false && line !== '';
  const hasFootnote = footnote != null && footnote !== false && footnote !== '';

  const describedBy =
    [hasLine ? lineId : null, hasFootnote ? footnoteId : null].filter(Boolean).join(' ') ||
    undefined;
  const invalid = error != null;

  const context = useMemo<FormRowContextValue>(
    () => ({ labelId, describedBy, disabled, invalid }),
    [labelId, describedBy, disabled, invalid],
  );

  return (
    <div
      className={clsx(
        'sb-form-row',
        disabled && 'is-disabled',
        invalid && 'is-invalid',
        stacked && 'is-stacked',
        className,
      )}
      id={id}
      aria-disabled={disabled || undefined}
    >
      <div className="sb-form-row__line">
        <div className="sb-form-row__text">
          {htmlFor ? (
            <label className="sb-form-row__label" id={labelId} htmlFor={htmlFor}>
              {label}
            </label>
          ) : (
            <div className="sb-form-row__label" id={labelId}>
              {label}
            </div>
          )}
          {hasLine ? (
            <div
              // Remount when the kind changes, so an error line is announced as it appears.
              key={lineKind}
              className={clsx('sb-form-row__help', `is-${lineKind}`)}
              id={lineId}
              role={lineKind === 'error' ? 'alert' : undefined}
            >
              {line}
            </div>
          ) : null}
        </div>
        <FormRowContext.Provider value={context}>
          {/* A disabled fieldset disables every native control inside it, whoever built them. */}
          <fieldset className="sb-form-row__control" disabled={disabled} role="none">
            {control}
          </fieldset>
        </FormRowContext.Provider>
      </div>
      {hasFootnote ? (
        <div className="sb-form-row__footnote" id={footnoteId}>
          {footnote}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Small pieces that live inside rows.                                         */
/* -------------------------------------------------------------------------- */

export interface FormValueProps {
  children: ReactNode;
  /** Monospace 12px, for paths, origins, aliases and keys. */
  monospace?: boolean;
  className?: string;
}

/** A read-only value at the trailing end of a row ("Default", "54.8 GB", `tauri://localhost`). */
export function FormValue({ children, monospace = false, className }: FormValueProps) {
  return (
    <span className={clsx('sb-form-value', monospace && 'is-mono', className)}>{children}</span>
  );
}

export type FormTextButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * A borderless action that belongs to a line of text rather than to the row,
 * e.g. "Regenerate…" under the masked API key. Medium-weight primary text,
 * a light fill on hover.
 */
export function FormTextButton({ className, type = 'button', ...rest }: FormTextButtonProps) {
  return <button type={type} className={clsx('sb-form-text-button', className)} {...rest} />;
}

export interface FormActionRowProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  label: ReactNode;
  /** Red text, for an action that removes something ("Uninstall Splash…"). */
  destructive?: boolean;
}

/** A whole row that is one button (System Settings style), usually alone in its group. */
export function FormActionRow({
  label,
  destructive = false,
  className,
  type = 'button',
  ...rest
}: FormActionRowProps) {
  return (
    <button
      type={type}
      className={clsx('sb-form-row', 'sb-form-action', destructive && 'is-destructive', className)}
      {...rest}
    >
      {label}
    </button>
  );
}
