import { describe, expect, it } from 'vitest';
import { SearchResultType, type AppInfo, type SearchResult } from '../shared/types/common.types';
import { mergeSearchResults } from './searchResults';

function applicationResult(id: string, title: string, score: number): SearchResult {
  const app: AppInfo = {
    id,
    name: title,
    path: `C:\\Apps\\${id}.exe`,
    usageCount: 0,
  };

  return {
    id,
    type: SearchResultType.Application,
    title,
    score,
    data: app,
  };
}

describe('mergeSearchResults', () => {
  it('keeps only the highest-scored application for a normalized name', () => {
    const results = mergeSearchResults(
      10,
      [applicationResult('shortcut-skate', 'Skate', 250)],
      [applicationResult('registry-skate', '  skate.  ', 280)]
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('registry-skate');
  });

  it('does not collapse non-application results that share a title', () => {
    const pluginResults: SearchResult[] = [
      {
        id: 'plugin-a',
        type: SearchResultType.Plugin,
        title: 'Same title',
        score: 100,
        data: { id: 'plugin-a', type: 'info', title: 'Same title', score: 100 },
      },
      {
        id: 'plugin-b',
        type: SearchResultType.Plugin,
        title: 'Same title',
        score: 90,
        data: { id: 'plugin-b', type: 'info', title: 'Same title', score: 90 },
      },
    ];

    expect(mergeSearchResults(10, pluginResults)).toHaveLength(2);
  });
});
