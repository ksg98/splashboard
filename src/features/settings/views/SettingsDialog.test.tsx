import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { settingsInfo, settingsValues } from './fixtures';
import { matchPreset, summarizeSampling } from './sampling';
import { SettingsDialog, type SettingsDialogProps } from './SettingsDialog';

beforeAll(() => {
  // jsdom has no ResizeObserver; Radix switches and sliders measure themselves.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function renderDialog(overrides: Partial<SettingsDialogProps> = {}) {
  const props: SettingsDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    values: settingsValues,
    onChange: vi.fn(),
    info: settingsInfo,
    onCheckForUpdates: vi.fn(),
    onUninstallSplash: vi.fn(),
    onChooseFolder: vi.fn(),
    onTestToken: vi.fn(),
    ...overrides,
  };
  render(<SettingsDialog {...props} />);
  return props;
}

describe('SettingsDialog', () => {
  it('opens on General with a tab list and a pinned page title', async () => {
    const props = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    const tabs = within(dialog).getByRole('tablist', { name: 'Settings sections' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['General', 'Chat', 'Models & downloads', 'Updates', 'About']);
    expect(within(dialog).getByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(within(dialog).getByRole('tabpanel', { name: 'General' })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Dark' }));
    expect(props.onChange).toHaveBeenCalledWith({ appearance: 'dark' });

    await userEvent.click(
      within(dialog).getByRole('switch', { name: 'Keep running when Splashboard quits' }),
    );
    expect(props.onChange).toHaveBeenCalledWith({ keepRunningOnQuit: true });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close settings' }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('switches tabs and shows Chat with the sampling controls behind Customize', async () => {
    const onTabChange = vi.fn();
    renderDialog({ onTabChange });
    await userEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(onTabChange).toHaveBeenCalledWith('chat');
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByText('Temperature 1.00 · Top P 0.95 · Top K 20')).toBeInTheDocument();

    const customize = screen.getByRole('button', { name: 'Customize' });
    expect(customize).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(customize);
    expect(customize).toHaveAttribute('aria-expanded', 'true');
    for (const name of [
      'Temperature',
      'Top P',
      'Min P',
      'Presence penalty',
      'Frequency penalty',
      'Repetition penalty',
    ]) {
      expect(screen.getByRole('slider', { name })).toBeInTheDocument();
    }
  });

  it('marks edited sampling values as Custom', async () => {
    const props = renderDialog({ defaultTab: 'chat', defaultCustomizeOpen: true });
    const temperature = screen.getByRole('slider', { name: 'Temperature' });
    temperature.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(props.onChange).toHaveBeenCalledWith({
      sampling: { ...settingsValues.sampling, temperature: 1.05 },
      samplingPreset: 'custom',
    });
  });

  it('shows the Hugging Face account, the download folder and the space models use', async () => {
    const props = renderDialog({ defaultTab: 'models' });
    expect(screen.getByRole('heading', { name: 'Models & downloads' })).toBeInTheDocument();
    expect(screen.getByText('Signed in as ada. Kept in your Keychain.')).toBeInTheDocument();
    expect(screen.getByText('~/.cache/huggingface/hub')).toBeInTheDocument();
    expect(screen.getByText('53.6 GB')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose download folder' }));
    expect(props.onChooseFolder).toHaveBeenCalledTimes(1);
  });

  it('checks for updates and offers to uninstall Splash', async () => {
    const props = renderDialog({ defaultTab: 'updates' });
    expect(screen.getByText('Splash 1.2.0')).toBeInTheDocument();
    expect(
      screen.getByText('Up to date (latest is 1.2.0). Checked today at 11:02.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Splashboard 0.1.0')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(props.onCheckForUpdates).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Uninstall Splash…' }));
    expect(props.onUninstallSplash).toHaveBeenCalledTimes(1);
  });

  it('lists only Splash packages and MLX builds, never GGUF', async () => {
    renderDialog({ defaultTab: 'chat' });
    await userEvent.click(screen.getByRole('button', { name: 'Default model' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual([
      'Qwen3.8-27BSplash package · 17.6 GB',
      'Qwen3.6-35B-A3BSplash package · 20.4 GB',
      'Qwen3.8-27B (MLX 4-bit)mlx-community · 15.6 GB',
    ]);
    expect(document.body.textContent).not.toMatch(/gguf/i);
  });

  it('shows the versions and the Mac in About', () => {
    renderDialog({ defaultTab: 'about' });
    expect(screen.getByText('MacBook Pro · M3 Max · 64 GB')).toBeInTheDocument();
    expect(screen.getByText('127.0.0.1:8000')).toBeInTheDocument();
  });
});

describe('sampling helpers', () => {
  it('matches presets and summarizes values', () => {
    expect(matchPreset(settingsInfo.samplingPresets, settingsValues.sampling)?.id).toBe(
      'sampling-thinking',
    );
    expect(
      matchPreset(settingsInfo.samplingPresets, { ...settingsValues.sampling, minP: 0.05 }),
    ).toBeUndefined();
    expect(summarizeSampling({ ...settingsValues.sampling, topK: 0 })).toBe(
      'Temperature 1.00 · Top P 0.95 · Top K off',
    );
  });
});
