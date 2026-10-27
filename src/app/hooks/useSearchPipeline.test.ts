import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/appStore';
import { useSearchStore } from '../../stores/searchStore';
import { DEFAULT_SETTINGS } from '../../features/settings/types/settings.types';
import { PluginResultType, type PluginResult } from '../../features/plugins/types';
import { SearchResultType } from '../../shared/types/common.types';
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

  it('ignores both streaming and completed plugin results after unmount', async () => {
    let finishStreaming: (() => void) | undefined;
    tauriMocks.invoke.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishStreaming = resolve;
        })
    );
    pluginMocks.query.mockResolvedValue([
      {
        id: 'late-plugin',
        type: PluginResultType.Calculator,
        title: 'Late result',
        score: 100,
      },
    ]);
    const { unmount } = renderHook(() => useSearchPipeline({ maxResults: 8 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    const queuedMessage = tauriMocks.channels[0].onmessage;
    unmount();
    await act(async () => {
      queuedMessage({
        event: 'apps',
        data: { results: [{ id: 'late', name: 'Late App', path: 'late.exe', score: 100 }] },
      });
      finishStreaming?.();
      await Promise.resolve();
    });
    expect(useSearchStore.getState().results).toEqual([]);
    expect(useSearchStore.getState().isSearching).toBe(false);
  });

  it('restores default suggestions immediately when the query is cleared', async () => {
    const { rerender } = renderHook(() => useSearchPipeline({ maxResults: 8 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(tauriMocks.channels).toHaveLength(1);

    act(() => {
      useSearchStore.setState({
        results: [
          {
            id: 'stale-app',
            type: SearchResultType.Application,
            title: 'Stale App',
            score: 100,
            data: { id: 'stale-app', name: 'Stale App', path: 'stale.exe', usageCount: 0 },
          },
        ],
        selectedIndex: 1,
      });
    });

    act(() => {
      useSearchStore.getState().setQuery('');
      rerender();
    });

    expect(useSearchStore.getState().results).toEqual([]);
    expect(useSearchStore.getState().selectedIndex).toBe(0);

    act(() => {
      tauriMocks.channels[0].onmessage({
        event: 'apps',
        data: { results: [{ id: 'late', name: 'Late App', path: 'late.exe', score: 100 }] },
      });
    });

    expect(useSearchStore.getState().results).toEqual([]);
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
            results: [
              {
                id: 'weak',
                name: 'Unrelated App',
                path: 'weak.exe',
                score: 60,
                tier: 'secondary',
                frecency: 0,
              },
            ],
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
    // Fallbacks stay below every real result.
    expect(results[0].id).toBe('weak');
    expect(results.slice(1).every((item) => item.badge === 'Fallback')).toBe(true);
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
            results: [
              {
                id: 'strong',
                name: 'Calculator',
                path: 'calc.exe',
                score: 100,
                tier: 'titleExact',
                frecency: 0,
              },
            ],
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

  it('preserves keyboard navigation across streaming batches', async () => {
    useSearchStore.setState({ searchQuery: 'calc' });
    tauriMocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === 'search_streaming') {
        const channel = args?.onEvent as { onmessage: (message: unknown) => void };
        channel.onmessage({
          event: 'apps',
          data: {
            results: [
              { id: 'a1', name: 'App One', path: 'a1.exe', score: 100 },
              { id: 'a2', name: 'App Two', path: 'a2.exe', score: 99 },
              { id: 'a3', name: 'App Three', path: 'a3.exe', score: 98 },
            ],
          },
        });
      }
      return Promise.resolve([]);
    });

    renderHook(() => useSearchPipeline({ maxResults: 8 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      await Promise.resolve();
    });

    // User navigates to index 2 while files are still streaming.
    act(() => {
      useSearchStore.getState().setSelectedIndex(2);
    });
    expect(useSearchStore.getState().selectedIndex).toBe(2);

    // Late files batch must not snap selection back to 0.
    act(() => {
      tauriMocks.channels[0].onmessage({
        event: 'files',
        data: { results: [] },
      });
    });
    expect(useSearchStore.getState().selectedIndex).toBe(2);
  });

  it('resets navigation when a new search starts', async () => {
    useSearchStore.setState({ searchQuery: 'calc', selectedIndex: 2 });
    tauriMocks.invoke.mockImplementation(() => Promise.resolve([]));

    const { rerender } = renderHook(() => useSearchPipeline({ maxResults: 8 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      await Promise.resolve();
    });

    act(() => {
      useSearchStore.getState().setQuery('calculator');
      rerender();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      await Promise.resolve();
    });
    // New generation resets to 0 even though the previous query sat at 2.
    expect(useSearchStore.getState().selectedIndex).toBe(0);
  });

  it('forwards the search sensitivity setting to the Rust ranker', async () => {
    const settings = cloneDefaultSettings();
    settings.general.searchSensitivity = 'low';
    useAppStore.setState({ settings });
    tauriMocks.invoke.mockImplementation(() => Promise.resolve([]));

    renderHook(() => useSearchPipeline({ maxResults: 8 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith(
      'search_streaming',
      expect.objectContaining({
        options: expect.objectContaining({ query: 'calc', sensitivity: 'low' }),
      })
    );
  });

  it('keeps every app the ranker returns, whatever its tier', async () => {
    tauriMocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === 'search_streaming') {
        const channel = args?.onEvent as { onmessage: (message: unknown) => void };
        channel.onmessage({
          event: 'apps',
          data: {
            results: [
              { id: 'fuzzy', name: 'Fuzzy', path: 'f.exe', score: 52, tier: 'fuzzy', frecency: 0 },
              {
                id: 'secondary',
                name: 'Secondary',
                path: 's.exe',
                score: 71,
                tier: 'secondary',
                frecency: 0,
              },
            ],
          },
        });
      }
      return Promise.resolve([]);
    });

    renderHook(() => useSearchPipeline({ maxResults: 8 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    const ranks = useSearchStore
      .getState()
      .results.filter((item) => item.type === SearchResultType.Application)
      .map((item) => [item.id, item.rank?.tier, item.rank?.quality]);
    // A better quality never lifts a secondary match over a fuzzy name match.
    expect(ranks).toEqual([
      ['fuzzy', 'fuzzy', 52],
      ['secondary', 'secondary', 71],
    ]);
  });

  it('merges absolute file tiers with app tiers without batch normalisation', async () => {
    // Shared ladder: titlePrefix > fileExact > fuzzy > filePrefix > secondary.
    tauriMocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === 'search_streaming') {
        const channel = args?.onEvent as { onmessage: (message: unknown) => void };
        channel.onmessage({
          event: 'apps',
          data: {
            results: [
              {
                id: 'app-prefix',
                name: 'Calc Pro',
                path: 'p.exe',
                score: 90,
                tier: 'titlePrefix',
                frecency: 0,
              },
              {
                id: 'app-secondary',
                name: 'Tools',
                path: 'calc/tools.exe',
                score: 90,
                tier: 'secondary',
                frecency: Date.now() + 1e9,
              },
              {
                id: 'app-fuzzy',
                name: 'Scientific Calc',
                path: 'sci.exe',
                score: 68,
                tier: 'fuzzy',
                frecency: 0,
              },
            ],
          },
        });
        channel.onmessage({
          event: 'files',
          data: {
            results: [
              {
                id: 'file-exact',
                name: 'calc.txt',
                path: 'C:/docs/calc.txt',
                extension: 'txt',
                size: 1,
                modified: 0,
                category: 'document',
                score: 100,
                tier: 'fileExact',
              },
              {
                id: 'file-prefix',
                name: 'calculations.xlsx',
                path: 'C:/docs/calculations.xlsx',
                extension: 'xlsx',
                size: 1,
                modified: 0,
                category: 'document',
                score: 90,
                tier: 'filePrefix',
              },
            ],
          },
        });
      }
      return Promise.resolve([]);
    });

    renderHook(() => useSearchPipeline({ maxResults: 8 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(useSearchStore.getState().results.map((item) => item.id)).toEqual([
      'app-prefix',
      'file-exact',
      'app-fuzzy',
      'file-prefix',
      'app-secondary',
    ]);
  });

  it('does not promote a lone weak file match to the top of the file band', async () => {
    tauriMocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === 'search_streaming') {
        const channel = args?.onEvent as { onmessage: (message: unknown) => void };
        channel.onmessage({
          event: 'files',
          data: {
            results: [
              {
                id: 'weak-file',
                name: 'notes.txt',
                path: 'C:/calc/notes.txt',
                extension: 'txt',
                size: 1,
                modified: 0,
                category: 'document',
                score: 0,
                tier: 'filePathOnly',
              },
            ],
          },
        });
      }
      return Promise.resolve([]);
    });

    renderHook(() => useSearchPipeline({ maxResults: 8 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    const file = useSearchStore.getState().results.find((item) => item.id === 'weak-file');
    expect(file?.rank).toMatchObject({ tier: 'filePathOnly', quality: 0, source: 'file' });
  });

  // ---- Unified ranking of apps + plugin commands ----

  function streamApps(results: unknown[], learned: unknown[] = []) {
    tauriMocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === 'search_streaming') {
        const channel = args?.onEvent as { onmessage: (message: unknown) => void };
        channel.onmessage({ event: 'learned', data: { results: learned } });
        channel.onmessage({ event: 'apps', data: { results } });
      }
      return Promise.resolve([]);
    });
  }

  async function runSearch(query: string): Promise<string[]> {
    useSearchStore.setState({ searchQuery: query });
    renderHook(() => useSearchPipeline({ maxResults: 8 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    return useSearchStore.getState().results.map((item) => item.id);
  }

  it('ranks a plugin command with an exact title above a fuzzy app', async () => {
    streamApps([
      {
        id: 'fuzzy-app',
        name: 'Left Halfway',
        path: 'lh.exe',
        score: 70,
        tier: 'fuzzy',
        frecency: 0,
      },
    ]);
    pluginMocks.query.mockResolvedValue([
      {
        id: 'left_half',
        type: PluginResultType.Info,
        title: 'Left Half',
        score: 10,
        pluginId: 'window-management',
        matchKind: 'none',
      },
    ]);

    expect(await runSearch('left half')).toEqual(['left_half', 'fuzzy-app']);
  });

  it('applies learned bindings streamed by Rust to plugin commands', async () => {
    streamApps(
      [
        {
          id: 'set-app',
          name: 'Set',
          path: 'set.exe',
          score: 100,
          tier: 'titleExact',
          frecency: 0,
        },
      ],
      [{ resultId: 'systemcommands:syscmd-settings', tier: 'learnedExact' }]
    );
    pluginMocks.query.mockResolvedValue([
      {
        id: 'syscmd-settings',
        type: PluginResultType.SystemCommand,
        title: 'Open Settings',
        score: 85,
        pluginId: 'systemcommands',
        matchKind: 'none',
      },
    ]);

    expect(await runSearch('set')).toEqual(['syscmd-settings', 'set-app']);
  });

  it('ranks an alias exact app above an activated plugin and an exact command title', async () => {
    streamApps([
      {
        id: 'alias-app',
        name: 'GitHub',
        path: 'gh.exe',
        score: 100,
        tier: 'aliasExact',
        frecency: 0,
      },
    ]);
    pluginMocks.query.mockResolvedValue([
      {
        id: 'note-cmd',
        type: PluginResultType.Info,
        title: 'Notes',
        score: 100,
        pluginId: 'notes',
        matchKind: 'keyword',
      },
    ]);

    expect(await runSearch('notes')).toEqual(['alias-app', 'note-cmd']);
  });

  it('uses the cached universal frecency to break ties between plugin commands', async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === 'get_command_frecency') {
        return Promise.resolve({ 'quicklinks:ql-used': Date.now() + 1e9 });
      }
      return Promise.resolve([]);
    });
    pluginMocks.query.mockResolvedValue([
      {
        id: 'ql-fresh',
        type: PluginResultType.Info,
        title: 'Docs Alpha',
        score: 90,
        pluginId: 'quicklinks',
        matchKind: 'none',
      },
      {
        id: 'ql-used',
        type: PluginResultType.Info,
        title: 'Docs Beta',
        score: 80,
        pluginId: 'quicklinks',
        matchKind: 'none',
      },
    ]);

    expect(await runSearch('docs')).toEqual(['ql-used', 'ql-fresh']);
  });

  it('keeps the explicit web action on top and fallbacks last', async () => {
    useAppStore.setState({ settings: cloneDefaultSettings() });
    streamApps([
      { id: 'alias-app', name: 'Volt', path: 'v.exe', score: 100, tier: 'aliasExact', frecency: 0 },
    ]);
    pluginMocks.query.mockResolvedValue([
      {
        id: 'web-action',
        type: PluginResultType.WebSearch,
        title: 'Search the web',
        score: 90,
        pluginId: 'websearch',
        matchKind: 'keyword',
        data: { query: 'volt', engine: 'google', url: 'https://www.google.com/search?q=volt' },
      },
    ]);

    const ids = await runSearch('web volt');
    expect(ids.slice(0, 2)).toEqual(['web-action', 'alias-app']);
  });

  it('shows the calculator answer first for math', async () => {
    useAppStore.setState({ settings: cloneDefaultSettings() });
    streamApps([
      { id: 'weak-app', name: 'Tool 2', path: 't2.exe', score: 55, tier: 'secondary', frecency: 0 },
    ]);
    pluginMocks.query.mockResolvedValue([
      {
        id: 'calc-math-1700000000000',
        type: PluginResultType.Calculator,
        title: '4',
        subtitle: '2+2 = 4',
        score: 95,
        pluginId: 'calculator',
        matchKind: 'none',
        data: { queryType: 'math', expression: '2+2', result: 4, formatted: '4' },
      },
    ]);

    const ids = await runSearch('2+2');
    expect(ids[0]).toBe('calc-math-1700000000000');
    expect(ids.indexOf('weak-app')).toBe(1);
  });
});
