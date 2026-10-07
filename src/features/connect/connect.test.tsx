import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ConnectPage } from './ConnectPage';
import { useConnectStore } from './store';

describe('connect feature', () => {
  it('renders the connect page with the agents', () => {
    renderWithProviders(<ConnectPage />, { path: '/connect' });
    expect(screen.getByRole('heading', { name: 'Connect' })).toBeInTheDocument();
    expect(screen.getByText('OpenCode')).toBeInTheDocument();
  });

  it('selects an agent', () => {
    useConnectStore.getState().selectAgent('codex');
    expect(useConnectStore.getState().selectedAgent).toBe('codex');
  });
});
