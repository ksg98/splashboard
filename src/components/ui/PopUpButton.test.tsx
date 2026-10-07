import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FormGroup, FormRow } from './Form';
import { PopUpButton } from './PopUpButton';
import { thinkingOptions, versionOptions } from './overlays.fixtures';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('PopUpButton', () => {
  it('shows the value, checks it in the menu and reports a new choice', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PopUpButton
        aria-label="Thinking"
        variant="plain"
        heading="Thinking"
        value="medium"
        valueLabel="Medium thinking"
        options={thinkingOptions}
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Thinking' });
    expect(trigger).toHaveTextContent('Medium thinking');
    expect(trigger).toHaveAccessibleDescription('Medium thinking');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveClass('sb-popup--plain');

    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Thinking' });
    expect(menu).toHaveTextContent('Think longest, for hard problems');
    expect(screen.getByRole('menuitemradio', { name: /Medium/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: /Low/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    await user.click(screen.getByRole('menuitemradio', { name: /High/ }));
    expect(onChange).toHaveBeenCalledWith('high');
  });

  it('is a filled macOS pop-up by default and follows a disabled FormRow', () => {
    render(
      <FormGroup>
        <FormRow
          label="Version"
          help="MLX 4-bit builds Splash can run"
          disabled
          control={
            <PopUpButton
              aria-label="Version"
              value="mlx-community"
              options={versionOptions}
              onChange={vi.fn()}
            />
          }
        />
      </FormGroup>,
    );
    const trigger = screen.getByRole('button', { name: 'Version' });
    expect(trigger).toHaveClass('sb-popup--filled', 'sb-popup--sm');
    expect(trigger).toHaveTextContent('MLX 4-bit');
    expect(trigger).toBeDisabled();
  });
});
