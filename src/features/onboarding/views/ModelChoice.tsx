import { Check } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/Button';
import { FirstRunSheet } from './FirstRunSheet';
import { formatModelMeta } from './format';
import type { ModelOption } from './types';
import './ModelChoice.css';

export interface ModelChoiceProps {
  /** Splash packages and MLX 4-bit models this Mac can run. */
  options: readonly ModelOption[];
  /** The chosen model's id. */
  value: string;
  onChange: (id: string) => void;
  /** Download the chosen model. */
  onConfirm: () => void;
  onCancel: () => void;
  /** This Mac's memory, for the "Recommended for 64 GB" tag. */
  memoryGb?: number;
  /** Default "Step 2 of 3". */
  stepLabel?: string;
}

/** Step 2, "Change…": pick the model to download, then download it. */
export function ModelChoice({
  options,
  value,
  onChange,
  onConfirm,
  onCancel,
  memoryGb,
  stepLabel = 'Step 2 of 3',
}: ModelChoiceProps) {
  const name = useId();
  const chosen = options.find((option) => option.id === value);
  const tag = memoryGb ? `Recommended for ${memoryGb} GB` : 'Recommended';

  return (
    <FirstRunSheet
      title="Choose a model"
      subtitle={stepLabel}
      onEscape={onCancel}
      note="You can add more later in Models."
      actions={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={!chosen || chosen.unavailableReason !== undefined}
          >
            {chosen ? `Download ${chosen.name}` : 'Download'}
          </Button>
        </>
      }
    >
      <fieldset className="sb-fr-models">
        <legend className="sr-only">Model to download</legend>
        <div className="sb-fr-models__group">
          {options.map((option) => {
            const checked = option.id === value;
            const disabled = option.unavailableReason !== undefined;
            const descId = `${name}-${option.id}-desc`;
            return (
              <label
                key={option.id}
                className="sb-fr-model"
                data-checked={checked || undefined}
                data-disabled={disabled || undefined}
                title={option.id}
              >
                <input
                  className="sb-fr-model__input"
                  type="radio"
                  name={name}
                  value={option.id}
                  checked={checked}
                  disabled={disabled}
                  aria-label={option.recommended ? `${option.name}, ${tag}` : option.name}
                  aria-describedby={descId}
                  onChange={() => onChange(option.id)}
                />
                <span className="sb-fr-model__text">
                  <span className="sb-fr-model__name">
                    {option.name}
                    {option.recommended ? <span className="sb-fr-model__tag">{tag}</span> : null}
                  </span>
                  <span id={descId}>
                    <span className="sb-fr-model__desc">{option.description}</span>
                    <span className="sb-fr-model__meta">
                      {option.unavailableReason ?? formatModelMeta(option)}
                    </span>
                  </span>
                </span>
                <span className="sb-fr-model__check" aria-hidden>
                  {checked ? <Check strokeWidth={2} /> : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </FirstRunSheet>
  );
}
