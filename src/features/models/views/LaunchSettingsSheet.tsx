import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { Dialog } from '@/components/ui/Dialog';
import { Disclosure } from '@/components/ui/Disclosure';
import { FormGroup, FormRow, FormSection, FormTextButton, FormValue } from '@/components/ui/Form';
import { PopUpButton } from '@/components/ui/PopUpButton';
import { SecureField } from '@/components/ui/SecureField';
import { Segmented } from '@/components/ui/Segmented';
import { Slider } from '@/components/ui/Slider';
import { StatusDot } from '@/components/ui/StatusDot';
import { Stepper } from '@/components/ui/Stepper';
import { Switch } from '@/components/ui/Switch';
import { TextField } from '@/components/ui/TextField';
import type {
  LaunchAction,
  LaunchControl,
  LaunchFormat,
  LaunchRow,
  LaunchSection,
  LaunchSettingsSheetProps,
  LaunchValue,
} from './types';
import './LaunchSettingsSheet.css';

const DEFAULT_COMMAND_FOOTNOTE =
  'Exactly what Splashboard runs. The API key and Hugging Face token are passed in the environment, never on the command line.';

/**
 * Launch settings: a 640 px sheet that renders a generic form model (preset,
 * then grouped sections of rows) with the Form primitives. The title stays
 * pinned while the body scrolls; the footer says a restart is required and
 * offers Cancel and Save and restart. "Show command" reveals the equivalent
 * `splash serve …` command with Copy.
 */
export function LaunchSettingsSheet({
  open = true,
  title,
  subtitle,
  preset,
  sections,
  command,
  dirty,
  onChange,
  onPresetChange,
  onCancel,
  onSave,
  onAction,
  footerNote,
  primaryLabel = 'Save and restart',
  commandFootnote = DEFAULT_COMMAND_FOOTNOTE,
  commandOpen,
  onCommandOpenChange,
  moreOpen,
  onMoreOpenChange,
  saveDisabled = false,
}: LaunchSettingsSheetProps) {
  const [commandOpenLocal, setCommandOpenLocal] = useState(false);
  const showCommand = commandOpen ?? commandOpenLocal;
  const setShowCommand = (next: boolean) => {
    setCommandOpenLocal(next);
    onCommandOpenChange?.(next);
  };

  const note = footerNote ? (
    <span>{footerNote}</span>
  ) : dirty ? (
    <span className="ls-restart">
      <StatusDot tone="warn" />
      <span>Restart required to apply changes</span>
    </span>
  ) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={title}
      description={subtitle}
      width={640}
      scroll
      footerNote={note}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onSave} disabled={saveDisabled}>
            {primaryLabel}
          </Button>
        </>
      }
    >
      <div className="ls-body">
        <FormSection footnote={preset.footnote}>
          <FormGroup>
            <FormRow
              label="Preset"
              control={
                <PopUpButton
                  value={preset.value}
                  options={preset.options}
                  onChange={onPresetChange}
                  aria-label="Preset"
                  align="end"
                />
              }
            />
          </FormGroup>
        </FormSection>

        {sections.map((section) => (
          <SectionView
            key={section.id}
            section={section}
            onChange={onChange}
            onAction={onAction}
            moreOpen={moreOpen?.[section.id]}
            onMoreOpenChange={(next) => onMoreOpenChange?.(section.id, next)}
          />
        ))}

        <div className="ls-command">
          <Disclosure
            label="Show command"
            openLabel="Hide command"
            open={showCommand}
            onOpenChange={setShowCommand}
          >
            <div className="ls-code">
              <div className="ls-code__head">
                <span>Terminal</span>
                <CopyButton text={command} label="Copy" showLabel />
              </div>
              <pre className="ls-code__pre" data-selectable>
                {command}
              </pre>
            </div>
            {commandFootnote ? <p className="ls-footnote">{commandFootnote}</p> : null}
          </Disclosure>
        </div>
      </div>
    </Dialog>
  );
}

interface SectionViewProps {
  section: LaunchSection;
  onChange: (key: string, value: LaunchValue) => void;
  onAction?: (key: string, action: LaunchAction) => void;
  moreOpen?: boolean;
  onMoreOpenChange: (open: boolean) => void;
}

function SectionView({
  section,
  onChange,
  onAction,
  moreOpen,
  onMoreOpenChange,
}: SectionViewProps) {
  const more = section.moreRows ?? [];
  return (
    <FormSection title={section.title} footnote={section.footnote} id={`ls-${section.id}`}>
      <FormGroup>
        {section.rows.map((row) => (
          <RowView key={row.key} row={row} onChange={onChange} onAction={onAction} />
        ))}
        {more.length > 0 ? (
          <Disclosure
            variant="row"
            label="More options"
            open={moreOpen}
            onOpenChange={onMoreOpenChange}
            className="ui-form-more"
          >
            {more.map((row) => (
              <RowView key={row.key} row={row} onChange={onChange} onAction={onAction} />
            ))}
          </Disclosure>
        ) : null}
      </FormGroup>
    </FormSection>
  );
}

interface RowViewProps {
  row: LaunchRow;
  onChange: (key: string, value: LaunchValue) => void;
  onAction?: (key: string, action: LaunchAction) => void;
}

function RowView({ row, onChange, onAction }: RowViewProps) {
  const { control } = row;
  const set = (value: LaunchValue) => onChange(row.key, value);
  const act = (action: LaunchAction) => onAction?.(row.key, action);

  let help: ReactNode = row.help;
  if (typeof row.changed === 'string') {
    help = row.help ? (
      <>
        {row.help}
        <br />
        {row.changed}
      </>
    ) : (
      row.changed
    );
  }

  // A secret with a switch: the masked key and Regenerate… sit under the label while it is on.
  if (control.kind === 'secret' && control.enabled !== undefined) {
    const on = control.enabled;
    help = on ? (
      <>
        <span className="ls-mono">{typeof control.value === 'string' ? control.value : ''}</span>
        <br />
        <FormTextButton onClick={() => act('regenerate')} disabled={row.disabled}>
          Regenerate…
        </FormTextButton>
      </>
    ) : (
      (row.help ?? 'Any app on this Mac can use the server without a key.')
    );
  }

  return (
    <FormRow
      label={row.label}
      help={help}
      footnote={row.footnote}
      disabled={row.disabled}
      disabledReason={row.disabledReason}
      control={<ControlView row={row} control={control} set={set} act={act} />}
    />
  );
}

interface ControlViewProps {
  row: LaunchRow;
  control: LaunchControl;
  set: (value: LaunchValue) => void;
  act: (action: LaunchAction) => void;
}

function ControlView({ row, control, set, act }: ControlViewProps) {
  const label = row.label;
  switch (control.kind) {
    case 'toggle':
      return (
        <Switch
          checked={control.value === true}
          onCheckedChange={(checked) => set(checked)}
          aria-label={label}
          disabled={row.disabled}
        />
      );
    case 'select':
      return (
        <PopUpButton
          value={String(control.value ?? '')}
          options={control.options ?? []}
          onChange={(next) => set(next)}
          aria-label={label}
          align="end"
          disabled={row.disabled}
        />
      );
    case 'segmented':
      return (
        <Segmented
          value={String(control.value ?? '')}
          options={control.options ?? []}
          onChange={(next) => set(next)}
          aria-label={label}
          disabled={row.disabled}
        />
      );
    case 'slider': {
      const value = typeof control.value === 'number' ? control.value : 0;
      if (control.stops && control.stops.length > 1) {
        const stops = control.stops;
        const index = nearestIndex(stops, value);
        return (
          <Slider
            value={index}
            min={0}
            max={stops.length - 1}
            step={1}
            onChange={(i) => set(stops[Math.round(i)] ?? value)}
            formatValue={(i) => control.stopLabels?.[Math.round(i)] ?? String(stops[Math.round(i)])}
            ends={control.ends ?? ['Less', 'More']}
            ticks={stops.length}
            aria-label={label}
            disabled={row.disabled}
          />
        );
      }
      return (
        <Slider
          value={value}
          min={control.min ?? 0}
          max={control.max ?? 100}
          step={control.step ?? 1}
          onChange={(next) => set(next)}
          formatValue={formatter(control)}
          aria-label={label}
          disabled={row.disabled}
        />
      );
    }
    case 'number':
      return (
        <Stepper
          value={typeof control.value === 'number' ? control.value : 0}
          min={control.min}
          max={control.max}
          step={control.step}
          unit={control.unit}
          onChange={(next) => set(next)}
          aria-label={label}
          disabled={row.disabled}
        />
      );
    case 'text':
      return (
        <TextField
          value={typeof control.value === 'string' ? control.value : ''}
          onChange={(next) => set(next)}
          placeholder={control.placeholder}
          monospace={control.monospace}
          aria-label={label}
          disabled={row.disabled}
        />
      );
    case 'secret':
      if (control.enabled !== undefined) {
        return (
          <Switch
            checked={control.enabled}
            onCheckedChange={(checked) => set(checked)}
            aria-label={label}
            disabled={row.disabled}
          />
        );
      }
      return (
        <SecureField
          value={typeof control.value === 'string' ? control.value : ''}
          onChange={(next: string) => set(next)}
          placeholder={control.placeholder}
          revealable
        />
      );
    case 'directory': {
      const path = typeof control.value === 'string' && control.value ? control.value : null;
      return (
        <>
          <FormValue monospace={path !== null}>{path ?? control.emptyLabel ?? 'Default'}</FormValue>
          <Button onClick={() => act('choose')} aria-label={`Choose ${label.toLowerCase()}`}>
            Choose…
          </Button>
        </>
      );
    }
    case 'multi-value': {
      const values = Array.isArray(control.value) ? control.value : [];
      return (
        <>
          <FormValue monospace={values.length > 0}>
            {values.length > 0 ? values.join(', ') : (control.emptyLabel ?? 'None')}
          </FormValue>
          <Button onClick={() => act('edit')} aria-label={`Edit ${label.toLowerCase()}`}>
            Edit…
          </Button>
        </>
      );
    }
  }
}

function nearestIndex(stops: number[], value: number): number {
  let best = 0;
  stops.forEach((stop, i) => {
    if (Math.abs(stop - value) < Math.abs((stops[best] ?? 0) - value)) best = i;
  });
  return best;
}

function formatter(control: LaunchControl): (value: number) => string {
  const format = control.format;
  if (typeof format === 'function') return format;
  return (value) => formatNamed(format ?? 'plain', value, control.unit);
}

function formatNamed(format: LaunchFormat, value: number, unit?: string): string {
  switch (format) {
    case 'tokens':
      return `${Math.round(value / 1024)}K`;
    case 'gb':
      return value === 0 ? 'Off' : `${value} GB`;
    case 'mb':
      return `${value} MB`;
    case 'megapixels':
      return `${(value / 1_000_000).toFixed(1)} MP`;
    case 'seconds':
      return `${value} s`;
    case 'plain':
      return unit ? `${value} ${unit}` : String(value);
  }
}
