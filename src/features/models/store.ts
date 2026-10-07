import { create } from 'zustand';
import type { ServeOptions } from '@/lib/splash/engine';

export interface ModelsState {
  /** The `splash serve` options being edited; passed to engine.start(). */
  launch: ServeOptions;
  selectModel: (model: string) => void;
  updateLaunch: (patch: Partial<ServeOptions>) => void;
  resetLaunch: () => void;
}

export const DEFAULT_LAUNCH: ServeOptions = { model: '', port: 8000 };

export const useModelsStore = create<ModelsState>()((set) => ({
  launch: DEFAULT_LAUNCH,
  selectModel: (model) => set((s) => ({ launch: { ...s.launch, model } })),
  updateLaunch: (patch) => set((s) => ({ launch: { ...s.launch, ...patch } })),
  resetLaunch: () => set({ launch: DEFAULT_LAUNCH }),
}));
