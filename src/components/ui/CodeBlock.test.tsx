import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock } from './CodeBlock';

const python = `import time
def wait(seconds):
    # Splash asks for this long
    time.sleep(seconds)
    return "done"`;

describe('CodeBlock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('labels the language and highlights keywords, strings and comments', () => {
    const { container } = render(<CodeBlock code={python} language="python" />);
    expect(screen.getByText('python')).toBeInTheDocument();
    const keywords = Array.from(container.querySelectorAll('.hljs-keyword')).map(
      (n) => n.textContent,
    );
    expect(keywords).toEqual(expect.arrayContaining(['import', 'def', 'return']));
    expect(container.querySelector('.hljs-string')).toHaveTextContent('"done"');
    expect(container.querySelector('.hljs-comment')).toHaveTextContent(
      '# Splash asks for this long',
    );
    expect(container.querySelector('code')).toHaveTextContent('time.sleep(seconds)');
  });

  it('renders unknown or missing languages as plain text', () => {
    const { container } = render(<CodeBlock code="<b>not html</b>" language="nonsense-lang" />);
    expect(container.querySelector('code')).toHaveTextContent('<b>not html</b>');
    expect(container.querySelector('b')).toBeNull();
    render(<CodeBlock code="plain" />);
    expect(screen.getByText('text')).toBeInTheDocument();
  });

  it('copies the code and shows Copied for a moment', async () => {
    vi.useFakeTimers();
    const onCopy = vi.fn();
    render(<CodeBlock code={python} language="python" onCopy={onCopy} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    });
    expect(onCopy).toHaveBeenCalledWith(python);
    expect(screen.getByRole('button', { name: 'Copied' })).toHaveTextContent('Copied');
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
  });

  it('draws the caret inside the code while streaming', () => {
    const { container } = render(<CodeBlock code="import time" language="python" streaming />);
    expect(container.querySelector('code .sb-caret')).not.toBeNull();
  });
});
