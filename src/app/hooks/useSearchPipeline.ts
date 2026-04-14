import { invoke, Channel } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef } from 'react';
import { pluginRegistry } from '../../features/plugins/core';
import { PluginResult as PluginResultData } from '../../features/plugins/types';
import { AppInfo, FileInfo, SearchResult, SearchResultType } from '../../shared/types/common.types';
import {
  SEARCH_SCORING,
  SEARCH_LIMITS,
  SEARCH_SENSITIVITY_THRESHOLDS,
  SEARCH_SENSITIVITY_FUZZY_MULTIPLIER,
} from '../../shared/constants/searchScoring';
import type { SearchSensitivity } from '../../features/settings/types/settings.types';
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

/** File search result with score from the batch/streaming endpoint */
interface FileSearchResultCompact extends FileInfo {
  score: number;
}

/** Streaming search batch events from the Rust backend */
type SearchBatch =
  | { event: 'apps'; data: { results: AppInfoWithScore[] } }
  | { event: 'files'; data: { results: FileSearchResultCompact[] } }
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
      return SEARCH_SCORING.PLUGIN_KEYWORD_BOOST;
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

// ---- Conversion helpers (used by streaming callbacks + final merge) ----

const convertApps = (
  apps: AppInfoWithScore[],
  sensitivity: SearchSensitivity = 'medium',
): SearchResult[] => {
  const threshold = SEARCH_SENSITIVITY_THRESHOLDS[sensitivity];
  const fuzzyMultiplier = SEARCH_SENSITIVITY_FUZZY_MULTIPLIER[sensitivity];

  return apps
    .filter((app) => {
      const isFuzzy = app.score < 60;
      const adjusted = isFuzzy ? Math.round(app.score * fuzzyMultiplier) : app.score;
      return adjusted >= threshold;
    })
    .map((appWithScore) => {
      const isFuzzy = appWithScore.score < 60;
      const adjustedScore = isFuzzy
        ? Math.round(appWithScore.score * fuzzyMultiplier)
        : appWithScore.score;
      return {
        id: appWithScore.id,
        type: SearchResultType.Application,
        title: appWithScore.name,
        subtitle: appWithScore.description || undefined,
        icon: appWithScore.icon,
        score: SEARCH_SCORING.APPLICATION + adjustedScore,
        data: appWithScore as AppInfo,
      };
    });
};

const convertFiles = (files: FileSearchResultCompact[]): SearchResult[] => {
  const maxFileScore = files.reduce((max, f) => Math.max(max, f.score), 1);
  return files
    .filter((file) => {
      const path = file.path.toLowerCase();
      if (file.name.toLowerCase().endsWith('.exe')) {
        const systemDirs = [
          'program files', 'program files (x86)', 'windows',
          'programdata', 'common files', 'clicktorun',
          'installer', 'servicehub', 'windows kits',
          'microsoft shared', 'nvidia corporation',
        ];
        if (systemDirs.some((d) => path.includes(d))) return false;
      }
      return true;
    })
    .map((file) => ({
      id: file.id,
      type: SearchResultType.File,
      title: file.name,
      subtitle: shortenPath(file.path),
      icon: file.icon,
      score: SEARCH_SCORING.FILE + Math.round((file.score / maxFileScore) * 50),
      data: file as unknown as FileInfo,
    }));
};

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

/**
 * Wires up the debounced search pipeline. State lives in useSearchStore.
 *
 * - Adaptive debounce (150ms short queries, 80ms longer)
 * - Stale-response protection via `latestSearchId`
 * - Streaming results via Tauri Channels (apps appear before files)
 * - Plugin queries run in parallel (frontend-only, no IPC)
 * - Score-based merge/sort/limit
 * - Fallback web search when no results
 */
export function useSearchPipeline({
  maxResults,
  suspended = false,
}: UseSearchPipelineOptions): void {
  const allApps = useAppStore((s) => s.allApps);
  const isLoading = useAppStore((s) => s.isLoading);
  const searchSensitivity: SearchSensitivity =
    useAppStore((s) => s.settings?.general.searchSensitivity) ?? 'medium';
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const results = useSearchStore((s) => s.results);
  const selectedIndex = useSearchStore((s) => s.selectedIndex);
  const { setResults, setSelectedIndex, setSearchError, setShowSnowEffect } =
    useSearchStore.getState();

  const latestSearchId = useRef(0); // Prevent stale search responses
  const activeChannelRef = useRef<Channel<SearchBatch> | null>(null);

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
              score: SEARCH_LIMITS.SEARCH_ORDER_BASE - i, // preserve frecency order
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

      // Detect "show all" queries — user wants to browse a category, not search by name
      const lowerQuery = query.trim().toLowerCase();
      const isAppBrowseQuery = ['app', 'apps', 'application', 'applications', 'programmes'].includes(lowerQuery);
      const isGameBrowseQuery = ['game', 'games', 'jeu', 'jeux'].includes(lowerQuery);

      // If browsing apps, show ALL apps sorted by name (frecency will reorder used ones)
      if (isAppBrowseQuery && appsReady) {
        const searchId = ++latestSearchId.current;
        const allAppResults: SearchResult[] = allApps
          .slice(0, maxResults + 4)
          .map((app, i) => ({
            id: app.id,
            type: SearchResultType.Application,
            title: app.name,
            subtitle: app.description || undefined,
            icon: app.icon,
            score: SEARCH_SCORING.APPLICATION + 100 - i,
            data: app,
          }));

        // Fetch frecency to reorder — used apps first
        try {
          const frecency = await invoke<LaunchRecord[]>('get_frecency_suggestions', { limit: 20 })
            .catch(() => [] as LaunchRecord[]);
          if (frecency.length > 0) {
            const frecencyPaths = new Set(frecency.map((r) => r.path));
            allAppResults.sort((a, b) => {
              const aUsed = frecencyPaths.has((a.data as AppInfo).path) ? 1 : 0;
              const bUsed = frecencyPaths.has((b.data as AppInfo).path) ? 1 : 0;
              return bUsed - aUsed || b.score - a.score;
            });
          }
        } catch { /* continue */ }

        if (searchId === latestSearchId.current) {
          setResults(allAppResults);
        }
        setShowSnowEffect(false);
        return;
      }

      // Check if query is about Christmas (for snow effect)
      const isChristmasQuery =
        /christmas|xmas|noel|25.*dec|dec.*25/i.test(query) ||
        /days?\s+(until|to|before)\s+(christmas|xmas|noel|dec.*25|25.*dec)/i.test(query);

      setShowSnowEffect(isChristmasQuery);

      try {
        const searchId = ++latestSearchId.current;

        // Merge helper: sort by score, limit
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

        // Disconnect previous channel to avoid resource leaks
        if (activeChannelRef.current) {
          activeChannelRef.current.onmessage = () => {};
          activeChannelRef.current = null;
        }

        // Set up the streaming channel for backend search (apps + files)
        const channel = new Channel<SearchBatch>();
        activeChannelRef.current = channel;
        channel.onmessage = (batch) => {
          // Guard against stale search
          if (searchId !== latestSearchId.current) return;

          if (batch.event === 'apps') {
            streamedApps = convertApps(batch.data.results, searchSensitivity);
            // Show partial results immediately (apps arrived)
            setResults(mergeResults(streamedApps, streamedFiles, streamedPlugins));
          } else if (batch.event === 'files') {
            streamedFiles = convertFiles(batch.data.results);
            // Show partial results immediately (files arrived)
            setResults(mergeResults(streamedApps, streamedFiles, streamedPlugins));
          }
        };

        // Launch the streaming search command (sends apps/files via channel)
        const streamingPromise = appsReady
          ? invoke('search_streaming', {
              options: {
                query: effectiveQuery,
                maxResults: maxResults * 2,
                extFilter: parsed.hasOperators ? (parsed.operators.ext || null) : null,
                dirFilter: parsed.hasOperators ? (parsed.operators.dir || null) : null,
                sizeMin: parsed.hasOperators ? (parsed.operators.sizeMin || null) : null,
                sizeMax: parsed.hasOperators ? (parsed.operators.sizeMax || null) : null,
                modifiedAfter: parsed.hasOperators ? (parsed.operators.modifiedAfter || null) : null,
                modifiedBefore: parsed.hasOperators
                  ? (parsed.operators.modifiedBefore || null)
                  : null,
              },
              apps: allApps,
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

        // Boost game results when query is game-related
        if (isGameBrowseQuery) {
          for (const r of streamedPlugins) {
            if (r.type === SearchResultType.Game) {
              r.score += SEARCH_SCORING.GAME_BOOST;
            }
          }
        }

        // Final merge with all sources
        const allResults = mergeResults(streamedApps, streamedFiles, streamedPlugins);

        // Fallback: show a "Search the web" result when no results found
        if (allResults.length === 0 && effectiveQuery.trim()) {
          const fallbackId = `websearch-fallback-${Date.now()}`;
          const googleUrl =
            'https://www.google.com/search?q=' + encodeURIComponent(effectiveQuery);
          allResults.push({
            id: fallbackId,
            type: SearchResultType.WebSearch,
            title: `Search "${effectiveQuery}" on Google`,
            subtitle: 'Press Enter to search the web',
            score: 1,
            data: {
              id: fallbackId,
              type: 'websearch',
              title: `Search "${effectiveQuery}" on Google`,
              subtitle: 'Press Enter to search the web',
              score: 90,
              data: {
                query: effectiveQuery,
                engine: 'google',
                url: googleUrl,
              },
            } as PluginResultData,
          });
        }

        setResults(allResults);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('Search failed:', errorMessage);
        setResults([]);
        setSearchError(`Search failed: ${errorMessage}`);
      }
    },
    [allApps, isLoading, maxResults, searchSensitivity, setResults, setSearchError, setShowSnowEffect]
  );

  // Debounced search effect — adaptive: 150ms for short queries, 80ms for longer ones
  useEffect(() => {
    if (suspended) {
      return;
    }

    const debounceMs = searchQuery.trim().length > 2 ? 80 : 150;

    const timeoutId = setTimeout(() => {
      performSearch(searchQuery);
    }, debounceMs);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, performSearch, suspended]);

  // Keep selected index in range when results change
  useEffect(() => {
    if (results.length > 0 && selectedIndex >= results.length) {
      setSelectedIndex(results.length - 1);
    }
  }, [results, selectedIndex, setSelectedIndex]);
}
