import { describe, it, expect, beforeEach } from 'vitest';
import { useSearchStore } from '../searchStore';

describe('searchStore', () => {
  beforeEach(() => {
    useSearchStore.setState(useSearchStore.getInitialState());
  });

  it('has correct initial state', () => {
    const state = useSearchStore.getState();
    expect(state.searchQuery).toBe('');
    expect(state.results).toEqual([]);
    expect(state.selectedIndex).toBe(0);
    expect(state.searchError).toBeNull();
    expect(state.showSnowEffect).toBe(false);
  });

  it('setQuery updates searchQuery', () => {
    useSearchStore.getState().setQuery('hello');
    expect(useSearchStore.getState().searchQuery).toBe('hello');
  });

  it('setResults updates results and resets selectedIndex', () => {
    useSearchStore.getState().setSelectedIndex(3);
    useSearchStore.getState().setResults([
      { id: '1', type: 0, title: 'Test', subtitle: '', icon: '', score: 100, data: {} },
    ]);
    expect(useSearchStore.getState().results).toHaveLength(1);
    expect(useSearchStore.getState().selectedIndex).toBe(0);
  });

  it('setSelectedIndex updates index', () => {
    useSearchStore.getState().setSelectedIndex(5);
    expect(useSearchStore.getState().selectedIndex).toBe(5);
  });

  it('setSelectedIndex works with updater function', () => {
    useSearchStore.getState().setSelectedIndex(3);
    useSearchStore.getState().setSelectedIndex((prev) => prev + 1);
    expect(useSearchStore.getState().selectedIndex).toBe(4);
  });

  it('clearSearch resets query, results, and snow effect', () => {
    useSearchStore.getState().setQuery('test');
    useSearchStore.getState().setResults([
      { id: '1', type: 0, title: 'Test', subtitle: '', icon: '', score: 100, data: {} },
    ]);
    useSearchStore.getState().setShowSnowEffect(true);
    useSearchStore.getState().clearSearch();
    expect(useSearchStore.getState().searchQuery).toBe('');
    expect(useSearchStore.getState().results).toEqual([]);
    expect(useSearchStore.getState().showSnowEffect).toBe(false);
  });
});
