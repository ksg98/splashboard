import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  launchSettingsCommandProps,
  launchSettingsOtherProps,
  launchSettingsProps,
} from './fixtures';
import { LaunchSettingsSheet } from './LaunchSettingsSheet';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

describe('LaunchSettingsSheet', () => {
  it('renders the preset and every group of the form model', () => {
    render(<LaunchSettingsSheet {...launchSettingsProps} />);
    const dialog = screen.getByRole('dialog', { name: 'Launch settings' });
    expect(dialog).toHaveTextContent('Qwen3.8-27B · incoai/Qwen3.8-27B-Splash');
    for (const title of ['Model', 'Memory & context', 'Cache', 'Network & security', 'Advanced']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Preset' })).toHaveTextContent(
      'Recommended for this Mac (64 GB)',
    );
    expect(screen.getByText('Changed from Automatic (256K)')).toBeInTheDocument();
    expect(screen.getByText('Compact (8-bit)')).toBeInTheDocument();
    expect(screen.getByText('Full (16-bit)')).toBeInTheDocument();
    expect(screen.getByText('Restart required to apply changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and restart' })).toBeInTheDocument();
  });

  it('reports changes, actions, cancel and save', () => {
    const onChange = vi.fn();
    const onAction = vi.fn();
    const onCancel = vi.fn();
    const onSave = vi.fn();
    render(
      <LaunchSettingsSheet
        {...launchSettingsProps}
        onChange={onChange}
        onAction={onAction}
        onCancel={onCancel}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Text only' }));
    expect(onChange).toHaveBeenCalledWith('language_only', true);

    fireEvent.click(screen.getByRole('switch', { name: 'Require an API key' }));
    expect(onChange).toHaveBeenCalledWith('api_key', false);

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate…' }));
    expect(onAction).toHaveBeenCalledWith('api_key', 'regenerate');

    fireEvent.click(screen.getByRole('button', { name: 'Edit allowed web origins' }));
    expect(onAction).toHaveBeenCalledWith('allowed_origin', 'edit');

    fireEvent.click(screen.getByRole('button', { name: 'Save and restart' }));
    expect(onSave).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows More options and the equivalent splash serve command', () => {
    render(<LaunchSettingsSheet {...launchSettingsCommandProps} />);
    expect(screen.getByRole('button', { name: 'More options' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('SSD cache folder')).toBeInTheDocument();
    expect(screen.getByText(/--max-context=128K/)).toBeInTheDocument();
    expect(screen.getByText(/--model=incoai\/Qwen3\.8-27B-Splash/)).toBeInTheDocument();
  });

  it('runs another installed model from its own sheet', () => {
    render(<LaunchSettingsSheet {...launchSettingsOtherProps} />);
    expect(screen.getByText('Stops Qwen3.8-27B and starts this model.')).toBeInTheDocument();
    expect(screen.queryByText('Restart required to apply changes')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Qwen3.6-35B-A3B' })).toBeInTheDocument();
  });
});
