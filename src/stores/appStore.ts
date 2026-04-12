import { create } from 'zustand';
import { Settings } from '../features/settings/types/settings.types';

interface AppState {
  settings: Settings | null;
  isIndexing: boolean;
}

interface AppActions {
  setSettings: (settings: Settings | null) => void;
  setIsIndexing: (indexing: boolean) => void;
}

export const useAppStore = create<AppState & AppActions>()((set) => ({
  settings: null,
  isIndexing: false,

  setSettings: (settings) => set({ settings }),
  setIsIndexing: (isIndexing) => set({ isIndexing }),
}));
