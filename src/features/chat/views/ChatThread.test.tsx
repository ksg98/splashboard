import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AssistantMessage } from './AssistantMessage';
import { ChatThread } from './ChatThread';
import { cancelledTurns, doneTurns, errorTurns, streamingTurns, thinkingTurns } from './fixtures';
import { MessageActions } from './MessageActions';
import { UserMessage } from './UserMessage';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('ChatThread', () => {
  // TODO: "Jump to latest" depends on scroll geometry, which jsdom doesn't lay out.
  it.skip('renders user and assistant turns with the sent image above the bubble', () => {
    render(<ChatThread turns={doneTurns} modelName="Qwen3.8-27B" />);
    expect(screen.getByText('Now make it retry when the server is busy.')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Terminal showing openai.InternalServerError 503/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('article', { name: 'Reply' })).toHaveLength(3);
    expect(
      screen.getAllByRole('status').some((node) => node.textContent?.includes('Response ready')),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Jump to latest', hidden: true }),
    ).toBeInTheDocument();
  });

  it('announces thinking without making the streaming turn a live region', () => {
    render(<ChatThread turns={thinkingTurns} modelName="Qwen3.8-27B" />);
    expect(
      screen
        .getAllByRole('status')
        .some((node) => node.textContent?.includes('Qwen3.8-27B is thinking')),
    ).toBe(true);
    expect(screen.getByText('Thinking…')).toBeInTheDocument();
  });

  it('passes regenerate and retry with the turn id', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ChatThread turns={errorTurns} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Splash stopped before the reply finished.',
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('a3');
  });
});

describe('AssistantMessage', () => {
  it('shows the live "Thinking…" row with the reasoning, and no actions', () => {
    render(
      <AssistantMessage status="thinking" content="" reasoning="Splash answers 503 when busy." />,
    );
    expect(screen.getByText('Thinking…')).toBeInTheDocument();
    expect(screen.getByText('Splash answers 503 when busy.')).toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('collapses the reasoning into "Thought for N seconds" and expands it', async () => {
    const user = userEvent.setup();
    render(
      <AssistantMessage
        status="done"
        content="Done."
        reasoning={'First paragraph.\n\nSecond paragraph.'}
        thinkingSeconds={8}
      />,
    );
    const toggle = screen.getByRole('button', { name: /Thought for 8 seconds/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('First paragraph.')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('First paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
  });

  it('streams the answer with a caret and no actions yet', () => {
    const turn = streamingTurns[streamingTurns.length - 1]!;
    const { container } = render(
      <AssistantMessage status="streaming" content={turn.content} thinkingSeconds={6} />,
    );
    expect(container.querySelector('.sb-caret')).not.toBeNull();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('says when the user stopped the reply', () => {
    const turn = cancelledTurns[cancelledTurns.length - 1]!;
    render(<AssistantMessage status="cancelled" content={turn.content} />);
    expect(screen.getByText('You stopped this reply.')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Message actions' })).toBeInTheDocument();
  });
});

describe('MessageActions', () => {
  it('toggles the per-turn stats line in plain English', async () => {
    const user = userEvent.setup();
    const onRegenerate = vi.fn();
    render(
      <MessageActions
        text="Answer"
        onRegenerate={onRegenerate}
        stats={{
          tokensPerSecond: 94,
          timeToFirstTokenSeconds: 0.42,
          promptTokens: 3120,
          cachedTokens: 2786,
          thinkingTokens: 418,
          outputTokens: 642,
          finishReason: 'length',
        }}
      />,
    );
    const toolbar = screen.getByRole('toolbar', { name: 'Message actions' });
    expect(within(toolbar).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    await user.click(within(toolbar).getByRole('button', { name: 'Regenerate' }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);

    const info = within(toolbar).getByRole('button', { name: 'Show stats' });
    await user.click(info);
    const line = screen.getByText(/tok\/s/).closest('.ch-stats');
    expect(line).toHaveTextContent(
      '94 tok/s · 0.42 s to first token · 2,786 of 3,120 prompt tokens cached · 418 thinking tokens · 642 output tokens · cut off at the reply length limit',
    );
    expect(within(toolbar).getByRole('button', { name: 'Hide stats' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('UserMessage', () => {
  it('renders the bubble and opens images when asked', async () => {
    const user = userEvent.setup();
    const onOpenImage = vi.fn();
    render(
      <UserMessage
        content="Look at this"
        images={[{ id: 'i1', name: 'shot.png', src: 'data:image/png;base64,' }]}
        onOpenImage={onOpenImage}
      />,
    );
    expect(screen.getByText('Look at this')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open image: shot.png' }));
    expect(onOpenImage).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }));
  });
});
