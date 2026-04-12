import { create } from 'zustand';
import { SearchResult } from '../shared/types/common.types';

interface SearchState {
  searchQuery: string;
  results: SearchResult[];
  selectedIndex: number;
  searchError: string | null;
  showSnowEffect: boolean;
}

interface SearchActions {
  setQuery: (query: string) => void;
  setResults: (results: SearchResult[]) => void;
  setSelectedIndex: (index: number | ((prev: number) => number)) => void;
  setSearchError: (error: string | null) => void;
  setShowSnowEffect: (show: boolean) => void;
  clearSearch: () => void;
}

export const useSearchStore = create<SearchState & SearchActions>()((set) => ({
  searchQuery: '',
  results: [],
  selectedIndex: 0,
  searchError: null,
  showSnowEffect: false,

  setQuery: (query) => set({ searchQuery: query }),
  setResults: (results) => set({ results, selectedIndex: 0 }),
  setSelectedIndex: (indexOrFn) =>
    set((state) => ({
      selectedIndex: typeof indexOrFn === 'function' ? indexOrFn(state.selectedIndex) : indexOrFn,
    })),
  setSearchError: (error) => set({ searchError: error }),
  setShowSnowEffect: (show) => set({ showSnowEffect: show }),
  clearSearch: () =>
    set({ searchQuery: '', results: [], selectedIndex: 0, showSnowEffect: false }),
}));
