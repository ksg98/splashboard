import type { GalleryEntry } from '@/app/gallery/types';
import {
  FormFieldsDemo,
  FormStatesDemo,
  LaunchAdvancedDemo,
  LaunchModelDemo,
  LaunchNetworkDemo,
} from './forms.demos';

const group = 'Primitives › Forms';

export const gallery: GalleryEntry[] = [
  {
    id: 'forms-launch-model',
    title: 'Sample form 1: preset, model, memory and context',
    group,
    frame: 'fill',
    render: () => <LaunchModelDemo />,
  },
  {
    id: 'forms-launch-network',
    title: 'Sample form 2: cache (segmented), network and security',
    group,
    frame: 'fill',
    render: () => <LaunchNetworkDemo />,
  },
  {
    id: 'forms-launch-advanced',
    title: 'Sample form 3: advanced, More options, Show command',
    group,
    frame: 'fill',
    render: () => <LaunchAdvancedDemo />,
  },
  {
    id: 'forms-launch-command',
    title: 'Sample form 4: More options closed, Show command open',
    group,
    frame: 'fill',
    render: () => <LaunchAdvancedDemo moreOpen={false} commandOpen />,
  },
  {
    id: 'forms-states',
    title: 'States: disabled with a reason, invalid, destructive',
    group,
    frame: 'fill',
    render: () => <FormStatesDemo />,
  },
  {
    id: 'forms-fields',
    title: 'Fields: text, secure, stepper, copy, search, segmented',
    group,
    frame: 'fill',
    render: () => <FormFieldsDemo />,
  },
];
