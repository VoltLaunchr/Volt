import {
  SearchResult,
  SearchResultType,
  type PluginResultData,
} from '../shared/types/common.types';
import { isTierAtLeast } from './searchRanking';

/**
 * An application matched on its alias, a learned query or its name (exact,
 * prefix or fuzzy) is a confident local answer. A `secondary` match (install
 * path / keywords only) should not suppress useful web fallbacks on its own.
 */
function hasStrongApplicationTier(result: SearchResult): boolean {
  return result.rank !== undefined && isTierAtLeast(result.rank.tier, 'fuzzy');
}

const INTENTIONAL_RESULT_TYPES = new Set<SearchResultType>([
  SearchResultType.Calculator,
  SearchResultType.SystemCommand,
  SearchResultType.Timer,
  SearchResultType.SystemMonitor,
  SearchResultType.Game,
  SearchResultType.ShellCommand,
  SearchResultType.AiChat,
]);

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function hasStrongFileTitleMatch(result: SearchResult, query: string): boolean {
  const title = normalized(result.title);
  const needle = normalized(query);
  return title === needle || title.startsWith(`${needle}.`) || title.startsWith(`${needle} `);
}

function hasExplicitPluginActivation(result: SearchResult): boolean {
  const pluginResult = result.data as PluginResultData;
  return pluginResult?.matchKind === 'prefix' || pluginResult?.matchKind === 'keyword';
}

export function hasStrongLocalMatch(results: SearchResult[], query: string): boolean {
  return results.some((result) => {
    switch (result.type) {
      case SearchResultType.WebSearch:
      case SearchResultType.Url:
        return false;
      case SearchResultType.Application:
        return hasStrongApplicationTier(result);
      case SearchResultType.File:
        return hasStrongFileTitleMatch(result, query);
      case SearchResultType.Plugin:
      case SearchResultType.Command:
        return hasExplicitPluginActivation(result);
      default:
        return INTENTIONAL_RESULT_TYPES.has(result.type);
    }
  });
}

export function shouldShowWebFallbacks(results: SearchResult[], query: string): boolean {
  return normalized(query).length >= 2 && !hasStrongLocalMatch(results, query);
}
