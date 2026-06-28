import { create } from 'zustand';
import { SearchResult } from '../shared/types/common.types';
import { useUiStore } from './uiStore';

interface SearchState {
  searchQuery: string;
  results: SearchResult[];
  selectedIndex: number;
  searchError: string | null;
  showSnowEffect: boolean;
  isSearching: boolean;
}

interface SearchActions {
  setQuery: (query: string) => void;
  setResults: (results: SearchResult[]) => void;
  setSelectedIndex: (index: number | ((prev: number) => number)) => void;
  setSearchError: (error: string | null) => void;
  setShowSnowEffect: (show: boolean) => void;
  setIsSearching: (isSearching: boolean) => void;
  clearSearch: () => void;
  updateResultMetadata: (pluginId: string, opts: { title?: string; subtitle?: string }) => void;
}

export const useSearchStore = create<SearchState & SearchActions>()((set) => ({
  searchQuery: '',
  results: [],
  selectedIndex: 0,
  searchError: null,
  showSnowEffect: false,
  isSearching: false,

  setQuery: (query) => {
    // Derive view transition synchronously from prefix so the emoji picker
    // opens/closes in the same render as the query update (no second pass via effect).
    const ui = useUiStore.getState();
    if (query.startsWith(':')) {
      ui.setActiveView({ type: 'emoji', initialQuery: query.substring(1) });
    } else if (ui.activeView.type === 'emoji') {
      ui.setActiveView({ type: 'search' });
    }
    set({ searchQuery: query });
  },
  setResults: (results) => set({ results, selectedIndex: 0 }),
  setSelectedIndex: (indexOrFn) =>
    set((state) => ({
      selectedIndex: typeof indexOrFn === 'function' ? indexOrFn(state.selectedIndex) : indexOrFn,
    })),
  setSearchError: (error) => set({ searchError: error }),
  setShowSnowEffect: (show) => set({ showSnowEffect: show }),
  setIsSearching: (isSearching) => set({ isSearching }),
  clearSearch: () =>
    set({ searchQuery: '', results: [], selectedIndex: 0, showSnowEffect: false, isSearching: false }),
  updateResultMetadata: (pluginId, opts) =>
    set((state) => ({
      results: state.results.map((r) => {
        const data = r.data as { pluginId?: string };
        if (data.pluginId !== pluginId) return r;
        return {
          ...r,
          ...(opts.title !== undefined && { title: opts.title }),
          ...(opts.subtitle !== undefined && { subtitle: opts.subtitle }),
        };
      }),
    })),
}));
