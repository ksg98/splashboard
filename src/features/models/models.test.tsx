import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ModelsPage } from './ModelsPage';
import { useModelsStore } from './store';

describe('models feature', () => {
  beforeEach(() => useModelsStore.getState().resetLaunch());

  it('renders the models page', () => {
    renderWithProviders(<ModelsPage />, { path: '/models' });
    expect(screen.getByRole('heading', { name: 'Models' })).toBeInTheDocument();
  });

  it('edits launch options', () => {
    const store = useModelsStore.getState();
    store.selectModel('incoai/Qwen3.8-27B-Splash');
    store.updateLaunch({ maxContext: '128K' });
    expect(useModelsStore.getState().launch).toMatchObject({
      model: 'incoai/Qwen3.8-27B-Splash',
      maxContext: '128K',
      port: 8000,
    });
  });
});
