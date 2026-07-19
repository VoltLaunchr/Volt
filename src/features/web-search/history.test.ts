import { describe, expect, it, vi } from 'vitest';
import { WebSearchHistory } from './history';

function makeStorage() {
  const values = new Map<string, string>();
  const getItem = vi.fn((key: string) => values.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => {
    values.set(key, value);
  });
  const removeItem = vi.fn((key: string) => {
    values.delete(key);
  });
  return {
    storage: { getItem, setItem, removeItem },
    getItem,
    setItem,
    removeItem,
  };
}

describe('WebSearchHistory', () => {
  it('does not touch storage while opt-in is disabled', () => {
    const { storage, getItem, setItem, removeItem } = makeStorage();
    const history = new WebSearchHistory({ storage });

    history.record('private query');
    expect(history.suggest('private', 5)).toEqual([]);

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('can erase previously enabled history after opt-out', () => {
    const { storage, removeItem } = makeStorage();
    const history = new WebSearchHistory({ enabled: true, storage });
    history.record('query');
    history.setEnabled(false);

    history.clear();

    expect(removeItem).toHaveBeenCalledWith('volt:web-search-history');
  });

  it('persists, deduplicates and ranks enabled history', () => {
    const { storage } = makeStorage();
    let now = 1;
    const history = new WebSearchHistory({
      enabled: true,
      storage,
      now: () => now++,
    });

    history.record('TypeScript cache');
    history.record('cache Rust');
    history.record('typescript cache');

    expect(history.suggest('type', 5)).toEqual([
      {
        id: 'history:typescript cache',
        text: 'typescript cache',
        source: 'history',
      },
    ]);
    expect(history.suggest('cache', 5).map((suggestion) => suggestion.text)).toEqual([
      'cache Rust',
      'typescript cache',
    ]);
  });

  it('ignores malformed persisted history', () => {
    const { storage } = makeStorage();
    storage.setItem('volt:web-search-history', '{broken');
    const history = new WebSearchHistory({ enabled: true, storage });

    expect(history.suggest('anything', 5)).toEqual([]);
  });
});
