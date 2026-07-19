import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/appStore';
import { useSearchStore } from '../../stores/searchStore';
import { DEFAULT_SETTINGS } from '../../features/settings/types/settings.types';
import { PluginResultType, type PluginResult } from '../../features/plugins/types';
import { useSearchPipeline } from './useSearchPipeline';

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  channels: [] as Array<{ onmessage: (message: unknown) => void }>,
}));

const pluginMocks = vi.hoisted(() => ({
  query: vi.fn<(_context: unknown) => Promise<PluginResult[]>>(() => Promise.resolve([])),
}));

function cloneDefaultSettings(): typeof DEFAULT_SETTINGS {
  return {
    ...DEFAULT_SETTINGS,
    general: { ...DEFAULT_SETTINGS.general },
    fallbacks: {
      ...DEFAULT_SETTINGS.fallbacks,
      commands: DEFAULT_SETTINGS.fallbacks.commands.map((command) => ({ ...command })),
    },
  };
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriMocks.invoke,
  Channel: class MockChannel {
    onmessage = () => {};

    constructor() {
      tauriMocks.channels.push(this);
    }
  },
}));

vi.mock('../../features/plugins/core', () => ({
  pluginRegistry: {
    query: pluginMocks.query,
  },
}));

describe('useSearchPipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tauriMocks.invoke.mockReset();
    pluginMocks.query.mockReset();
    pluginMocks.query.mockResolvedValue([]);
    tauriMocks.channels.length = 0;
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === 'search_streaming') {
        return new Promise<void>(() => {});
      }
      return Promise.resolve([]);
    });

    useAppStore.setState({
      allApps: [{ id: 'app-calc', name: 'Calculator', path: 'calc.exe', usageCount: 0 }],
      isLoading: false,
      settings: null,
      isIndexing: false,
      appError: null,
    });
    useSearchStore.setState({
      searchQuery: 'calc',
      results: [],
      selectedIndex: 0,
      searchError: null,
      showSnowEffect: false,
      isSearching: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('disconnects an active streaming channel when search is suspended', async () => {
    const { rerender } = renderHook(
      ({ suspended }) => useSearchPipeline({ maxResults: 8, suspended }),
      { initialProps: { suspended: false } }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(tauriMocks.channels).toHaveLength(1);
    expect(useSearchStore.getState().isSearching).toBe(true);

    rerender({ suspended: true });

    act(() => {
      tauriMocks.channels[0].onmessage({
        event: 'apps',
        data: { results: [{ id: 'late', name: 'Late App', path: 'late.exe', score: 100 }] },
      });
    });

    expect(useSearchStore.getState().results).toEqual([]);
    expect(useSearchStore.getState().isSearching).toBe(false);
  });

  it('shows configured web fallbacks alongside a weak local match', async () => {
    useAppStore.setState({
      settings: cloneDefaultSettings(),
    });
    useSearchStore.setState({ searchQuery: 'research topic' });
    tauriMocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === 'search_streaming') {
        const channel = args?.onEvent as { onmessage: (message: unknown) => void };
        channel.onmessage({
          event: 'apps',
          data: {
            results: [{ id: 'weak', name: 'Unrelated App', path: 'weak.exe', score: 200 }],
          },
        });
      }
      return Promise.resolve([]);
    });

    renderHook(() => useSearchPipeline({ maxResults: 8 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const results = useSearchStore.getState().results;
    expect(results.some((item) => item.id === 'weak')).toBe(true);
    expect(results.some((item) => item.id.startsWith('fallback-fallback-google'))).toBe(true);
  });

  it('suppresses web fallbacks for a strong application-name match', async () => {
    useAppStore.setState({
      settings: cloneDefaultSettings(),
    });
    useSearchStore.setState({ searchQuery: 'calculator' });
    tauriMocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === 'search_streaming') {
        const channel = args?.onEvent as { onmessage: (message: unknown) => void };
        channel.onmessage({
          event: 'apps',
          data: {
            results: [{ id: 'strong', name: 'Calculator', path: 'calc.exe', score: 950 }],
          },
        });
      }
      return Promise.resolve([]);
    });

    renderHook(() => useSearchPipeline({ maxResults: 8 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const results = useSearchStore.getState().results;
    expect(results.some((item) => item.id === 'strong')).toBe(true);
    expect(results.some((item) => item.id.startsWith('fallback-'))).toBe(false);
  });

  it('progressively adds Brave hits only for an explicit web activation', async () => {
    useAppStore.setState({
      settings: cloneDefaultSettings(),
    });
    useSearchStore.setState({ searchQuery: '? volt launcher' });
    const webActivation: PluginResult = {
      id: 'web-action',
      type: PluginResultType.WebSearch,
      title: 'Search Volt launcher',
      score: 90,
      pluginId: 'websearch',
      matchKind: 'prefix',
      data: {
        query: 'volt launcher',
        engine: 'google',
        url: 'https://www.google.com/search?q=volt%20launcher',
      },
    };
    pluginMocks.query.mockResolvedValue([webActivation]);
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === 'web_search_brave') {
        return Promise.resolve([
          {
            title: 'Volt Launcher',
            url: 'https://voltlaunchr.com',
            description: 'Official website',
          },
        ]);
      }
      return Promise.resolve([]);
    });

    renderHook(() => useSearchPipeline({ maxResults: 8 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith(
      'web_search_brave',
      expect.objectContaining({ query: 'volt launcher', count: 3 })
    );
    expect(useSearchStore.getState().results.some((item) => item.id === 'web-result-brave-0')).toBe(
      true
    );
  });

  it('invalidates an in-flight web enrichment as soon as the query changes', async () => {
    useAppStore.setState({
      settings: cloneDefaultSettings(),
    });
    useSearchStore.setState({ searchQuery: '? volt' });

    pluginMocks.query.mockImplementation((context: unknown) => {
      const query = (context as { query: string }).query.replace(/^\?\s*/, '');
      return Promise.resolve([
        {
          id: `web-${query}`,
          type: PluginResultType.WebSearch,
          title: `Search ${query}`,
          score: 90,
          pluginId: 'websearch',
          matchKind: 'prefix',
          data: {
            query,
            engine: 'google',
            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          },
        },
      ]);
    });

    let resolveOldSearch: ((value: unknown[]) => void) | undefined;
    tauriMocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === 'web_search_brave' && args?.query === 'volt') {
        return new Promise<unknown[]>((resolve) => {
          resolveOldSearch = resolve;
        });
      }
      return Promise.resolve([]);
    });

    renderHook(() => useSearchPipeline({ maxResults: 8 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resolveOldSearch).toBeTypeOf('function');

    await act(async () => {
      useSearchStore.getState().setQuery('? github');
      await Promise.resolve();
      resolveOldSearch?.([
        {
          title: 'Old Volt result',
          url: 'https://stale.example/volt',
          description: 'Must never replace the new query',
        },
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useSearchStore.getState().results.some((item) => item.title === 'Old Volt result')).toBe(
      false
    );
  });
});
