import { Disclosure } from '@/components/ui/Disclosure';
import { FormGroup, FormRow, FormSection } from '@/components/ui/Form';
import { PopUpButton } from '@/components/ui/PopUpButton';
import { Slider } from '@/components/ui/Slider';
import { Stepper } from '@/components/ui/Stepper';
import { TextField } from '@/components/ui/TextField';
import { matchPreset, summarizeSampling } from './sampling';
import type { SamplingValues, SettingsPaneProps, ThinkingLevel } from './types';

const THINKING: { value: ThinkingLevel; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'Answer right away, no thinking' },
  { value: 'low', label: 'Low', description: 'Think briefly' },
  { value: 'medium', label: 'Medium', description: 'Balanced' },
  { value: 'xhigh', label: 'High', description: 'Think longest, for hard problems' },
];

const CUSTOM_FOOTNOTE =
  'Your own values. Splashboard sends only the values that differ from Splash’s defaults.';

const two = (value: number) => value.toFixed(2);

type SliderKey = Exclude<keyof SamplingValues, 'topK'>;

/** Six of the seven sampling controls (Top K is a stepper), with docs/splash-params.json ranges. */
const SLIDERS: Record<
  SliderKey,
  { label: string; help: string; min: number; max: number; step: number }
> = {
  temperature: {
    label: 'Temperature',
    help: 'Higher gives more varied replies.',
    min: 0,
    max: 2,
    step: 0.05,
  },
  topP: {
    label: 'Top P',
    help: 'Only consider the most likely words that add up to this share.',
    min: 0.01,
    max: 1,
    step: 0.01,
  },
  minP: {
    label: 'Min P',
    help: 'Skip words far less likely than the top choice. 0 turns it off.',
    min: 0,
    max: 1,
    step: 0.01,
  },
  presencePenalty: {
    label: 'Presence penalty',
    help: 'Discourage repeating topics.',
    min: -2,
    max: 2,
    step: 0.1,
  },
  frequencyPenalty: {
    label: 'Frequency penalty',
    help: 'Discourage repeating exact words.',
    min: -2,
    max: 2,
    step: 0.1,
  },
  repetitionPenalty: {
    label: 'Repetition penalty',
    help: 'Discourage any repeats. 1.00 turns it off.',
    min: 0.01,
    max: 2,
    step: 0.01,
  },
};

export interface ChatPaneProps extends SettingsPaneProps {
  /** Opens "Customize" on first render (previews, deep links). */
  defaultCustomizeOpen?: boolean;
}

/** Chat: defaults for new chats, the sampling preset with Customize, and length. */
export function ChatPane({ values, onChange, info, defaultCustomizeOpen = false }: ChatPaneProps) {
  const presets = info.samplingPresets;
  const current = presets.find((preset) => preset.id === values.samplingPreset);
  const presetOptions = [
    ...presets.map((preset) => ({
      value: preset.id,
      label: preset.label,
      description: preset.description,
    })),
    ...(current ? [] : [{ value: 'custom', label: 'Custom', description: 'Your own values' }]),
  ];

  const setSampling = (patch: Partial<SamplingValues>) => {
    const sampling = { ...values.sampling, ...patch };
    onChange({ sampling, samplingPreset: matchPreset(presets, sampling)?.id ?? 'custom' });
  };

  const sliderRow = (key: SliderKey) => {
    const spec = SLIDERS[key];
    return (
      <FormRow
        label={spec.label}
        help={spec.help}
        control={
          <Slider
            aria-label={spec.label}
            value={values.sampling[key]}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            formatValue={two}
            onChange={(value) => setSampling({ [key]: value })}
          />
        }
      />
    );
  };

  return (
    <>
      <FormSection>
        <FormGroup>
          <FormRow
            label="Default model"
            control={
              <PopUpButton
                aria-label="Default model"
                value={values.defaultModel}
                options={info.models}
                onChange={(defaultModel) => onChange({ defaultModel })}
                align="end"
              />
            }
          />
          <FormRow
            label="Thinking"
            help="For new chats. Change it per chat in the composer."
            control={
              <PopUpButton
                aria-label="Thinking"
                heading="Thinking"
                value={values.thinking}
                options={THINKING}
                onChange={(thinking) => onChange({ thinking })}
                align="end"
              />
            }
          />
        </FormGroup>
      </FormSection>

      <FormSection title="Sampling" footnote={current?.footnote ?? CUSTOM_FOOTNOTE}>
        <FormGroup>
          <FormRow
            label="Preset"
            help={<span className="sd-num">{summarizeSampling(values.sampling)}</span>}
            control={
              <PopUpButton
                aria-label="Sampling preset"
                value={current ? current.id : 'custom'}
                options={presetOptions}
                onChange={(id) => {
                  const preset = presets.find((candidate) => candidate.id === id);
                  if (preset)
                    onChange({ samplingPreset: preset.id, sampling: { ...preset.values } });
                }}
                align="end"
              />
            }
          />
          <Disclosure variant="row" label="Customize" defaultOpen={defaultCustomizeOpen}>
            {sliderRow('temperature')}
            {sliderRow('topP')}
            <FormRow
              label="Top K"
              help="Only consider this many likely words. 0 turns the limit off."
              control={
                <Stepper
                  aria-label="Top K"
                  value={values.sampling.topK}
                  min={0}
                  max={200}
                  step={1}
                  onChange={(topK) => setSampling({ topK })}
                />
              }
            />
            {sliderRow('minP')}
            {sliderRow('presencePenalty')}
            {sliderRow('frequencyPenalty')}
            {sliderRow('repetitionPenalty')}
          </Disclosure>
        </FormGroup>
      </FormSection>

      <FormSection title="Length">
        <FormGroup>
          <FormRow
            label="Longest reply"
            help="Thinking counts toward this."
            control={
              <Stepper
                aria-label="Longest reply in tokens"
                value={values.maxTokens}
                min={256}
                max={262144}
                step={256}
                unit="tokens"
                width={96}
                onChange={(maxTokens) => onChange({ maxTokens })}
              />
            }
          />
          <FormRow
            label="Seed"
            help="Set one to repeat a reply exactly."
            control={
              <TextField
                aria-label="Seed"
                value={values.seed === null ? '' : String(values.seed)}
                placeholder="Random"
                inputMode="numeric"
                align="right"
                width={96}
                onChange={(text) => {
                  const digits = text.replace(/\D/g, '');
                  onChange({ seed: digits === '' ? null : Number(digits) });
                }}
              />
            }
          />
        </FormGroup>
      </FormSection>
    </>
  );
}
