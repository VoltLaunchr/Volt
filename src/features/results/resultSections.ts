import { type SearchResult, SearchResultType } from '../../shared/types/common.types';

export interface WebResultDetails {
  url?: string;
  query?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Extract the actionable fields from both the current PluginResultData wrapper
 * and a direct data object. Keeping this tolerant lets URL/fallback rows share
 * the same actions without assuming that every result owns a filesystem path.
 */
export function getWebResultDetails(result: SearchResult): WebResultDetails {
  const outer = asRecord(result.data);
  const nested = asRecord(outer?.data);
  const data = nested ?? outer;

  return {
    url: typeof data?.url === 'string' && data.url.trim() ? data.url : undefined,
    query: typeof data?.query === 'string' && data.query.trim() ? data.query : undefined,
  };
}

export function isWebResult(result: SearchResult): boolean {
  return result.type === SearchResultType.WebSearch || result.type === SearchResultType.Url;
}

/** Map a result to the launcher section that owns its presentation. */
export function getResultSectionKey(result: SearchResult): string {
  if (result.badge?.toLowerCase() === 'fallback') {
    return 'fallbacks';
  }

  switch (result.type) {
    case SearchResultType.Application:
      return 'applications';
    case SearchResultType.Game:
      return 'games';
    case SearchResultType.SystemCommand:
      return 'commands';
    case SearchResultType.File:
      return 'files';
    case SearchResultType.ShellCommand:
      return 'shell';
    case SearchResultType.SystemMonitor:
      // System monitor rows are direct answers ("CPU 42%"), not a list to
      // scan — surface them before the app list so they are visible without
      // scrolling when the user types a monitoring keyword.
      return 'system';
    case SearchResultType.WebSearch:
    case SearchResultType.Url:
      return 'web';
    default:
      return 'results';
  }
}

/** Preserve the score-ranked order established by the search pipeline. */
export function getSectionOrder(grouped: Map<string, unknown[]>): string[] {
  return [...grouped.keys()];
}
