import { create } from 'zustand';
import { Settings } from '../features/settings/types/settings.types';
import { AppInfo } from '../shared/types/common.types';

interface AppState {
  settings: Settings | null;
  isIndexing: boolean;
  allApps: AppInfo[];
  isLoading: boolean;
  appError: string | null;
}

interface AppActions {
  setSettings: (settings: Settings | null) => void;
  /**
   * Patch the `general` slice of settings without re-spreading the whole tree.
   * No-op when settings haven't been loaded yet (current === null).
   * Use this instead of `setSettings({ ...current, general: { ...current.general, ... } })`
   * to keep call-sites resilient if new top-level slices are added.
   */
  updateGeneralSettings: (patch: Partial<Settings['general']>) => void;
  setIsIndexing: (indexing: boolean) => void;
  setAllApps: (apps: AppInfo[]) => void;
  setIsLoading: (loading: boolean) => void;
  setAppError: (error: string | null) => void;
}

export const useAppStore = create<AppState & AppActions>()((set) => ({
  settings: null,
  isIndexing: false,
  allApps: [],
  isLoading: false,
  appError: null,

  setSettings: (settings) => set({ settings }),
  updateGeneralSettings: (patch) =>
    set((state) =>
      state.settings
        ? {
            settings: {
              ...state.settings,
              general: { ...state.settings.general, ...patch },
            },
          }
        : state
    ),
  setIsIndexing: (isIndexing) => set({ isIndexing }),
  setAllApps: (allApps) => set({ allApps }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setAppError: (error) => set({ appError: error }),
}));
