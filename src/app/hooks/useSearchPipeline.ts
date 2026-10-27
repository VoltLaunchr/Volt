import { invoke, Channel } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { pluginRegistry } from '../../features/plugins/core';
import { PluginResult as PluginResultData, PluginResultType } from '../../features/plugins/types';
import {
  braveSearchProvider,
  webSearchHistory,
  type WebSearchResult,
} from '../../features/web-search';
import {
  AppInfo,
  FileInfo,
  SearchResult,
  SearchResultType,
  type SearchTier,
} from '../../shared/types/common.types';
import type { LearnedMatch } from '../../shared/types/generated/LearnedMatch';
import { resolveFallbackBrandIcon } from '../../shared/constants/webBrandIcons';
import type { SearchSensitivity } from '../../features/settings/types/settings.types';
import { extractErrorMessage } from '../../shared/utils/error';
import { logger } from '../../shared/utils/logger';
import { parseQuery } from '../../shared/utils/queryParser';
import { detectUrl } from '../../shared/utils/urlDetector';
import { useAppStore } from '../../stores/appStore';
import { useSearchStore } from '../../stores/searchStore';
import { getCommandFrecency, refreshCommandFrecency } from '../commandFrecency';
import { getStableResultIdentity } from '../searchResultIdentity';
import { bandRank, compareResults, isExplicitActivation, rankPluginResult } from '../searchRanking';
import {
  filterRootSearchApps,
  filterRootSearchPlugins,
  shouldSearchFiles,
} from '../rootSearchScope';
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

/**
 * Ranked application from the Rust cascade (`AppInfoWithScore`): `tier` on
 * the shared ladder, `score` = match quality inside the tier, `frecency` =
 * universal frecency date.
 */
interface AppInfoWithScore extends AppInfo {
  score: number;
  tier: SearchTier;
  frecency: number;
}

/** Shape returned by get_frecency_suggestions */
interface LaunchRecord {
  path: string;
  name: string;
  launchCount: number;
  lastLaunched: number;
  pinned: boolean;
}

/**
 * File search result from the batch/streaming endpoint. `tier` is the
 * absolute, query-relative file tier computed in Rust
 * (`search::FileRelevanceScorer`) on the shared ladder; `score` is the
 * filename match quality inside it. Never normalised by the batch maximum.
 */
interface FileSearchResultCompact extends FileInfo {
  score: number;
  tier: SearchTier;
}

/** Streaming search batch events from the Rust backend */
type SearchBatch =
  | { event: 'learned'; data: { results: LearnedMatch[] } }
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

const SYSTEM_EXECUTABLE_PATH_SEGMENTS = [
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
] as const;

// ---- Conversion helpers (used by streaming callbacks + final merge) ----

// Search sensitivity is applied by the Rust ranker (`search::SearchSensitivity`),
// which only returns matches the user's setting accepts, so no filtering here.
const convertApps = (apps: AppInfoWithScore[], iconByPath?: Map<string, string>): SearchResult[] =>
  apps.map((appWithScore) => ({
    id: appWithScore.id,
    type: SearchResultType.Application,
    title: appWithScore.name,
    subtitle: appWithScore.description || undefined,
    icon: appWithScore.icon ?? iconByPath?.get(appWithScore.path.toLowerCase()),
    score: appWithScore.score,
    data: appWithScore,
    rank: {
      band: 'ranked',
      tier: appWithScore.tier,
      quality: appWithScore.score,
      frecency: appWithScore.frecency,
      source: 'app',
      declared: 0,
    },
  }));

const convertFiles = (files: FileSearchResultCompact[]): SearchResult[] =>
  files
    .filter((file) => {
      const path = file.path.toLowerCase();
      if (file.name.toLowerCase().endsWith('.exe')) {
        if (SYSTEM_EXECUTABLE_PATH_SEGMENTS.some((segment) => path.includes(segment))) {
          return false;
        }
      }
      return true;
    })
    .map((file) => ({
      id: file.id,
      type: SearchResultType.File,
      title: file.name,
      subtitle: shortenPath(file.path),
      icon: file.icon,
      score: file.score,
      data: file,
      // Absolute tier from Rust — never normalised by the batch maximum.
      rank: {
        band: 'ranked',
        tier: file.tier,
        quality: file.score,
        frecency: 0,
        source: 'file',
        declared: 0,
      },
    }));

interface PluginConversionContext {
  /** Operator-stripped query used for title matching. */
  query: string;
  /** Learned tiers streamed by Rust for this query, keyed by stable identity. */
  learned: ReadonlyMap<string, SearchTier>;
  gameBrowse: boolean;
}

const convertPlugins = (
  pluginResults: PluginResultData[],
  context: PluginConversionContext
): SearchResult[] =>
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

    const converted: SearchResult = {
      id: result.id,
      type: searchResultType,
      title: result.title,
      subtitle: result.subtitle,
      icon: result.icon,
      badge: result.badge,
      score: result.score,
      data,
      accessories: result.accessories,
      section: result.section,
      layout: result.layout,
    };

    // One ladder for every command-like result: the registry's activation
    // match (`matchKind`, from the plugin manifest — the single source of
    // truth) gives the `activation` tier, titles are matched like app names,
    // learned bindings and the universal frecency apply by stable identity.
    const identity = getStableResultIdentity(converted);
    converted.rank = rankPluginResult(result, {
      query: context.query,
      identity,
      learned: context.learned,
      frecency: getCommandFrecency(identity),
      gameBrowse: context.gameBrowse,
    });
    return converted;
  });

function explicitWebQuery(pluginResults: PluginResultData[]): string | null {
  const result = pluginResults.find(
    (candidate) =>
      candidate.type === PluginResultType.WebSearch &&
      isExplicitActivation(candidate) &&
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
      score: results.length - index,
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
      // Live hits sit directly below the explicit web action, in provider order.
      rank: bandRank('liveWeb', pluginResult.score),
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
 * - Unified tier comparator for the merge/sort/limit (`searchRanking.ts`)
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
  // Settings -> Launcher: what the root search may surface (default: everything).
  const includeFiles = useAppStore((s) => s.settings?.launcher?.includeFilesInRootSearch) !== false;
  const includeGames = useAppStore((s) => s.settings?.launcher?.includeGamesInRootSearch) !== false;
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const results = useSearchStore((s) => s.results);
  const selectedIndex = useSearchStore((s) => s.selectedIndex);
  const { setResults, setSelectedIndex, setSearchError, setShowSnowEffect } =
    useSearchStore.getState();
  // Streaming batches for the *same* query must not reset keyboard navigation.
  // `setResults` resets selectedIndex to 0 (correct for a new query); partial
  // batches use the preserving variant so ArrowDown during apps→files doesn't
  // snap back to 0.
  const { setResultsPreserveSelection } = useSearchStore.getState();

  // Universal frecency of plugin commands: cached once, then kept in sync
  // locally so ranking needs no IPC per keystroke.
  useEffect(() => {
    void refreshCommandFrecency();
  }, []);

  const latestSearchId = useRef(0); // Prevent stale search responses
  const activeChannelRef = useRef<Channel<SearchBatch> | null>(null);
  const activeWebSearchRef = useRef<AbortController | null>(null);

  // The application catalog changes only after a scan. Building this lookup on
  // every debounced keystroke needlessly walked the complete catalog each time.
  const iconByPath = useMemo(() => {
    const icons = new Map<string, string>();
    for (const app of allApps) {
      if (app.icon) icons.set(app.path.toLowerCase(), app.icon);
    }
    return icons;
  }, [allApps]);

  const enabledFallbackCommands = useMemo(
    () =>
      (fallbackCommands ?? [])
        .filter((command) => command.enabled)
        .sort((a, b) => a.order - b.order),
    [fallbackCommands]
  );

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
      webSearchHistory.setEnabled(rememberWebSearchHistory);

      if (!query.trim()) {
        // The root view uses an empty result set to render its default command
        // suggestions. Frecency results here hide that view after a query is
        // cleared and can make a stale application appear to remain selected.
        if (searchId === latestSearchId.current) setResults([]);
        setShowSnowEffect(false);
        finishSearch(searchId);
        // Cleared query (launch, reopen, Escape): pick up usage recorded by
        // other windows, e.g. history cleared from Settings.
        void refreshCommandFrecency();
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

      // If browsing apps, show ALL apps in catalog order (frecency will reorder used ones)
      if (isAppBrowseQuery && appsReady) {
        const allAppResults: SearchResult[] = allApps.slice(0, maxResults + 4).map((app) => ({
          id: app.id,
          type: SearchResultType.Application,
          title: app.name,
          subtitle: app.description || undefined,
          icon: app.icon,
          score: 0,
          data: app,
        }));

        // Fetch frecency to reorder — used apps first. The sort is stable, so
        // the catalog order is kept within each group.
        try {
          const frecency = await invoke<LaunchRecord[]>('get_frecency_suggestions', {
            limit: 20,
          }).catch(() => [] as LaunchRecord[]);
          if (frecency.length > 0) {
            const frecencyPaths = new Set(frecency.map((r) => r.path));
            allAppResults.sort((a, b) => {
              const aUsed = frecencyPaths.has((a.data as AppInfo).path) ? 1 : 0;
              const bUsed = frecencyPaths.has((b.data as AppInfo).path) ? 1 : 0;
              return bUsed - aUsed;
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

      // New search generation: reset navigation once. Subsequent streaming
      // batches for this same searchId preserve the index (see below) so
      // ArrowDown between apps→files doesn't snap back to 0.
      if (searchId === latestSearchId.current) {
        useSearchStore.getState().setSelectedIndex(0);
      }

      try {
        const mergeResults = (...sources: SearchResult[][]): SearchResult[] =>
          mergeSearchResults(maxResults + 4, ...sources);

        // Accumulated partial results from streaming
        const learned = new Map<string, SearchTier>();
        let streamedApps: SearchResult[] = [];
        let streamedFiles: SearchResult[] = [];
        let streamedPlugins: SearchResult[] = [];
        const rootScope = { includeFiles, includeGames };

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

          if (batch.event === 'learned') {
            for (const match of batch.data.results) learned.set(match.resultId, match.tier);
          } else if (batch.event === 'apps') {
            streamedApps = convertApps(
              filterRootSearchApps(batch.data.results, rootScope, isGameBrowseQuery),
              iconByPath
            );
            // Show partial results immediately (apps arrived)
            setResultsPreserveSelection(mergeResults(streamedApps, streamedFiles, streamedPlugins));
          } else if (batch.event === 'files') {
            streamedFiles = convertFiles(batch.data.results);
            // Show partial results immediately (files arrived)
            setResultsPreserveSelection(mergeResults(streamedApps, streamedFiles, streamedPlugins));
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
                sensitivity: searchSensitivity,
                includeFiles: shouldSearchFiles(rootScope, parsed.hasOperators),
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

        // Merge plugin results into final set. Game browse queries put games
        // in their own band above the ladder (`rankPluginResult`).
        streamedPlugins = convertPlugins(
          filterRootSearchPlugins(pluginResults, rootScope, isGameBrowseQuery),
          {
            query: effectiveQuery,
            learned,
            gameBrowse: isGameBrowseQuery,
          }
        );

        // Final merge with all sources
        const allResults = mergeResults(streamedApps, streamedFiles, streamedPlugins);

        // URL auto-detection: a typed URL is a direct answer, placed in the
        // `answer` band above every ranked result, with no prefix required.
        const detectedUrl = detectUrl(query);
        if (detectedUrl) {
          const urlResultId = `open-url-${detectedUrl}`;
          const urlResult: SearchResult = {
            id: urlResultId,
            type: SearchResultType.Url,
            title: `Open ${detectedUrl}`,
            subtitle: 'Press Enter to open in browser',
            score: 0,
            data: {
              id: urlResultId,
              type: 'url',
              title: `Open ${detectedUrl}`,
              subtitle: 'Press Enter to open in browser',
              score: 0,
              data: { url: detectedUrl },
            },
            rank: bandRank('answer', 0),
          };
          allResults.push(urlResult);
          allResults.sort(compareResults);
        }

        // Fallback Commands — use result confidence rather than array length.
        // A secondary-field app match or unrelated fuzzy file must not hide the
        // user's web/AI fallbacks.
        if (shouldShowWebFallbacks(allResults, effectiveQuery)) {
          const encoded = encodeURIComponent(effectiveQuery);
          const substitute = (tpl: string): string =>
            tpl.replace(/\{query\}/g, encoded).replace(/\{rawQuery\}/g, effectiveQuery);

          enabledFallbackCommands.forEach((cmd, idx) => {
            // Resolved URL/command after placeholder substitution.
            const resolvedTarget = substitute(cmd.target);
            const resolvedLabel = substitute(cmd.label);
            const fallbackId = `fallback-${cmd.id}-${searchId}`;
            // The `fallback` band sits below every real result; inside it the
            // user's configured order decides, so the preferred fallback is
            // selected first when nothing else matched.
            const fallbackScore = enabledFallbackCommands.length - idx;

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
                rank: bandRank('fallback', fallbackScore),
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
              rank: bandRank('fallback', fallbackScore),
            });
          });
        }

        setResultsPreserveSelection(allResults);

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
              setResultsPreserveSelection(
                mergeSearchResults(maxResults + 4, allResults, converted)
              );
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
        if (searchId !== latestSearchId.current) return;
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
      enabledFallbackCommands,
      finishSearch,
      iconByPath,
      includeFiles,
      includeGames,
      maxResults,
      rememberWebSearchHistory,
      searchSensitivity,
      searchLanguage,
      setResults,
      setResultsPreserveSelection,
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

    return () => {
      clearTimeout(timeoutId);
      latestSearchId.current += 1;
      if (activeChannelRef.current) {
        activeChannelRef.current.onmessage = () => {};
        activeChannelRef.current = null;
      }
      activeWebSearchRef.current?.abort();
      activeWebSearchRef.current = null;
      useSearchStore.getState().setIsSearching(false);
    };
  }, [searchQuery, performSearch, setResults, setSelectedIndex, setShowSnowEffect, suspended]);

  // Keep selected index in range when results change
  useEffect(() => {
    if (results.length > 0 && selectedIndex >= results.length) {
      setSelectedIndex(results.length - 1);
    }
  }, [results, selectedIndex, setSelectedIndex]);
}
