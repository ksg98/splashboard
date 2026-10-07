import type { GalleryEntry } from '@/app/gallery/types';
import { Buttons, IconButtons, Indicators } from './basics.demos';

export const gallery: GalleryEntry[] = [
  {
    id: 'basics-buttons',
    title: 'Button: variants, sizes, states',
    group: 'Primitives',
    render: () => <Buttons />,
  },
  {
    id: 'basics-icon-buttons',
    title: 'IconButton: ghost, secondary, send and stop',
    group: 'Primitives',
    render: () => <IconButtons />,
  },
  {
    id: 'basics-indicators',
    title: 'StatusDot, Spinner, ProgressRing, Kbd',
    group: 'Primitives',
    render: () => <Indicators />,
  },
];
