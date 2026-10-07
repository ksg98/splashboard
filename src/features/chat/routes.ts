import { MessagesSquare } from 'lucide-react';
import type { FeatureDefinition } from '@/app/feature-types';
import { ChatPage } from './ChatPage';

export const chatFeature: FeatureDefinition = {
  id: 'chat',
  path: 'chat',
  layout: 'shell',
  nav: { label: 'Chat', icon: MessagesSquare, order: 10 },
  // Sub-routes (e.g. a conversation at chat/:id) go in `children` here.
  route: { Component: ChatPage },
};
