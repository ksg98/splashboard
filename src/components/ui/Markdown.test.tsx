import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Markdown } from './Markdown';
import { answerMarkdown, streamingInCode, streamingInList } from './renderers.fixtures';

describe('Markdown', () => {
  it('renders headings, tables, lists, quotes, inline code and code blocks', () => {
    const { container } = render(<Markdown>{answerMarkdown}</Markdown>);
    expect(screen.getByRole('heading', { level: 2, name: 'Side by side' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Qwen3.8-27B' })).toBeInTheDocument();
    expect(within(table).getByText('92 tok/s')).toBeInTheDocument();
    expect(container.querySelector('ol > li')).toHaveTextContent('Coding agents');
    expect(container.querySelector('blockquote')).toHaveTextContent('10 minutes');
    expect(container.querySelector('.sb-md__code')).toHaveTextContent('incoai/Qwen3.8-27B-Splash');
    const blocks = container.querySelectorAll('.sb-code');
    expect(blocks).toHaveLength(2);
    expect(within(blocks[1] as HTMLElement).getByText('python')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Not done' })).toBeInTheDocument();
  });

  it('never renders raw HTML from the reply', () => {
    const { container } = render(
      <Markdown>{'Use <b>bold</b> and <script>alert(1)</script> here.'}</Markdown>,
    );
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent('Use <b>bold</b> and <script>alert(1)</script> here.');
  });

  it('hands links to onLinkClick instead of navigating, and turns images into links', () => {
    const onLinkClick = vi.fn();
    render(
      <Markdown onLinkClick={onLinkClick}>
        {
          'See the [model card](https://huggingface.co/incoai/Qwen3.8-27B-Splash) and ![chart](https://example.com/c.png)'
        }
      </Markdown>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'model card' }));
    expect(onLinkClick).toHaveBeenCalledWith('https://huggingface.co/incoai/Qwen3.8-27B-Splash');
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'chart' }));
    expect(onLinkClick).toHaveBeenLastCalledWith('https://example.com/c.png');
  });

  it('drops unsafe link protocols', () => {
    render(<Markdown>{'[click](javascript:alert(1))'}</Markdown>);
    expect(screen.getByText('click').closest('a')?.getAttribute('href') ?? '').not.toContain(
      'javascript',
    );
  });

  it('puts the streaming caret at the end of the last list item', () => {
    const { container } = render(<Markdown streaming>{streamingInList}</Markdown>);
    const carets = container.querySelectorAll('.sb-caret');
    expect(carets).toHaveLength(1);
    expect(carets[0]?.closest('li')).toHaveTextContent('never asks faster than');
    expect(carets[0]?.closest('li')).toBe(container.querySelector('ul > li:last-child'));
  });

  it('puts the caret inside a code block that is still arriving', () => {
    const { container } = render(<Markdown streaming>{streamingInCode}</Markdown>);
    const carets = container.querySelectorAll('.sb-caret');
    expect(carets).toHaveLength(1);
    expect(carets[0]?.closest('code')).not.toBeNull();
  });

  it('shows no caret when not streaming', () => {
    const { container } = render(<Markdown>{streamingInList}</Markdown>);
    expect(container.querySelector('.sb-caret')).toBeNull();
  });
});
