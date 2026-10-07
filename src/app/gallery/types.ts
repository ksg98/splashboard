import type { ReactNode } from 'react';

/**
 * One previewable state of a view, shown at /__gallery/<id> (dev builds only).
 * Any file named *.gallery.tsx under src/ that exports `gallery` is picked up.
 */
export interface GalleryEntry {
  /** Unique across the app, kebab-case, e.g. "chat-thread-streaming". */
  id: string;
  /** Shown in the gallery index. */
  title: string;
  /** Groups the index, e.g. "Chat", "Primitives". */
  group: string;
  /**
   * "window": the entry draws a whole 1440×900 app window (shell included).
   * "fill": the entry fills the viewport with the window background.
   * "centered": the entry is centred on the window background with padding.
   */
  frame?: 'window' | 'fill' | 'centered';
  render: () => ReactNode;
}

export interface GalleryModule {
  gallery: GalleryEntry[];
}
