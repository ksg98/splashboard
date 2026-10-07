import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { EnginePage } from './EnginePage';
import { MAX_SAMPLES, useTelemetryStore } from './store';

describe('engine feature', () => {
  beforeEach(() => useTelemetryStore.getState().reset());

  it('renders the engine page', () => {
    renderWithProviders(<EnginePage />, { path: '/engine' });
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
  });

  it('keeps a bounded sample window', () => {
    const { addSample } = useTelemetryStore.getState();
    for (let t = 0; t < MAX_SAMPLES + 5; t++) addSample({ t });
    const { samples } = useTelemetryStore.getState();
    expect(samples).toHaveLength(MAX_SAMPLES);
    expect(samples[0]?.t).toBe(5);
  });
});
