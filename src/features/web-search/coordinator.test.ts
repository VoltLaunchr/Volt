import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSuggestionCoordinator } from './coordinator';
import { WebSearchHistory } from './history';
import { WebSuggestionProvider } from './types';

function makeProvider(
  suggest: WebSuggestionProvider['suggest'] = vi
    .fn()
    .mockResolvedValue([
      { id: 'remote:volt', text: 'Volt launcher', source: 'remote', providerId: 'test' },
    ])
): WebSuggestionProvider {
  return {
    id: 'test',
    isConfigured: () => true,
    suggest,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WebSuggestionCoordinator', () => {
  it('never calls providers outside an explicit web intent', async () => {
    const suggest = vi.fn();
    const coordinator = new WebSuggestionCoordinator({
      providers: [makeProvider(suggest)],
      debounceMs: 0,
    });

    await expect(
      coordinator.suggest({ query: 'volt launcher', explicitWebIntent: false })
    ).resolves.toEqual([]);
    expect(suggest).not.toHaveBeenCalled();
  });

  it('enforces the configured minimum query length before provider work', async () => {
    const suggest = vi.fn();
    const coordinator = new WebSuggestionCoordinator({
      providers: [makeProvider(suggest)],
      minQueryLength: 3,
      debounceMs: 0,
    });

    await expect(coordinator.suggest({ query: 'vo', explicitWebIntent: true })).resolves.toEqual(
      []
    );
    expect(suggest).not.toHaveBeenCalled();
  });

  it('debounces provider calls', async () => {
    vi.useFakeTimers();
    const suggest = vi.fn().mockResolvedValue([]);
    const coordinator = new WebSuggestionCoordinator({
      providers: [makeProvider(suggest)],
      debounceMs: 200,
    });

    const pending = coordinator.suggest({ query: 'volt', explicitWebIntent: true });
    await vi.advanceTimersByTimeAsync(199);
    expect(suggest).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it('cancels a superseded query and only publishes the latest suggestions', async () => {
    vi.useFakeTimers();
    const suggest = vi
      .fn()
      .mockResolvedValue([{ id: 'latest', text: 'latest', source: 'remote', providerId: 'test' }]);
    const coordinator = new WebSuggestionCoordinator({
      providers: [makeProvider(suggest)],
      debounceMs: 100,
    });

    const first = coordinator.suggest({ query: 'vo', explicitWebIntent: true });
    const second = coordinator.suggest({ query: 'volt', explicitWebIntent: true });
    await vi.advanceTimersByTimeAsync(100);

    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([
      { id: 'latest', text: 'latest', source: 'remote', providerId: 'test' },
    ]);
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it('serves repeated queries from the TTL cache', async () => {
    const suggest = vi
      .fn()
      .mockResolvedValue([{ id: 'cached', text: 'cached', source: 'remote', providerId: 'test' }]);
    const coordinator = new WebSuggestionCoordinator({
      providers: [makeProvider(suggest)],
      debounceMs: 0,
    });
    const request = { query: 'volt', explicitWebIntent: true };

    await coordinator.suggest(request);
    await coordinator.suggest(request);

    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it('merges enabled local history first and deduplicates remote values', async () => {
    const storage = new Map<string, string>();
    const history = new WebSearchHistory({
      enabled: true,
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => {
          storage.delete(key);
        },
      },
    });
    history.record('Volt launcher');
    const coordinator = new WebSuggestionCoordinator({
      history,
      providers: [
        makeProvider(
          vi.fn().mockResolvedValue([
            {
              id: 'duplicate',
              text: 'volt launcher',
              source: 'remote',
              providerId: 'test',
            },
            { id: 'other', text: 'Volt docs', source: 'remote', providerId: 'test' },
          ])
        ),
      ],
      debounceMs: 0,
    });

    await expect(coordinator.suggest({ query: 'volt', explicitWebIntent: true })).resolves.toEqual([
      {
        id: 'history:volt launcher',
        text: 'Volt launcher',
        source: 'history',
      },
      { id: 'other', text: 'Volt docs', source: 'remote', providerId: 'test' },
    ]);
  });
});
