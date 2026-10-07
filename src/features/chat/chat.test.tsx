import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ChatPage } from './ChatPage';
import { useChatStore } from './store';

describe('chat feature', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [], activeId: null, draft: '' });
  });

  it('renders the chat page', () => {
    renderWithProviders(<ChatPage />, { path: '/chat' });
    expect(screen.getByRole('heading', { name: 'What can I help with?' })).toBeInTheDocument();
  });

  it('creates and activates a conversation', () => {
    const id = useChatStore.getState().newConversation();
    const state = useChatStore.getState();
    expect(state.activeId).toBe(id);
    expect(state.conversations).toHaveLength(1);
  });
});
