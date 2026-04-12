/**
 * Hook for searching applications with debouncing
 * Provides search functionality with automatic debounce and stale response prevention
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppInfo } from '../../../shared/types/common.types';
import { applicationService } from '../services/applicationService';
import type { AppSearchOptions } from '../types';

export interface UseApplicationSearchOptions {
  /** Debounce delay in milliseconds (default: 150) */
  debounceMs?: number;
  /** Maximum number of results (default: 8) */
  maxResults?: number;
  /** Whether search is enabled (default: true) */
  enabled?: boolean;
}

export interface UseApplicationSearchReturn {
  /** Current search results */
  results: AppInfo[];
  /** Whether search is in progress */
  isSearching: boolean;
  /** Current search query */
  query: string;
  /** Error if search failed */
  error: string | null;
  /** Perform search with given query */
  search: (query: string) => void;
  /** Clear search results and query */
  clear: () => void;
}

/**
 * Hook for searching applications with automatic debouncing
 * Prevents stale responses from overwriting newer results
 *
 * @param apps - Array of applications to search through
 * @param options - Search options
 * @returns Search state and control functions
 *
 * @example
 * ```tsx
 * const { apps } = useApplications();
 * const { results, isSearching, search, clear } = useApplicationSearch(apps);
 *
 * return (
 *   <SearchBar
 *     onChange={search}
 *     onClear={clear}
 *   />
 *   <ResultsList results={results} loading={isSearching} />
 * );
 * ```
 */
export function useApplicationSearch(
  apps: AppInfo[],
  options: UseApplicationSearchOptions = {}
): UseApplicationSearchReturn {
  const { debounceMs = 150, maxResults = 8, enabled = true } = options;

  const [results, setResults] = useState<AppInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Track search ID to prevent stale responses
  const searchIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performSearch = useCallback(
    async (searchQuery: string, searchId: number) => {
      // Don't search if disabled or no apps
      if (!enabled || apps.length === 0) {
        setResults([]);
        return;
      }

      // Empty query = clear results
      if (!searchQuery.trim()) {
        setResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      setError(null);

      try {
        const searchOptions: AppSearchOptions = {
          query: searchQuery,
          limit: maxResults,
        };

        const searchResults = await applicationService.searchApplications(searchOptions, apps);

        // Only update if this is still the latest search
        if (searchId === searchIdRef.current) {
          setResults(searchResults);
          setIsSearching(false);
        }
      } catch (err) {
        // Only update error if this is still the latest search
        if (searchId === searchIdRef.current) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          setError(errorMessage);
          setResults([]);
          setIsSearching(false);
        }
      }
    },
    [apps, enabled, maxResults]
  );

  const search = useCallback(
    (newQuery: string) => {
      setQuery(newQuery);

      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Increment search ID to invalidate any pending searches
      const searchId = ++searchIdRef.current;

      // Debounce the actual search
      debounceTimerRef.current = setTimeout(() => {
        performSearch(newQuery, searchId);
      }, debounceMs);
    },
    [debounceMs, performSearch]
  );

  const clear = useCallback(() => {
    // Clear timer and increment search ID
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    searchIdRef.current++;

    setQuery('');
    setResults([]);
    setError(null);
    setIsSearching(false);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Re-search when apps change (but only if there's an active query)
  useEffect(() => {
    if (query.trim() && apps.length > 0) {
      const searchId = ++searchIdRef.current;
      performSearch(query, searchId);
    }
  }, [apps, query, performSearch]);

  return {
    results,
    isSearching,
    query,
    error,
    search,
    clear,
  };
}

export default useApplicationSearch;
