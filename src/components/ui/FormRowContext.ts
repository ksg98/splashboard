import { createContext, useContext } from 'react';

/**
 * What a FormRow tells the control inside it. The form primitives in this
 * folder (Switch, Slider, Stepper, TextField, SearchField, SecureField,
 * Segmented) read it, so a control placed in a row is disabled with the row
 * and described by the row's help, error or footnote line without extra props.
 */
export interface FormRowContextValue {
  /** id of the row's label element, for aria-labelledby. */
  labelId: string;
  /** Space-separated ids of the help / error / footnote lines, if any. */
  describedBy: string | undefined;
  disabled: boolean;
  invalid: boolean;
}

export const FormRowContext = createContext<FormRowContextValue | null>(null);

export function useFormRow(): FormRowContextValue | null {
  return useContext(FormRowContext);
}
