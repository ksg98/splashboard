import { create } from 'zustand';
import { getStorage } from '@/lib/storage';

/** Persisted app settings. The theme lives in the theme provider, not here. */
export interface Settings {
  /** Path to a `splash` executable; empty = auto-detect. */
  splashBinary: string;
  /** Start the engine with the last launch options when the app opens. */
  autoStartEngine: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  splashBinary: '',
  autoStartEngine: false,
};

const STORAGE_KEY = 'app';

export interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const stored = await getStorage().settings.get<Partial<Settings>>(STORAGE_KEY);
    set({ settings: { ...DEFAULT_SETTINGS, ...stored }, loaded: true });
  },
  update: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await getStorage().settings.set(STORAGE_KEY, settings);
  },
}));
