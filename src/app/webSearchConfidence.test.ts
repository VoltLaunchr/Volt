import { describe, expect, it } from 'vitest';
import { SearchResult, SearchResultType, type FileCategory } from '../shared/types/common.types';
import { hasStrongLocalMatch, shouldShowWebFallbacks } from './webSearchConfidence';

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: 'result',
    type: SearchResultType.Application,
    title: 'Result',
    score: 1,
    data: { id: 'result', name: 'Result', path: 'result.exe', usageCount: 0 },
    ...overrides,
  };
}

describe('web fallback confidence', () => {
  it('keeps fallbacks visible for a secondary application match', () => {
    const results = [result({ score: 699 })];
    expect(hasStrongLocalMatch(results, 'unrelated query')).toBe(false);
    expect(shouldShowWebFallbacks(results, 'unrelated query')).toBe(true);
  });

  it('suppresses fallbacks for an application name-tier match', () => {
    const results = [result({ score: 700 })];
    expect(hasStrongLocalMatch(results, 'result')).toBe(true);
    expect(shouldShowWebFallbacks(results, 'result')).toBe(false);
  });

  it('treats an exact or extension-suffixed file title as strong', () => {
    const results = [
      result({
        type: SearchResultType.File,
        title: 'quarterly-report.pdf',
        score: 200,
        data: {
          id: 'file',
          name: 'quarterly-report.pdf',
          path: 'C:\\quarterly-report.pdf',
          size: 1,
          modified: 0,
          created: 0,
          accessed: 0,
          extension: 'pdf',
          category: 'other' as FileCategory,
        },
      }),
    ];
    expect(hasStrongLocalMatch(results, 'quarterly-report')).toBe(true);
  });

  it('never lets an existing web row suppress other configured web fallbacks', () => {
    const results = [
      result({
        type: SearchResultType.WebSearch,
        title: 'Search the web',
        score: 999,
        data: {
          id: 'web',
          type: 'websearch',
          title: 'Search the web',
          score: 999,
        },
      }),
    ];
    expect(shouldShowWebFallbacks(results, 'research topic')).toBe(true);
  });

  it('requires at least two non-whitespace characters', () => {
    expect(shouldShowWebFallbacks([], ' a ')).toBe(false);
  });
});
