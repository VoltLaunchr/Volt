import { isWebResult } from '../features/results/resultSections';
import { SearchResultType, type SearchResult } from '../shared/types/common.types';
import { isPluginResultData } from '../shared/utils/typeGuards';

/**
 * Result types whose identity is derived from the query (or the clock) and can
 * never be selected again under the same id: computed answers, typed URLs, web
 * hits, shell commands, live metrics, AI prompts.
 */
const EPHEMERAL_RESULT_TYPES = new Set<SearchResultType>([
  SearchResultType.Calculator,
  SearchResultType.WebSearch,
  SearchResultType.Url,
  SearchResultType.Timer,
  SearchResultType.ShellCommand,
  SearchResultType.SystemMonitor,
  SearchResultType.AiChat,
]);

/**
 * Built-in plugins whose result ids are per-query: calculator/timer ids embed
 * `Date.now()`, shell ids embed the typed command, emoji ids embed the result
 * index, web search ids embed the engine/history position.
 */
const VOLATILE_PLUGIN_IDS = new Set<string>([
  'calculator',
  'timer',
  'shellcommand',
  'websearch',
  'emoji-picker',
  'systemmonitor',
]);

/** Ids minted per search by the pipeline itself (fallbacks, URL detection, web enrichment). */
const VOLATILE_ID_PREFIXES = ['fallback-', 'open-url-', 'web-result-'] as const;

/** A run of 12+ digits is a millisecond timestamp (`Date.now()`), i.e. a per-query id. */
const TIMESTAMP_LIKE = /\d{12,}/;

function pathOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('path' in data)) return null;
  const path = (data as { path: unknown }).path;
  return typeof path === 'string' && path.trim() ? path : null;
}

/**
 * Identity under which a selection is learned in `query_bindings.json`, or
 * `null` when the result has no identity that can match again on a later
 * search. Recording volatile ids only evicts useful bindings from the bounded
 * store (`QueryBindingStore`, 1000 prefixes).
 *
 * - Applications and files: their filesystem path (what the Rust ranker reads).
 * - Plugin results: `${pluginId}:${id}` when the plugin mints stable ids.
 * - Fallbacks, URL detection, web results, calculator and other ephemeral
 *   results: `null`.
 */
export function getStableResultIdentity(result: SearchResult): string | null {
  if (isWebResult(result) || result.badge?.toLowerCase() === 'fallback') return null;

  if (result.type === SearchResultType.Application || result.type === SearchResultType.File) {
    return pathOf(result.data);
  }

  if (EPHEMERAL_RESULT_TYPES.has(result.type)) return null;

  const id = result.id;
  if (!id || VOLATILE_ID_PREFIXES.some((prefix) => id.startsWith(prefix))) return null;
  if (TIMESTAMP_LIKE.test(id)) return null;

  const pluginResult = result.data;
  if (!isPluginResultData(pluginResult) || !pluginResult.pluginId) return null;
  if (VOLATILE_PLUGIN_IDS.has(pluginResult.pluginId)) return null;

  return `${pluginResult.pluginId}:${id}`;
}
