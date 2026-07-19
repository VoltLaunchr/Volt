import { describe, expect, it } from 'vitest';
import { LruTtlCache } from './cache';

describe('LruTtlCache', () => {
  it('expires entries after their TTL', () => {
    let now = 100;
    const cache = new LruTtlCache<string>({ ttlMs: 50, now: () => now });
    cache.set('query', 'result');

    now = 149;
    expect(cache.get('query')).toBe('result');

    now = 150;
    expect(cache.get('query')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry', () => {
    const cache = new LruTtlCache<number>({ maxEntries: 2 });
    cache.set('first', 1);
    cache.set('second', 2);

    expect(cache.get('first')).toBe(1);
    cache.set('third', 3);

    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('first')).toBe(1);
    expect(cache.get('third')).toBe(3);
  });
});
