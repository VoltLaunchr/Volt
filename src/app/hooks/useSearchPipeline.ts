import { invoke, Channel } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef } from 'react';
import { pluginRegistry } from '../../features/plugins/core';
import { PluginResult as PluginResultData, PluginResultType } from '../../features/plugins/types';
import {
  braveSearchProvider,
  webSearchHistory,
  type WebSearchResult,
} from '../../features/web-search';
import { AppInfo, FileInfo, SearchResult, SearchResultType } from '../../shared/types/common.types';
import {
  SEARCH_SCORING,
  SEARCH_SENSITIVITY_THRESHOLDS,
  SEARCH_SENSITIVITY_FUZZY_MULTIPLIER,
} from '../../shared/constants/searchScoring';
import { resolveFallbackBrandIcon } from '../../shared/constants/webBrandIcons';
import type { SearchSensitivity } from '../../features/settings/types/settings.types';
import { extractErrorMessage } from '../../shared/utils/error';
import { logger } from '../../shared/utils/logger';
import { parseQuery } from '../../shared/utils/queryParser';
import { detectUrl } from '../../shared/utils/urlDetector';
import { useAppStore } from '../../stores/appStore';
import { useSearchStore } from '../../stores/searchStore';
import { mergeSearchResults } from '../searchResults';
import { shouldShowWebFallbacks } from '../webSearchConfidence';

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
  iconByPath?: Map<string, string>
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
        icon: appWithScore.icon ?? iconByPath?.get(appWithScore.path.toLowerCase()),
        score: SEARCH_SCORING.APPLICATION + adjustedScore,
        data: appWithScore,
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
          'program files',
          'program files (x86)',
          'windows',
          'programdata',
          'common files',
          'clicktorun',
          'installer',
          'servicehub',
          'windows kits',
          'microsoft shared',
          'nvidia corporation',
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
      data: file,
    }));
};

const convertPlugins = (pluginResults: PluginResultData[]): SearchResult[] =>
  pluginResults.map((result) => {
    let searchResultType: SearchResultType;
    // For most plugins we pass the full PluginResult through as `data` so
    // downstream consumers can inspect metadata (pluginId, badge, etc.).
    // System monitor is the exception: the renderer expects the inner
    // `{ type, value, color }` payload directly, so we unwrap here.
    let data: SearchResult['data'] = result;
    switch (result.type) {
      case PluginResultType.Calculator:
        searchResultType = SearchResultType.Calculator;
        break;
      case PluginResultType.WebSearch:
        searchResultType = SearchResultType.WebSearch;
        break;
      case PluginResultType.SystemCommand:
        searchResultType = SearchResultType.SystemCommand;
        break;
      case PluginResultType.Game:
        searchResultType = SearchResultType.Game;
        break;
      case PluginResultType.Timer:
        searchResultType = SearchResultType.Timer;
        break;
      case PluginResultType.ShellCommand:
        searchResultType = SearchResultType.ShellCommand;
        break;
      case PluginResultType.SystemMonitor:
        searchResultType = SearchResultType.SystemMonitor;
        data = (result.data ?? result) as SearchResult['data'];
        break;
      case PluginResultType.GridItem:
        searchResultType = SearchResultType.GridItem;
        break;
      default:
        searchResultType = SearchResultType.Plugin;
    }

    // The registry annotates each result with how the query matched the
    // plugin's activation manifest. An explicit prefix/keyword match (the user
    // typed the feature's trigger or name) earns the keyword boost, pushing the
    // plugin above incidental app/file matches — the single source of truth that
    // replaces the old hand-maintained PLUGIN_KEYWORDS map.
    const baseScore = SEARCH_SCORING.PLUGIN_BASE + result.score;
    const boosted = result.matchKind === 'prefix' || result.matchKind === 'keyword';
    const finalScore =
      result.type === PluginResultType.WebSearch && boosted
        ? SEARCH_SCORING.WEB_EXPLICIT_ACTION
        : boosted
          ? SEARCH_SCORING.PLUGIN_KEYWORD_BOOST + baseScore
          : baseScore;

    return {
      id: result.id,
      type: searchResultType,
      title: result.title,
      subtitle: result.subtitle,
      icon: result.icon,
      badge: result.badge,
      score: finalScore,
      data,
      accessories: result.accessories,
      section: result.section,
      layout: result.layout,
    };
  });

function explicitWebQuery(pluginResults: PluginResultData[]): string | null {
  const result = pluginResults.find(
    (candidate) =>
      candidate.type === PluginResultType.WebSearch &&
      (candidate.matchKind === 'prefix' || candidate.matchKind === 'keyword') &&
      typeof candidate.data?.query === 'string'
  );
  const query = result?.data?.query;
  return typeof query === 'string' && query.trim().length >= 2 ? query.trim() : null;
}

function convertWebResults(results: WebSearchResult[], query: string): SearchResult[] {
  return results.map((result, index) => {
    const id = `web-result-${result.providerId}-${index}`;
    const pluginResult: PluginResultData = {
      id,
      type: PluginResultType.WebSearch,
      title: result.title,
      subtitle: result.description,
      icon: result.favicon,
      badge: result.providerId === 'brave' ? 'Brave' : 'Web',
      score: SEARCH_SCORING.WEB_EXPLICIT_RESULT - index,
      pluginId: 'websearch',
      accessories: result.age ? [{ text: result.age }] : undefined,
      data: {
        query,
        engine: result.providerId,
        url: result.url,
      },
    };

    return {
      id,
      type: SearchResultType.WebSearch,
      title: result.title,
      subtitle: result.description,
      icon: result.favicon,
      badge: pluginResult.badge,
      score: pluginResult.score,
      data: pluginResult,
      accessories: pluginResult.accessories,
    };
  });
}

function waitForWebDebounce(signal: AbortSignal, delayMs = 275): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('The operation was aborted', 'AbortError'));
    };
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

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
  const searchSensitivity: SearchSensitivity =
    useAppStore((s) => s.settings?.general.searchSensitivity) ?? 'medium';
  const searchLanguage = useAppStore((s) => s.settings?.general.language) ?? 'auto';
  // App shortcuts carry user-defined aliases. We pass them to the backend
  // cascade ranker on every search so alias-exact / alias-prefix tiers fire
  // (e.g. typing "gh" launches GitHub when GitHub.alias = "gh").
  const appShortcuts = useAppStore((s) => s.settings?.shortcuts?.appShortcuts);
  // Fallback commands run when the regular search returns no results. They are
  // user-configurable in Settings → Fallback Commands.
  const fallbackCommands = useAppStore((s) => s.settings?.fallbacks?.commands);
  const rememberWebSearchHistory =
    useAppStore((s) => s.settings?.fallbacks?.rememberWebSearchHistory) ?? false;
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const results = useSearchStore((s) => s.results);
  const selectedIndex = useSearchStore((s) => s.selectedIndex);
  const { setResults, setSelectedIndex, setSearchError, setShowSnowEffect } =
    useSearchStore.getState();

  const latestSearchId = useRef(0); // Prevent stale search responses
  const activeChannelRef = useRef<Channel<SearchBatch> | null>(null);
  const activeWebSearchRef = useRef<AbortController | null>(null);

  const finishSearch = useCallback((searchId: number) => {
    if (searchId === latestSearchId.current) {
      useSearchStore.getState().setIsSearching(false);
    }
  }, []);

  const performSearch = useCallback(
    async (query: string, searchId: number) => {
      // Read isLoading from the store at call-time to avoid stale closures
      // (captured isLoading would reflect the value at callback creation time,
      // potentially skipping searches when apps finish loading between renders)
      const { isLoading: currentIsLoading } = useAppStore.getState();
      // If apps aren't loaded yet, still allow plugin-only search
      const appsReady = !currentIsLoading && allApps.length > 0;
      const iconByPath = new Map(
        allApps
          .filter((app): app is AppInfo & { icon: string } => Boolean(app.icon))
          .map((app) => [app.path.toLowerCase(), app.icon])
      );
      webSearchHistory.setEnabled(rememberWebSearchHistory);

      if (!query.trim()) {
        // The root view uses an empty result set to render its default command
        // suggestions. Frecency results here hide that view after a query is
        // cleared and can make a stale application appear to remain selected.
        if (searchId === latestSearchId.current) setResults([]);
        setShowSnowEffect(false);
        finishSearch(searchId);
        return;
      }

      // Parse operators from query
      const parsed = parseQuery(query);
      const effectiveQuery = parsed.hasOperators ? parsed.searchQuery : query;

      // Detect "show all" queries — user wants to browse a category, not search by name
      const lowerQuery = query.trim().toLowerCase();
      const isAppBrowseQuery = [
        'app',
        'apps',
        'application',
        'applications',
        'programmes',
      ].includes(lowerQuery);
      const isGameBrowseQuery = ['game', 'games', 'jeu', 'jeux'].includes(lowerQuery);

      // If browsing apps, show ALL apps sorted by name (frecency will reorder used ones)
      if (isAppBrowseQuery && appsReady) {
        const allAppResults: SearchResult[] = allApps.slice(0, maxResults + 4).map((app, i) => ({
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
          const frecency = await invoke<LaunchRecord[]>('get_frecency_suggestions', {
            limit: 20,
          }).catch(() => [] as LaunchRecord[]);
          if (frecency.length > 0) {
            const frecencyPaths = new Set(frecency.map((r) => r.path));
            allAppResults.sort((a, b) => {
              const aUsed = frecencyPaths.has((a.data as AppInfo).path) ? 1 : 0;
              const bUsed = frecencyPaths.has((b.data as AppInfo).path) ? 1 : 0;
              return bUsed - aUsed || b.score - a.score;
            });
          }
        } catch {
          /* continue */
        }

        if (searchId === latestSearchId.current) {
          setResults(allAppResults);
          setShowSnowEffect(false);
        }
        finishSearch(searchId);
        return;
      }

      // Check if query is about Christmas (for snow effect)
      const isChristmasQuery =
        /christmas|xmas|noel|25.*dec|dec.*25/i.test(query) ||
        /days?\s+(until|to|before)\s+(christmas|xmas|noel|dec.*25|25.*dec)/i.test(query);

      setShowSnowEffect(isChristmasQuery);

      try {
        const mergeResults = (...sources: SearchResult[][]): SearchResult[] =>
          mergeSearchResults(maxResults + 4, ...sources);

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
            streamedApps = convertApps(batch.data.results, searchSensitivity, iconByPath);
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
          ? invoke<void>('search_streaming', {
              options: {
                query: effectiveQuery,
                maxResults: maxResults * 2,
                extFilter: parsed.hasOperators ? parsed.operators.ext || null : null,
                dirFilter: parsed.hasOperators ? parsed.operators.dir || null : null,
                sizeMin: parsed.hasOperators ? parsed.operators.sizeMin || null : null,
                sizeMax: parsed.hasOperators ? parsed.operators.sizeMax || null : null,
                modifiedAfter: parsed.hasOperators ? parsed.operators.modifiedAfter || null : null,
                modifiedBefore: parsed.hasOperators
                  ? parsed.operators.modifiedBefore || null
                  : null,
              },
              shortcuts: appShortcuts ?? null,
              onEvent: channel,
            }).catch((err) => {
              logger.warn(
                'Streaming search failed, results may be partial:',
                extractErrorMessage(err)
              );
            })
          : Promise.resolve();

        // Wait for both streaming backend and plugin search to complete
        const [, pluginResults] = await Promise.all([streamingPromise, pluginPromise]);

        // Drop stale responses
        if (searchId !== latestSearchId.current) {
          finishSearch(searchId);
          return;
        }

        // Merge plugin results into final set
        streamedPlugins = convertPlugins(pluginResults);

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

        // URL auto-detection: inject an "Open URL" result at the top when the
        // query looks like a navigable URL, with no prefix required.
        const detectedUrl = detectUrl(query);
        if (detectedUrl) {
          const urlResultId = `open-url-${detectedUrl}`;
          const urlResult: SearchResult = {
            id: urlResultId,
            type: SearchResultType.Url,
            title: `Open ${detectedUrl}`,
            subtitle: 'Press Enter to open in browser',
            score: SEARCH_SCORING.PLUGIN_KEYWORD_BOOST + 200,
            data: {
              id: urlResultId,
              type: 'url',
              title: `Open ${detectedUrl}`,
              subtitle: 'Press Enter to open in browser',
              score: SEARCH_SCORING.PLUGIN_KEYWORD_BOOST + 200,
              data: { url: detectedUrl },
            },
          };
          allResults.unshift(urlResult);
          // Re-sort so score ordering is respected
          allResults.sort((a, b) => b.score - a.score);
        }

        // Fallback Commands — use result confidence rather than array length.
        // A secondary-field app match or unrelated fuzzy file must not hide the
        // user's web/AI fallbacks.
        if (shouldShowWebFallbacks(allResults, effectiveQuery)) {
          const enabled = (fallbackCommands ?? [])
            .filter((cmd) => cmd.enabled)
            .sort((a, b) => a.order - b.order);

          const encoded = encodeURIComponent(effectiveQuery);
          const substitute = (tpl: string): string =>
            tpl.replace(/\{query\}/g, encoded).replace(/\{rawQuery\}/g, effectiveQuery);

          enabled.forEach((cmd, idx) => {
            // Resolved URL/command after placeholder substitution.
            const resolvedTarget = substitute(cmd.target);
            const resolvedLabel = substitute(cmd.label);
            const fallbackId = `fallback-${cmd.id}-${searchId}`;
            // Score descending in fallback order so the user's preferred
            // fallback is selected by default. Stays well below any real
            // result (worst real fuzzy match is in the 200+ tier).
            const fallbackScore = 10 - idx;

            if (cmd.kind === 'shell') {
              // Shell kind: dispatch via ShellCommandPlugin. The plugin reads
              // `data.command` and pipes it through the standard streaming
              // shell pipeline (validation, redaction, output events).
              const shellData: PluginResultData = {
                id: fallbackId,
                type: PluginResultType.ShellCommand,
                title: resolvedLabel,
                subtitle: `Run: ${resolvedTarget}`,
                score: 90,
                pluginId: 'shellcommand',
                data: { command: resolvedTarget, status: 'pending' },
              };
              allResults.push({
                id: fallbackId,
                type: SearchResultType.ShellCommand,
                title: resolvedLabel,
                subtitle: `Run: ${resolvedTarget}`,
                icon: resolveFallbackBrandIcon(cmd.id, cmd.icon),
                score: fallbackScore,
                badge: 'Fallback',
                data: shellData,
              });
              return;
            }

            // webSearch + url kinds — open the resolved URL in the default
            // browser. WebSearch is the existing dispatch path that already
            // handles URL opening via the WebSearchPlugin.
            const webData: PluginResultData = {
              id: fallbackId,
              type: PluginResultType.WebSearch,
              title: resolvedLabel,
              subtitle: 'Press Enter to open in browser',
              score: 90,
              data: { query: effectiveQuery, engine: cmd.id, url: resolvedTarget },
            };
            allResults.push({
              id: fallbackId,
              type: SearchResultType.WebSearch,
              title: resolvedLabel,
              subtitle: 'Press Enter to open in browser',
              icon: resolveFallbackBrandIcon(cmd.id, cmd.icon),
              score: fallbackScore,
              badge: 'Fallback',
              data: webData,
            });
          });
        }

        setResults(allResults);

        // Progressive web enrichment. It only runs for an explicit web plugin
        // activation, never for ordinary root-search keystrokes. Local results
        // are already visible; the network request cannot block the launcher.
        const webQuery = explicitWebQuery(pluginResults);
        if (webQuery) {
          const controller = new AbortController();
          activeWebSearchRef.current = controller;
          void waitForWebDebounce(controller.signal)
            .then(() =>
              braveSearchProvider.search(webQuery, {
                signal: controller.signal,
                limit: 3,
                country: searchLanguage === 'fr' ? 'FR' : undefined,
                language: searchLanguage === 'auto' ? undefined : searchLanguage,
              })
            )
            .then((webResults) => {
              if (
                controller.signal.aborted ||
                searchId !== latestSearchId.current ||
                webResults.length === 0
              ) {
                return;
              }
              const converted = convertWebResults(webResults, webQuery);
              setResults(mergeSearchResults(maxResults + 4, allResults, converted));
            })
            .catch(() => {
              // Optional provider: local search and URL fallbacks remain usable.
            })
            .finally(() => {
              if (activeWebSearchRef.current === controller) {
                activeWebSearchRef.current = null;
              }
            });
        }
      } catch (err) {
        const errorMessage = extractErrorMessage(err);
        logger.error('Search failed:', errorMessage);
        setResults([]);
        setSearchError(`Search failed: ${errorMessage}`);
      } finally {
        finishSearch(searchId);
      }
    },
    [
      allApps,
      appShortcuts,
      fallbackCommands,
      finishSearch,
      maxResults,
      rememberWebSearchHistory,
      searchSensitivity,
      searchLanguage,
      setResults,
      setSearchError,
      setShowSnowEffect,
    ]
  );

  // Debounced search effect — adaptive: 150ms for short queries, 80ms for longer ones
  useEffect(() => {
    if (suspended) {
      latestSearchId.current += 1;
      if (activeChannelRef.current) {
        activeChannelRef.current.onmessage = () => {};
        activeChannelRef.current = null;
      }
      activeWebSearchRef.current?.abort();
      activeWebSearchRef.current = null;
      useSearchStore.getState().setIsSearching(false);
      return;
    }

    // Reserve/invalidate the search generation immediately when an input or
    // dependency changes. Waiting until the debounced callback runs leaves an
    // 80–150 ms window where an older streaming/web response can still pass
    // the stale-response guard and overwrite the new query's UI.
    const searchId = ++latestSearchId.current;
    if (activeChannelRef.current) {
      activeChannelRef.current.onmessage = () => {};
      activeChannelRef.current = null;
    }
    activeWebSearchRef.current?.abort();
    activeWebSearchRef.current = null;

    if (searchQuery.trim()) {
      useSearchStore.getState().setIsSearching(true);
    } else {
      // Restore the default suggestions synchronously when the input is
      // cleared; do not leave the previous search visible for the debounce.
      setResults([]);
      setSelectedIndex(0);
      setShowSnowEffect(false);
      useSearchStore.getState().setIsSearching(false);
    }

    const debounceMs = searchQuery.trim().length > 2 ? 80 : 150;

    const timeoutId = setTimeout(() => {
      void performSearch(searchQuery, searchId);
    }, debounceMs);

    return () => clearTimeout(timeoutId);
  }, [
    searchQuery,
    performSearch,
    setResults,
    setSelectedIndex,
    setShowSnowEffect,
    suspended,
  ]);

  // Keep selected index in range when results change
  useEffect(() => {
    if (results.length > 0 && selectedIndex >= results.length) {
      setSelectedIndex(results.length - 1);
    }
  }, [results, selectedIndex, setSelectedIndex]);
}
