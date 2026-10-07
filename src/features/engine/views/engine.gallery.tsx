import type { GalleryEntry } from '@/app/gallery/types';
import { ActivityView, type ActivityViewProps } from './ActivityView';
import * as fx from './fixtures';
import { GalleryCollapsedWindow, GalleryWindow, type GalleryEngineState } from './GalleryWindow';

const noop = () => undefined;

const base: Omit<ActivityViewProps, 'status' | 'stats' | 'speed' | 'details'> = {
  model: fx.DEMO_MODEL,
  log: fx.log,
  onStart: noop,
  onStop: noop,
  onRestart: noop,
  onSaveLog: noop,
};

function activity(
  id: string,
  title: string,
  state: GalleryEngineState,
  props: Partial<ActivityViewProps> & Pick<ActivityViewProps, 'status'>,
): GalleryEntry {
  return {
    id,
    title,
    group: 'Engine',
    frame: 'window',
    render: () => (
      <GalleryWindow state={state}>
        <ActivityView stats={null} speed={null} details={null} {...base} {...props} />
      </GalleryWindow>
    ),
  };
}

const live = { stats: fx.stats, speed: fx.speedHistory, details: fx.details };

export const gallery: GalleryEntry[] = [
  activity('engine-activity', 'Activity · Thinking', 'busy', { status: fx.status.busy, ...live }),
  activity('engine-activity-ready', 'Activity · Ready', 'ready', {
    status: fx.status.ready,
    ...live,
    details: { ...fx.details, requests: { ...fx.details.requests, active: 0 } },
  }),
  activity('engine-activity-idle', 'Activity · Weights released', 'ready', {
    status: fx.status.idle,
    stats: fx.idleStats,
    speed: fx.idleSpeedHistory,
    details: fx.idleDetails,
  }),
  activity('engine-activity-starting', 'Activity · Starting', 'starting', {
    status: fx.status.starting,
  }),
  activity('engine-activity-stopped', 'Activity · Stopped', 'stopped', {
    status: fx.status.stopped,
  }),
  activity('engine-activity-failed', 'Activity · Couldn’t start', 'failed', {
    status: fx.status.failed,
    log: fx.failedLog,
  }),
  activity('engine-activity-details', 'Activity · Show details', 'busy', {
    status: fx.status.busy,
    ...live,
    defaultDetailsOpen: true,
  }),
  activity('engine-activity-log', 'Activity · Log sheet', 'busy', {
    status: fx.status.busy,
    ...live,
    defaultLogOpen: true,
  }),
  ...(['busy', 'starting', 'stopped', 'failed'] as const).map((state): GalleryEntry => ({
    id: `engine-popover-${state}`,
    title: `Engine popover · ${fx.popover[state].state.label}`,
    group: 'Engine',
    frame: 'window',
    render: () => <GalleryWindow state={state} popoverOpen />,
  })),
  {
    id: 'engine-collapsed',
    title: 'Engine chip · sidebar hidden',
    group: 'Engine',
    frame: 'window',
    render: () => <GalleryCollapsedWindow />,
  },
];
