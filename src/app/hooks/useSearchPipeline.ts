import { invoke } from '@tauri-apps/api/core';
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

/** File search result with score from the batch endpoint */
interface FileSearchResultCompact extends FileInfo {
  score: number;
}

/** Combined result from the batch search_all command */
interface SearchAllResult {
  apps: AppInfoWithScore[];
  files: FileSearchResultCompact[];
  frecencySuggestions: LaunchRecord[];
}

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
            score: SEARCH_PRIORITIES.APPLICATION + 100 - i,
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

        // Batch IPC: search apps + files + frecency in a single Rust call,
        // plugins run in parallel on the frontend side (no IPC needed).
        const [batchResult, pluginResults] = await Promise.all([
          invoke<SearchAllResult>('search_all', {
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
            apps: appsReady ? allApps : [],
          }).catch(() => ({
            apps: [],
            files: [],
            frecencySuggestions: [],
          }) as SearchAllResult),
          pluginRegistry.query({ query: effectiveQuery }).catch(() => [] as PluginResultData[]),
        ]);

        const frecencyApps = batchResult.apps;
        const searchedFiles = batchResult.files;

        // Drop stale responses
        if (searchId !== latestSearchId.current) {
          return;
        }

        // Convert apps with frecency scores — no path in subtitle (clean like Raycast)
        const appResults: SearchResult[] = frecencyApps.map((appWithScore) => ({
          id: appWithScore.id,
          type: SearchResultType.Application,
          title: appWithScore.name,
          subtitle: appWithScore.description || undefined,
          icon: appWithScore.icon,
          score: SEARCH_PRIORITIES.APPLICATION + appWithScore.score,
          data: appWithScore as AppInfo,
        }));

        // Filter junk system files from file results
        const filteredFiles = searchedFiles.filter((file) => {
          const path = file.path.toLowerCase();
          // Skip .exe files from system directories entirely
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
        });

        // Convert files — shortened paths (~\Documents instead of C:\Users\...)
        // Use backend nucleo scores: normalize to 0-50 range and add to FILE base priority
        const maxFileScore = filteredFiles.reduce((max, f) => Math.max(max, f.score), 1);
        const fileResults: SearchResult[] = filteredFiles.map((file) => ({
          id: file.id,
          type: SearchResultType.File,
          title: file.name,
          subtitle: shortenPath(file.path),
          icon: file.icon,
          score: SEARCH_PRIORITIES.FILE + Math.round((file.score / maxFileScore) * 50),
          data: file as unknown as FileInfo,
        }));

        // Convert plugin results to search results
        const pluginSearchResults: SearchResult[] = pluginResults.map((result) => {
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

          // Calculate score with potential keyword boost
          const pluginId = result.pluginId || result.type;
          const keywordBoost = getPluginKeywordBoost(query, pluginId);
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

        // Prepend top frecency apps from batch result (no extra IPC call)
        let finalAppResults = appResults;
        const frecencySuggestions = batchResult.frecencySuggestions || [];
        if (frecencySuggestions.length > 0) {
          const existingPaths = new Set(finalAppResults.map((r) => (r.data as AppInfo)?.path));
          const supplementary: SearchResult[] = frecencySuggestions
            .filter((r) => !existingPaths.has(r.path))
            .map((record, i) => ({
              id: `frecency-${record.path}`,
              type: SearchResultType.Application,
              title: record.name,
              subtitle: 'Recently used',
              icon: undefined,
              score: SEARCH_PRIORITIES.APPLICATION + 40 - i,
              data: {
                id: `frecency-${record.path}`,
                name: record.name,
                path: record.path,
                usageCount: record.launchCount,
              } as AppInfo,
            }));

          finalAppResults = [...finalAppResults, ...supplementary];
        }

        // Boost game results when query is game-related
        if (isGameBrowseQuery) {
          for (const r of pluginSearchResults) {
            if (r.type === SearchResultType.Game) {
              r.score += 500; // push games above everything
            }
          }
        }

        // Merge and sort by score, then limit
        const allResults = [...finalAppResults, ...fileResults, ...pluginSearchResults]
          .sort((a, b) => b.score - a.score)
          .slice(0, maxResults + 4);

        // Fallback: show a "Search the web" result when no results found
        if (allResults.length === 0 && effectiveQuery.trim()) {
          const googleUrl =
            'https://www.google.com/search?q=' + encodeURIComponent(effectiveQuery);
          allResults.push({
            id: `websearch-fallback-${Date.now()}`,
            type: SearchResultType.WebSearch,
            title: `Search "${effectiveQuery}" on Google`,
            subtitle: 'Press Enter to search the web',
            score: 1,
            data: {
              id: `websearch-fallback-${Date.now()}`,
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
    [allApps, isLoading, maxResults, setResults, setSearchError, setShowSnowEffect]
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
