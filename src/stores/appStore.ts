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
  setIsIndexing: (isIndexing) => set({ isIndexing }),
  setAllApps: (allApps) => set({ allApps }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setAppError: (error) => set({ appError: error }),
}));
