import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applicationService } from '../../features/applications/services/applicationService';
import { pluginRegistry } from '../../features/plugins/core';
import { PluginResult as PluginResultData } from '../../features/plugins/types';
import { AppInfo, FileInfo, SearchResult, SearchResultType } from '../../shared/types/common.types';
import { logger } from '../../shared/utils/logger';

// Search result priority scores (higher = appears first)
export const SEARCH_PRIORITIES = {
  APPLICATION: 200,
  FILE: 80,
  PLUGIN_BASE: 100,
  PLUGIN_KEYWORD_BOOST: 300, // Boost plugins when query matches their keywords exactly
} as const;

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
  allApps: AppInfo[];
  isLoading: boolean;
  maxResults: number;
  /**
   * When true, the debounced search effect is suspended (e.g. while a non-search
   * view such as the emoji picker is active). The query state remains writable.
   */
  suspended?: boolean;
}

export interface UseSearchPipelineResult {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  results: SearchResult[];
  setResults: React.Dispatch<React.SetStateAction<SearchResult[]>>;
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  searchError: string | null;
  setSearchError: (err: string | null) => void;
  showSnowEffect: boolean;
}

/**
 * Owns the search pipeline: query state, debounced execution, and result merging.
 *
 * - 150 ms debounce
 * - Stale-response protection via `latestSearchId`
 * - Parallel apps + files + plugin queries
 * - Score-based merge/sort/limit
 * - Christmas easter egg detection (snow effect)
 */
export function useSearchPipeline({
  allApps,
  isLoading,
  maxResults,
  suspended = false,
}: UseSearchPipelineOptions): UseSearchPipelineResult {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showSnowEffect, setShowSnowEffect] = useState(false);

  const latestSearchId = useRef(0); // Prevent stale search responses

  const performSearch = useCallback(
    async (query: string) => {
      // Do not search while apps are loading or absent yet
      if (isLoading || allApps.length === 0) {
        setResults([]);
        return;
      }

      if (!query.trim()) {
        setResults([]);
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

        // Search applications, files, and plugins in parallel
        const [searchedApps, searchedFiles, pluginResults] = await Promise.all([
          applicationService.searchApplications({ query }, allApps),
          invoke<FileInfo[]>('search_files', {
            query,
            limit: maxResults,
          }).catch(() => [] as FileInfo[]), // Gracefully handle if file indexing not started
          pluginRegistry.query({ query }).catch(() => [] as PluginResultData[]), // Gracefully handle plugin errors
        ]);

        // Drop stale responses
        if (searchId !== latestSearchId.current) {
          return;
        }

        // Convert apps to search results (highest priority)
        const appResults: SearchResult[] = searchedApps.map((app) => ({
          id: app.id,
          type: SearchResultType.Application,
          title: app.name,
          subtitle: app.path,
          icon: app.icon,
          score: SEARCH_PRIORITIES.APPLICATION,
          data: app,
        }));

        // Convert files to search results (lower priority than apps)
        const fileResults: SearchResult[] = searchedFiles.map((file) => ({
          id: file.id,
          type: SearchResultType.File,
          title: file.name,
          subtitle: file.path,
          icon: file.icon,
          score: SEARCH_PRIORITIES.FILE,
          data: file,
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

        // Merge and sort by score, then limit
        const allResults = [...appResults, ...fileResults, ...pluginSearchResults]
          .sort((a, b) => b.score - a.score)
          .slice(0, maxResults);

        setResults(allResults);
        setSelectedIndex(0);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('Search failed:', errorMessage);
        setResults([]);
        setSearchError(`Search failed: ${errorMessage}`);
      }
    },
    [allApps, isLoading, maxResults]
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
  }, [results, selectedIndex]);

  return {
    searchQuery,
    setSearchQuery,
    results,
    setResults,
    selectedIndex,
    setSelectedIndex,
    searchError,
    setSearchError,
    showSnowEffect,
  };
}
