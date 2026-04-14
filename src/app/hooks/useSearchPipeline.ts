import { invoke, Channel } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef } from 'react';
import { pluginRegistry } from '../../features/plugins/core';
import { PluginResult as PluginResultData } from '../../features/plugins/types';
import { AppInfo, FileInfo, SearchResult, SearchResultType } from '../../shared/types/common.types';
import { logger } from '../../shared/utils/logger';
import { parseQuery } from '../../shared/utils/queryParser';
import { useAppStore } from '../../stores/appStore';
import { useSearchStore } from '../../stores/searchStore';

/** Shorten a file path for display: C:\Users\Noluc\Documents\foo.txt → ~\Documents\foo.txt */
function shortenPath(fullPath: string): string {
  const home = fullPath.match(/^([A-Z]:\\Users\\[^\\]+)/i)?.[1];
  if (home) {
    return fullPath.replace(home, '~');
  }
  return fullPath;
}

// Search result priority scores (higher = appears first)
export const SEARCH_PRIORITIES = {
  APPLICATION: 200,
  FILE: 80,
  PLUGIN_BASE: 100,
  PLUGIN_KEYWORD_BOOST: 300, // Boost plugins when query matches their keywords exactly
} as const;

/** Shape returned by search_applications_frecency */
interface AppInfoWithScore extends AppInfo {
  score: number;
}

/** Shape returned by get_frecency_suggestions */
interface LaunchRecord {
  path: string;
  name: string;
  launchCount: number;
  lastLaunched: number;
  pinned: boolean;
}

/** Streaming search batch events from the Rust backend (search_streaming command) */
type SearchBatch =
  | { event: 'apps'; data: { results: AppInfoWithScore[] } }
  | { event: 'files'; data: { results: FileInfo[] } }
  | { event: 'done' };

// Plugin keywords map - when query starts with these, boost that plugin significantly
const PLUGIN_KEYWORDS: Record<string, string[]> = {
  calculator: ['calc', 'calculatrice', 'calculer', 'calcul', '=', 'math'],
  timer: ['timer', 'minuteur', 'chrono', 'countdown', 'pomodoro'],
  websearch: ['?', 'web', 'search', 'google', 'bing', 'ddg', 'chercher'],
  systemcommands: ['reload', 'settings', 'quit', 'exit', 'preferences', 'config', 'paramètres'],
  emoji: ['emoji', ':'],
  system_monitor: ['system', 'cpu', 'ram', 'memory', 'disk', 'système', 'monitor'],
  games: ['game', 'jeu', 'steam', 'epic', 'gog'],
  clipboard: ['clipboard', 'presse-papier', 'copier', 'coller'],
};

// Check if query matches any plugin keywords
const getPluginKeywordBoost = (query: string, pluginId: string): number => {
  const lowerQuery = query.toLowerCase().trim();
  const keywords = PLUGIN_KEYWORDS[pluginId];

  if (!keywords) return 0;

  // Exact match or query starts with keyword = maximum boost
  for (const keyword of keywords) {
    if (
      lowerQuery === keyword ||
      lowerQuery.startsWith(keyword + ' ') ||
      lowerQuery.startsWith(keyword)
    ) {
      return SEARCH_PRIORITIES.PLUGIN_KEYWORD_BOOST;
    }
  }

  return 0;
};

interface UseSearchPipelineOptions {
  maxResults: number;
  /**
   * When true, the debounced search effect is suspended (e.g. while a non-search
   * view such as the emoji picker is active). The query state remains writable.
   */
  suspended?: boolean;
}

/**
 * Wires up the debounced search pipeline. State lives in useSearchStore.
 *
 * - 150 ms debounce
 * - Stale-response protection via `latestSearchId`
 * - Parallel apps + files + plugin queries
 * - Score-based merge/sort/limit
 * - Christmas easter egg detection (snow effect)
 */
export function useSearchPipeline({
  maxResults,
  suspended = false,
}: UseSearchPipelineOptions): void {
  const allApps = useAppStore((s) => s.allApps);
  const isLoading = useAppStore((s) => s.isLoading);
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const results = useSearchStore((s) => s.results);
  const selectedIndex = useSearchStore((s) => s.selectedIndex);
  const { setResults, setSelectedIndex, setSearchError, setShowSnowEffect } =
    useSearchStore.getState();

  const latestSearchId = useRef(0); // Prevent stale search responses

  const performSearch = useCallback(
    async (query: string) => {
      // If apps aren't loaded yet, still allow plugin-only search
      const appsReady = !isLoading && allApps.length > 0;

      if (!query.trim()) {
        // Predictive results: show top frecency suggestions
        try {
          const suggestions = await invoke<LaunchRecord[]>('get_frecency_suggestions', {
            limit: maxResults,
          }).catch(() => [] as LaunchRecord[]);

          if (suggestions.length > 0) {
            const predictiveResults: SearchResult[] = suggestions.map((record, i) => ({
              id: `frecency-${record.path}`,
              type: SearchResultType.Application,
              title: record.name,
              subtitle: undefined,
              score: 1000 - i, // preserve frecency order
              data: {
                id: `frecency-${record.path}`,
                name: record.name,
                path: record.path,
                usageCount: record.launchCount,
              } as AppInfo,
            }));
            setResults(predictiveResults);
          } else {
            setResults([]);
          }
        } catch {
          setResults([]);
        }
        setShowSnowEffect(false);
        return;
      }

      // Parse operators from query
      const parsed = parseQuery(query);
      const effectiveQuery = parsed.hasOperators ? parsed.searchQuery : query;

      // Check if query is about Christmas (for snow effect)
      const isChristmasQuery =
        /christmas|xmas|noel|25.*dec|dec.*25/i.test(query) ||
        /days?\s+(until|to|before)\s+(christmas|xmas|noel|dec.*25|25.*dec)/i.test(query);

      setShowSnowEffect(isChristmasQuery);

      try {
        const searchId = ++latestSearchId.current;

        // Helper: convert app results to SearchResult[]
        const convertApps = (apps: AppInfoWithScore[]): SearchResult[] =>
          apps.map((appWithScore) => ({
            id: appWithScore.id,
            type: SearchResultType.Application,
            title: appWithScore.name,
            subtitle: appWithScore.description || undefined,
            icon: appWithScore.icon,
            score: SEARCH_PRIORITIES.APPLICATION + appWithScore.score,
            data: appWithScore as AppInfo,
          }));

        // Helper: convert file results to SearchResult[]
        const convertFiles = (files: FileInfo[]): SearchResult[] =>
          files.map((file) => ({
            id: file.id,
            type: SearchResultType.File,
            title: file.name,
            subtitle: shortenPath(file.path),
            icon: file.icon,
            score: SEARCH_PRIORITIES.FILE,
            data: file,
          }));

        // Helper: convert plugin results to SearchResult[]
        const convertPlugins = (
          pluginResults: PluginResultData[],
          rawQuery: string,
        ): SearchResult[] =>
          pluginResults.map((result) => {
            let searchResultType: SearchResultType;
            switch (result.type) {
              case 'calculator':
                searchResultType = SearchResultType.Calculator;
                break;
              case 'websearch':
                searchResultType = SearchResultType.WebSearch;
                break;
              case 'systemcommand':
                searchResultType = SearchResultType.SystemCommand;
                break;
              case 'game':
                searchResultType = SearchResultType.Game;
                break;
              case 'timer':
                searchResultType = SearchResultType.Timer;
                break;
              default:
                searchResultType = SearchResultType.Plugin;
            }

            const pluginId = result.pluginId || result.type;
            const keywordBoost = getPluginKeywordBoost(rawQuery, pluginId);
            const finalScore = keywordBoost > 0 ? keywordBoost + result.score : result.score;

            return {
              id: result.id,
              type: searchResultType,
              title: result.title,
              subtitle: result.subtitle,
              icon: result.icon,
              badge: result.badge,
              score: finalScore,
              data: result,
            };
          });

        // Helper: merge, sort, and limit accumulated results
        const mergeResults = (...sources: SearchResult[][]): SearchResult[] =>
          sources
            .flat()
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults + 4);

        // Accumulated partial results from streaming
        let streamedApps: SearchResult[] = [];
        let streamedFiles: SearchResult[] = [];
        let streamedPlugins: SearchResult[] = [];

        // Start plugin search in parallel (plugins run in-process, not via Tauri)
        const pluginPromise = pluginRegistry
          .query({ query: effectiveQuery })
          .catch(() => [] as PluginResultData[]);

        // Set up the streaming channel for backend search (apps + files)
        const channel = new Channel<SearchBatch>();
        channel.onmessage = (batch) => {
          // Guard against stale search
          if (searchId !== latestSearchId.current) return;

          if (batch.event === 'apps') {
            streamedApps = convertApps(batch.data.results);
            // Show partial results immediately (apps arrived)
            setResults(mergeResults(streamedApps, streamedFiles, streamedPlugins));
          } else if (batch.event === 'files') {
            streamedFiles = convertFiles(batch.data.results);
            // Show partial results immediately (files arrived)
            setResults(mergeResults(streamedApps, streamedFiles, streamedPlugins));
          }
          // 'done' event is handled when the invoke promise resolves
        };

        // Launch the streaming search command (sends apps/files via channel)
        const streamingPromise = appsReady
          ? invoke('search_streaming', {
              query: effectiveQuery,
              apps: allApps,
              limit: maxResults * 2,
              ...(parsed.hasOperators
                ? {
                    ext: parsed.operators.ext,
                    dir: parsed.operators.dir,
                    sizeMin: parsed.operators.sizeMin,
                    sizeMax: parsed.operators.sizeMax,
                    modifiedAfter: parsed.operators.modifiedAfter,
                    modifiedBefore: parsed.operators.modifiedBefore,
                  }
                : {}),
              onEvent: channel,
            }).catch((err) => {
              logger.warn('Streaming search failed, results may be partial:', String(err));
            })
          : Promise.resolve();

        // Wait for both streaming backend and plugin search to complete
        const [, pluginResults] = await Promise.all([streamingPromise, pluginPromise]);

        // Drop stale responses
        if (searchId !== latestSearchId.current) {
          return;
        }

        // Merge plugin results into final set
        streamedPlugins = convertPlugins(pluginResults, query);

        // Final merge with all sources
        setResults(mergeResults(streamedApps, streamedFiles, streamedPlugins));
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('Search failed:', errorMessage);
        setResults([]);
        setSearchError(`Search failed: ${errorMessage}`);
      }
    },
    [allApps, isLoading, maxResults, setResults, setSearchError, setShowSnowEffect]
  );

  // Debounced search effect (150 ms)
  useEffect(() => {
    if (suspended) {
      return;
    }

    const timeoutId = setTimeout(() => {
      performSearch(searchQuery);
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, performSearch, suspended]);

  // Keep selected index in range when results change
  useEffect(() => {
    if (results.length > 0 && selectedIndex >= results.length) {
      setSelectedIndex(results.length - 1);
    }
  }, [results, selectedIndex, setSelectedIndex]);
}
