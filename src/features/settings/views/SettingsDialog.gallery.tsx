import type { GalleryEntry } from '@/app/gallery/types';
import { settingsInfoUpdateAvailable, settingsValuesCustom } from './fixtures';
import { SettingsDemo } from './SettingsDemo';

export const gallery: GalleryEntry[] = [
  {
    id: 'settings-dialog-general',
    title: 'Settings › General',
    group: 'Settings',
    frame: 'fill',
    render: () => <SettingsDemo tab="general" />,
  },
  {
    id: 'settings-dialog-chat',
    title: 'Settings › Chat',
    group: 'Settings',
    frame: 'fill',
    render: () => <SettingsDemo tab="chat" />,
  },
  {
    id: 'settings-dialog-chat-custom',
    title: 'Settings › Chat › Customize (scrolled, title pinned)',
    group: 'Settings',
    frame: 'fill',
    render: () => <SettingsDemo tab="chat" customizeOpen scrollTop={150} />,
  },
  {
    id: 'settings-dialog-chat-custom-values',
    title: 'Settings › Chat › Custom values',
    group: 'Settings',
    frame: 'fill',
    render: () => <SettingsDemo tab="chat" values={settingsValuesCustom} customizeOpen />,
  },
  {
    id: 'settings-dialog-models',
    title: 'Settings › Models & downloads',
    group: 'Settings',
    frame: 'fill',
    render: () => <SettingsDemo tab="models" />,
  },
  {
    id: 'settings-dialog-updates',
    title: 'Settings › Updates',
    group: 'Settings',
    frame: 'fill',
    render: () => <SettingsDemo tab="updates" />,
  },
  {
    id: 'settings-dialog-updates-available',
    title: 'Settings › Updates (update available)',
    group: 'Settings',
    frame: 'fill',
    render: () => <SettingsDemo tab="updates" info={settingsInfoUpdateAvailable} />,
  },
  {
    id: 'settings-dialog-about',
    title: 'Settings › About',
    group: 'Settings',
    frame: 'fill',
    render: () => <SettingsDemo tab="about" />,
  },
];
