import type { ReactNode } from 'react';
import { FormGroup, FormRow, FormSection, FormValue } from '@/components/ui/Form';
import { StatusDot } from '@/components/ui/StatusDot';
import type { ActivityDetails } from './types';
import {
  PRECISION_LABEL,
  PRESSURE,
  contextLength,
  gbOf,
  oneDecimal,
  percentNumber,
  seconds,
  wholeNumber,
} from './wording';
import './ActivityDetailsList.css';

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <FormRow label={label} control={<FormValue className="eng-detail-value">{value}</FormValue>} />
  );
}

function Section({
  title,
  footnote,
  children,
}: {
  title: string;
  footnote?: string;
  children: ReactNode;
}) {
  return (
    <FormSection title={title} footnote={footnote} className="eng-detail-section">
      <FormGroup>{children}</FormGroup>
    </FormSection>
  );
}

export interface ActivityDetailsListProps {
  details: ActivityDetails;
}

/**
 * "Show details": one column of small System Settings groups, in the order
 * Requests, Speed, Working memory, Prompt cache, Engine, Images. Every value
 * is in plain units (GB, seconds, "1 of 4 at once").
 */
export function ActivityDetailsList({ details }: ActivityDetailsListProps) {
  const { requests, speed, workingMemory, promptCache, engine, images } = details;
  const pressure = PRESSURE[engine.memoryPressure];
  return (
    <div className="eng-detail-list">
      <Section title="Requests">
        <Row label="In progress" value={`${requests.active} of ${requests.capacity} at once`} />
        <Row label="Waiting" value={wholeNumber(requests.waiting)} />
        <Row label="Finished since start" value={wholeNumber(requests.finished)} />
      </Section>

      <Section title="Speed">
        <Row
          label="Reading prompts"
          value={
            speed.readingPromptsTokensPerSecond === null
              ? '—'
              : `${wholeNumber(speed.readingPromptsTokensPerSecond)} tok/s`
          }
        />
        <Row label="Time to first token, typical" value={seconds(speed.firstTokenTypicalSeconds)} />
        <Row
          label="Time to first token, slowest 5%"
          value={seconds(speed.firstTokenSlowestSeconds)}
        />
      </Section>

      <Section
        title="Working memory"
        footnote="The conversation the model is reading. The prompt cache’s share can be freed as soon as a new request needs it."
      >
        <Row label="In use" value={gbOf(workingMemory.inUseGB, workingMemory.capacityGB)} />
        <Row
          label="Kept for the prompt cache"
          value={`${oneDecimal(workingMemory.promptCacheGB)} GB`}
        />
        <Row label="Precision" value={PRECISION_LABEL[workingMemory.precision]} />
      </Section>

      <Section title="Prompt cache">
        <Row
          label="Reused in the last hour"
          value={
            promptCache.reuseLastHour === null
              ? '—'
              : `${percentNumber(promptCache.reuseLastHour)}%`
          }
        />
        <Row label="Tokens reused since start" value={wholeNumber(promptCache.tokensReused)} />
        <Row
          label="SSD cache"
          value={
            promptCache.ssdUsedGB === null || promptCache.ssdCapacityGB === null
              ? 'Off'
              : gbOf(promptCache.ssdUsedGB, promptCache.ssdCapacityGB)
          }
        />
      </Section>

      <Section title="Engine">
        <Row label="Model" value={<span title={engine.repo}>{engine.model}</span>} />
        <Row label="Context length" value={`${contextLength(engine.contextTokens)} tokens`} />
        <Row label="Running for" value={engine.uptime} />
        <Row
          label="Model weights"
          value={engine.weights === 'loaded' ? 'Loaded' : 'Released, reloads on next message'}
        />
        <Row
          label="Memory pressure"
          value={<StatusDot tone={pressure.tone} label={pressure.label} />}
        />
        <Row label="Restarts since start" value={wholeNumber(engine.restarts)} />
      </Section>

      {images ? (
        <Section title="Images">
          <Row label="Read since start" value={wholeNumber(images.read)} />
          <Row label="Reused from cache" value={wholeNumber(images.reused)} />
          <Row
            label="Largest"
            value={
              images.largestMegapixels === null ? '—' : `${oneDecimal(images.largestMegapixels)} MP`
            }
          />
        </Section>
      ) : null}
    </div>
  );
}
