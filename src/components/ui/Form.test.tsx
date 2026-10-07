import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FormActionRow, FormGroup, FormRow, FormSection, FormTextButton, FormValue } from './Form';
import { Switch } from './Switch';

describe('Form', () => {
  it('renders a titled section with its group, rows and footnote', () => {
    render(
      <FormSection title="Memory & context" footnote="Coding agents need about 100K.">
        <FormGroup>
          <FormRow label="GPU memory limit" control={<FormValue>Automatic (48 GB)</FormValue>} />
          <FormRow
            label="Context length"
            help="Changed from Automatic (256K)"
            control={<FormValue>128K</FormValue>}
          />
        </FormGroup>
      </FormSection>,
    );
    expect(screen.getByRole('region', { name: 'Memory & context' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Memory & context' })).toBeInTheDocument();
    expect(screen.getByText('Changed from Automatic (256K)')).toBeInTheDocument();
    expect(screen.getByText('Coding agents need about 100K.')).toBeInTheDocument();
    expect(screen.getByText('128K')).toHaveClass('sb-form-value');
  });

  it('describes the control by the row help line and footnote', () => {
    render(
      <FormRow
        label="Text only"
        help="Frees memory for a longer context."
        footnote="Not for legacy packages."
        control={
          <Switch aria-label="Text only" checked={false} onCheckedChange={() => undefined} />
        }
      />,
    );
    expect(screen.getByRole('switch', { name: 'Text only' })).toHaveAccessibleDescription(
      'Frees memory for a longer context. Not for legacy packages.',
    );
  });

  it('disables every control in a disabled row and shows the reason instead of the help', () => {
    const onClick = vi.fn();
    render(
      <FormRow
        label="Largest image size"
        help="Lower values use less memory."
        disabled
        disabledReason="Not used while Text only is on."
        control={
          <>
            <Switch aria-label="Images" checked onCheckedChange={() => undefined} />
            <button type="button" onClick={onClick}>
              Edit…
            </button>
          </>
        }
      />,
    );
    expect(screen.getByText('Not used while Text only is on.')).toBeInTheDocument();
    expect(screen.queryByText('Lower values use less memory.')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Images' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit…' })).toBeDisabled();
  });

  it('shows an error in place of the help line and announces it', () => {
    render(
      <FormRow
        label="Port"
        help="Where the server listens."
        error="Port 8000 is in use by another app."
        control={<FormValue>8000</FormValue>}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Port 8000 is in use by another app.');
    expect(screen.queryByText('Where the server listens.')).not.toBeInTheDocument();
  });

  it('renders text and action row buttons', async () => {
    const user = userEvent.setup();
    const onRegenerate = vi.fn();
    const onUninstall = vi.fn();
    render(
      <>
        <FormTextButton onClick={onRegenerate}>Regenerate…</FormTextButton>
        <FormGroup>
          <FormActionRow destructive label="Uninstall Splash…" onClick={onUninstall} />
        </FormGroup>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Regenerate…' }));
    await user.click(screen.getByRole('button', { name: 'Uninstall Splash…' }));
    expect(onRegenerate).toHaveBeenCalledOnce();
    expect(onUninstall).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Uninstall Splash…' })).toHaveClass('is-destructive');
  });
});
