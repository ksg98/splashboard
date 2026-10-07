import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  modelsViewProps,
  modelsViewSearch,
  modelsViewSearchEmpty,
  modelsViewSmallMac,
  modelsViewStopped,
} from './fixtures';
import { ModelsView } from './ModelsView';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

describe('ModelsView', () => {
  it('shows the running model, the installed and available lists, and the downloads footnote', () => {
    render(<ModelsView {...modelsViewProps} />);
    expect(screen.getByRole('heading', { name: 'Models', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Models use/)).toHaveTextContent('Models use 38.0 GB on this Mac.');

    const card = screen.getByRole('region', { name: 'Running model' });
    expect(within(card).getByText('Qwen3.8-27B')).toBeInTheDocument();
    expect(within(card).getByText('Splash package · 17.6 GB · 128K context')).toBeInTheDocument();
    expect(within(card).getByText('Ready')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Stop' })).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Installed' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Available' })).toBeInTheDocument();
    // Three-line row: name, description, size · quant · format.
    expect(screen.getByText('20.4 GB · 4-bit · Splash package')).toBeInTheDocument();
    expect(
      screen.getByText('Downloading 8.6 of 19.6 GB · about 3 min · 4-bit · MLX'),
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /Downloading/ })).toHaveAttribute(
      'aria-valuenow',
      '44',
    );
    expect(screen.getByText(/~\/\.cache\/huggingface\/hub/)).toBeInTheDocument();
  });

  it('lists only Splash packages and MLX 4-bit models', () => {
    const { container } = render(<ModelsView {...modelsViewProps} />);
    const formats = [...container.querySelectorAll('.mv-row__meta')].map((line) =>
      line.textContent?.split(' · ').pop(),
    );
    expect(formats).toHaveLength(3);
    for (const format of formats) expect(['Splash package', 'MLX']).toContain(format);
  });

  it('runs a model, opens its launch settings, gets and cancels downloads', () => {
    const onRun = vi.fn();
    const onOpen = vi.fn();
    const onGet = vi.fn();
    const onCancel = vi.fn();
    render(
      <ModelsView
        {...modelsViewProps}
        onRun={onRun}
        onOpenLaunchSettings={onOpen}
        onGet={onGet}
        onCancelDownload={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run Qwen3.6-35B-A3B, Splash package' }));
    expect(onRun).toHaveBeenCalledWith('incoai/Qwen3.6-35B-A3B-Splash');
    expect(onOpen).not.toHaveBeenCalled();

    const row = screen.getByRole('button', {
      name: 'Qwen3.6-35B-A3B, Splash package. Show launch settings',
    });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('incoai/Qwen3.6-35B-A3B-Splash');

    fireEvent.click(
      screen.getByRole('button', { name: 'Get Qwen3.8-27B (MLX 4-bit), mlx-community' }),
    );
    expect(onGet).toHaveBeenCalledWith('qwen3.8-27b-mlx', 'mlx-community/Qwen3.8-27B-4bit');

    fireEvent.click(screen.getByRole('button', { name: /Stop downloading Qwen3\.6-35B-A3B/ }));
    expect(onCancel).toHaveBeenCalledWith('mlx-community/Qwen3.6-35B-A3B-4bit');
  });

  it('offers a black Start when the server is stopped', () => {
    const onStart = vi.fn();
    render(<ModelsView {...modelsViewStopped} onStart={onStart} />);
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onStart).toHaveBeenCalled();
  });

  it('shows Hugging Face results in place of the lists while searching', () => {
    render(<ModelsView {...modelsViewSearch} />);
    expect(screen.queryByRole('heading', { name: 'Installed' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hugging Face' })).toBeInTheDocument();
    expect(screen.getByText('lmstudio-community/Qwen3.8-27B-MLX-4bit')).toBeInTheDocument();
    expect(screen.getByText('Installed')).toBeInTheDocument();
    expect(
      screen.getByText(/Only Splash packages and MLX 4-bit models are listed/),
    ).toBeInTheDocument();
  });

  it('says so when nothing matches', () => {
    render(<ModelsView {...modelsViewSearchEmpty} />);
    expect(
      screen.getByText('No Splash packages or MLX 4-bit models match “llama”.'),
    ).toBeInTheDocument();
  });

  it('marks models this Mac cannot run and offers no action', () => {
    render(<ModelsView {...modelsViewSmallMac} />);
    expect(screen.getByText('No model is running')).toBeInTheDocument();
    expect(screen.getAllByText('Not compatible with this Mac')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /^Get/ })).not.toBeInTheDocument();
  });
});
