import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Composer, type ComposerProps } from './Composer';
import { draftAttachments, engineStarting, engineStopped } from './fixtures';
import type { ThinkingEffort } from './types';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function Harness(props: Partial<ComposerProps> & { initial?: string }) {
  const [value, setValue] = useState(props.initial ?? '');
  const [effort, setEffort] = useState<ThinkingEffort>('medium');
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSubmit={vi.fn()}
      effort={effort}
      onEffortChange={setEffort}
      {...props}
    />
  );
}

describe('Composer', () => {
  it('keeps Send disabled until there is text, then sends on Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    const field = screen.getByRole('textbox', { name: 'Message' });
    await user.type(field, 'Hello');
    expect(send).toBeEnabled();
    await user.type(field, '{Shift>}{Enter}{/Shift}more');
    expect(field).toHaveValue('Hello\nmore');
    await user.type(field, '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('turns Send into Stop while a reply is written', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<Harness generating onStop={onStop} />);
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('stays usable while the server is stopped, with one status line and Start now', async () => {
    const user = userEvent.setup();
    const onStartEngine = vi.fn();
    const onSubmit = vi.fn();
    render(
      <Harness
        engine={engineStopped}
        onStartEngine={onStartEngine}
        onSubmit={onSubmit}
        initial="Why is the first request slow?"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Qwen3.8-27B isn’t running. Sending a message starts it.',
    );
    await user.click(screen.getByRole('button', { name: 'Start now' }));
    expect(onStartEngine).toHaveBeenCalledTimes(1);
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeEnabled();
    await user.click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows the start phase and progress while starting', () => {
    render(<Harness engine={engineStarting} />);
    expect(screen.getByRole('status')).toHaveTextContent('Starting Qwen3.8-27B…');
    expect(screen.getByRole('status')).toHaveTextContent('Loading weights · 3 s');
    expect(screen.getByRole('meter', { name: 'Starting Qwen3.8-27B' })).toBeInTheDocument();
  });

  it('lists attachments with a remove button and takes pasted or dropped images', () => {
    const onRemoveAttachment = vi.fn();
    const onAddImages = vi.fn();
    render(
      <Harness
        attachments={draftAttachments}
        onRemoveAttachment={onRemoveAttachment}
        onAddImages={onAddImages}
      />,
    );
    expect(screen.getByText('ttft-chart.png')).toBeInTheDocument();
    expect(screen.getByText('Image · 412 KB')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove ttft-chart.png' }));
    expect(onRemoveAttachment).toHaveBeenCalledWith('img-ttft');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();

    const image = new File(['x'], 'shot.png', { type: 'image/png' });
    const text = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.paste(screen.getByRole('textbox', { name: 'Message' }), {
      clipboardData: { files: [image, text] },
    });
    expect(onAddImages).toHaveBeenLastCalledWith([image]);

    const form = screen.getByRole('form', { name: 'Message composer' });
    fireEvent.dragEnter(form, { dataTransfer: { types: ['Files'], files: [image] } });
    expect(screen.getByText('Drop images to attach')).toBeInTheDocument();
    fireEvent.drop(form, { dataTransfer: { types: ['Files'], files: [image] } });
    expect(onAddImages).toHaveBeenCalledTimes(2);
  });

  it('picks the thinking level from the pop-up', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const pill = screen.getByRole('button', { name: 'Thinking: Medium' });
    expect(pill).toHaveTextContent('Medium thinking');
    await user.click(pill);
    expect(screen.getByRole('menu', { name: 'Thinking' })).toHaveTextContent(
      'Think longest, for hard problems',
    );
    await user.click(screen.getByRole('menuitemcheckbox', { name: /High/ }));
    expect(screen.getByRole('button', { name: 'Thinking: High' })).toHaveTextContent('High thinking');
  });
});
