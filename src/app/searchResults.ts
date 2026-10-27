import { SearchResultType, type SearchResult } from '../shared/types/common.types';
import { compareResults } from './searchRanking';

function applicationIdentity(result: SearchResult): string | null {
  if (result.type !== SearchResultType.Application) return null;

  return result.title
    .trim()
    .replace(/[._-]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Order all sources with the unified comparator (`compareResults`) and
 * collapse duplicate application entries.
 */
export function mergeSearchResults(
  maxResults: number,
  ...sources: SearchResult[][]
): SearchResult[] {
  const seenApplications = new Set<string>();

  return sources
    .flat()
    .sort(compareResults)
    .filter((result) => {
      const identity = applicationIdentity(result);
      if (identity === null) return true;
      if (seenApplications.has(identity)) return false;

      seenApplications.add(identity);
      return true;
    })
    .slice(0, maxResults);
}
