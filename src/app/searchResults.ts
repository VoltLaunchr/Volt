import { SearchResultType, type SearchResult } from '../shared/types/common.types';

function applicationIdentity(result: SearchResult): string | null {
  if (result.type !== SearchResultType.Application) return null;

  return result.title
    .trim()
    .replace(/[._-]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Sort all sources by score and collapse duplicate application entries. */
export function mergeSearchResults(
  maxResults: number,
  ...sources: SearchResult[][]
): SearchResult[] {
  const seenApplications = new Set<string>();

  return sources
    .flat()
    .sort((a, b) => b.score - a.score)
    .filter((result) => {
      const identity = applicationIdentity(result);
      if (identity === null) return true;
      if (seenApplications.has(identity)) return false;

      seenApplications.add(identity);
      return true;
    })
    .slice(0, maxResults);
}
