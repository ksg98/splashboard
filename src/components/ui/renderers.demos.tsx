/*
 * Demo compositions of the renderer primitives for renderers.gallery.tsx.
 * Gallery only; not used by the app.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Chart, type ChartData } from './Chart';
import { CodeBlock } from './CodeBlock';
import { Markdown } from './Markdown';
import { DotsMeter, MeterBar } from './Meter';
import { StatCard, StatGrid, STAT_EMPTY_VALUE } from './StatCard';
import {
  answerMarkdown,
  chartSeries,
  codeSamples,
  statSample,
  streamingInCode,
  streamingInList,
  tokensPerSecondAt,
  tokensPerSecondMinute,
  tokensPerSecondWithGap,
} from './renderers.fixtures';

const FIXED_END = 1_780_000_000;

function Column({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div style={{ maxWidth: width, margin: '0 auto', padding: '56px 24px 64px' }}>{children}</div>
  );
}

export function MarkdownAnswer() {
  return (
    <Column width={760}>
      <Markdown>{answerMarkdown}</Markdown>
    </Column>
  );
}

export function MarkdownStreaming() {
  return (
    <Column width={760}>
      <Markdown streaming>{streamingInList}</Markdown>
      <hr
        style={{ margin: '40px 0', border: 0, borderTop: '1px solid var(--hairline)' }}
        aria-hidden="true"
      />
      <Markdown streaming>{streamingInCode}</Markdown>
    </Column>
  );
}

/** Streams the long answer word by word, then starts over. */
export function MarkdownStreamingLive() {
  const words = answerMarkdown.split(/(?<=\s)/);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCount((value) => (value >= words.length + 20 ? 0 : value + 3));
    }, 60);
    return () => window.clearInterval(timer);
  }, [words.length]);
  const done = count >= words.length;
  return (
    <Column width={760}>
      <Markdown streaming={!done}>{words.slice(0, count).join('')}</Markdown>
    </Column>
  );
}

export function CodeBlocks() {
  return (
    <Column width={760}>
      <CodeBlock language="python" code={codeSamples.python} />
      <CodeBlock language="bash" code={codeSamples.bash} />
      <CodeBlock language="json" code={codeSamples.json} />
      <CodeBlock code={codeSamples.long} />
      <CodeBlock
        language="python"
        code={codeSamples.python.split('\n').slice(0, 7).join('\n')}
        streaming
      />
    </Column>
  );
}

function useLiveMinute(): ChartData {
  const [step, setStep] = useState(60);
  useEffect(() => {
    const timer = window.setInterval(() => setStep((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const xs: number[] = [];
  const ys: (number | null)[] = [];
  for (let index = step - 60; index < step; index += 1) {
    xs.push(FIXED_END + index);
    // Repeat the reference minute, so the dip scrolls through.
    ys.push(tokensPerSecondAt(((index % 60) + 60) % 60));
  }
  return [xs, ys];
}

export function ChartLive() {
  const data = useLiveMinute();
  return (
    <Column width={880}>
      <Chart
        title="Tokens per second"
        readout="Last minute"
        data={data}
        series={chartSeries}
        xWindow={59}
      />
    </Column>
  );
}

export function ChartStates() {
  return (
    <Column width={880}>
      <div style={{ display: 'grid', gap: 40 }}>
        <Chart
          title="Tokens per second"
          readout="Last minute"
          data={[[], []]}
          series={chartSeries}
          yMax={120}
          emptyMessage="Start Qwen3.8-27B to see its speed"
        />
        <Chart
          title="Tokens per second"
          readout="Last minute"
          data={[[], []]}
          series={chartSeries}
          yMax={120}
          emptyMessage="Speed appears once Qwen3.8-27B is ready"
        />
        <Chart
          title="Tokens per second, with a gap"
          readout="Last minute"
          data={tokensPerSecondWithGap(FIXED_END)}
          series={chartSeries}
        />
      </div>
    </Column>
  );
}

function LiveCards() {
  const { speed, acceptance, memory, cache } = statSample;
  return (
    <StatGrid>
      <StatCard label="Speed" value={speed.value} unit={speed.unit} caption={speed.caption} />
      <StatCard
        label="Draft acceptance"
        value={acceptance.value}
        unit={acceptance.unit}
        caption={acceptance.caption}
      >
        <DotsMeter filled={acceptance.kept} total={acceptance.of} aria-label="Draft tokens kept" />
      </StatCard>
      <StatCard label="Memory" value={memory.value} unit={memory.unit}>
        <MeterBar
          value={memory.used / memory.total}
          aria-label="GPU memory in use"
          valueText={`${memory.used} of ${memory.total} GB`}
        />
      </StatCard>
      <StatCard
        label="Prompt cache"
        value={cache.value}
        unit={cache.unit}
        caption={cache.caption}
      />
    </StatGrid>
  );
}

function OffCards({ caption }: { caption: string }) {
  return (
    <StatGrid>
      {['Speed', 'Draft acceptance', 'Memory', 'Prompt cache'].map((label) => (
        <StatCard key={label} label={label} value={STAT_EMPTY_VALUE} caption={caption} />
      ))}
    </StatGrid>
  );
}

const sectionLabel = {
  margin: '0 0 12px 2px',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
} as const;

export function StatCards() {
  return (
    <Column width={880}>
      <p style={sectionLabel}>Ready</p>
      <LiveCards />
      <p style={{ ...sectionLabel, marginTop: 32 }}>Stopped</p>
      <OffCards caption="Not running" />
      <p style={{ ...sectionLabel, marginTop: 32 }}>Starting</p>
      <OffCards caption="Starting…" />
      <p style={{ ...sectionLabel, marginTop: 32 }}>Meters</p>
      <div style={{ display: 'grid', gap: 16, maxWidth: 320 }}>
        <MeterBar value={0.654} aria-label="GPU memory in use" valueText="31.4 of 48 GB" />
        <MeterBar value={0.42} size="lg" aria-label="Download progress" />
        <div style={{ display: 'flex', gap: 16 }}>
          <DotsMeter filled={7} total={7} aria-label="Draft tokens kept" />
          <DotsMeter filled={5.6} total={7} aria-label="Draft tokens kept" />
          <DotsMeter filled={2.4} total={7} aria-label="Draft tokens kept" />
          <DotsMeter filled={0} total={7} aria-label="Draft tokens kept" />
        </div>
      </div>
    </Column>
  );
}

/** The Activity page's numbers and chart, laid out as in the reference (880 px column). */
export function ActivityNumbers({ state = 'ready' }: { state?: 'ready' | 'stopped' }) {
  const live = useLiveMinute();
  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '142px 0 64px' }}>
      {state === 'ready' ? <LiveCards /> : <OffCards caption="Not running" />}
      <div style={{ marginTop: 36 }}>
        {state === 'ready' ? (
          <Chart
            title="Tokens per second"
            readout="Last minute"
            data={live}
            series={chartSeries}
            xWindow={59}
          />
        ) : (
          <Chart
            title="Tokens per second"
            readout="Last minute"
            data={tokensPerSecondMinute(FIXED_END)}
            series={chartSeries}
            yMax={120}
            emptyMessage="Start Qwen3.8-27B to see its speed"
          />
        )}
      </div>
    </div>
  );
}
