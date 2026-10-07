import type { GalleryEntry } from '@/app/gallery/types';
import {
  ActivityNumbers,
  ChartLive,
  ChartStates,
  CodeBlocks,
  MarkdownAnswer,
  MarkdownStreaming,
  MarkdownStreamingLive,
  StatCards,
} from './renderers.demos';

const group = 'Primitives › Renderers';

export const gallery: GalleryEntry[] = [
  {
    id: 'renderers-markdown',
    title: 'Markdown (long answer: tables, code, lists, quote)',
    group,
    frame: 'fill',
    render: () => <MarkdownAnswer />,
  },
  {
    id: 'renderers-markdown-streaming',
    title: 'Markdown streaming (caret in a list item and in code)',
    group,
    frame: 'fill',
    render: () => <MarkdownStreaming />,
  },
  {
    id: 'renderers-markdown-streaming-live',
    title: 'Markdown streaming, live',
    group,
    frame: 'fill',
    render: () => <MarkdownStreamingLive />,
  },
  {
    id: 'renderers-code-block',
    title: 'Code blocks (python, bash, json, plain, streaming)',
    group,
    frame: 'fill',
    render: () => <CodeBlocks />,
  },
  {
    id: 'renderers-chart',
    title: 'Chart, live (tokens per second)',
    group,
    frame: 'fill',
    render: () => <ChartLive />,
  },
  {
    id: 'renderers-chart-states',
    title: 'Chart states (stopped, starting, gap)',
    group,
    frame: 'fill',
    render: () => <ChartStates />,
  },
  {
    id: 'renderers-stat-cards',
    title: 'Stat cards and meters (ready, stopped, starting)',
    group,
    frame: 'fill',
    render: () => <StatCards />,
  },
  {
    id: 'renderers-activity',
    title: 'Activity numbers and chart (as on the page)',
    group,
    frame: 'fill',
    render: () => <ActivityNumbers />,
  },
  {
    id: 'renderers-activity-stopped',
    title: 'Activity numbers and chart, stopped',
    group,
    frame: 'fill',
    render: () => <ActivityNumbers state="stopped" />,
  },
];
