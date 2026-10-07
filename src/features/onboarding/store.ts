import { create } from 'zustand';

export type OnboardingStep = 'detect' | 'model' | 'done';

export interface OnboardingState {
  step: OnboardingStep;
  setStep: (step: OnboardingStep) => void;
}

export const useOnboardingStore = create<OnboardingState>()((set) => ({
  step: 'detect',
  setStep: (step) => set({ step }),
}));
