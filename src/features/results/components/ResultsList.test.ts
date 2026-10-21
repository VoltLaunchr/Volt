import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SearchResult, SearchResultType } from '../../../shared/types/common.types';
import { ResultsList } from './ResultsList';
import {
  getResultSectionKey,
  getSectionOrder,
  getWebResultDetails,
  isWebResult,
} from '../resultSections';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function result(type: SearchResultType, data: SearchResult['data'], badge?: string): SearchResult {
  return {
    id: `${type}-result`,
    type,
    title: type,
    score: 100,
    data,
    badge,
  };
}

describe('getSectionOrder', () => {
  it('keeps the order of the highest-ranked result in each section', () => {
    const grouped = new Map<string, unknown[]>([
      ['games', [{ score: 900 }]],
      ['applications', [{ score: 300 }, { score: 290 }]],
      ['results', [{ score: 200 }]],
    ]);

    expect(getSectionOrder(grouped)).toEqual(['games', 'applications', 'results']);
  });

  it('groups URL and web search rows separately from generic plugin results', () => {
    const urlResult = result(SearchResultType.Url, {} as SearchResult['data']);
    const webResult = result(SearchResultType.WebSearch, {} as SearchResult['data']);
    expect(getResultSectionKey(urlResult)).toBe('web');
    expect(getResultSectionKey(webResult)).toBe('web');
    expect(isWebResult(urlResult)).toBe(true);
    expect(isWebResult(webResult)).toBe(true);
  });

  it('groups every configured fallback together, including shell fallbacks', () => {
    expect(
      getResultSectionKey(
        result(SearchResultType.ShellCommand, {} as SearchResult['data'], 'Fallback')
      )
    ).toBe('fallbacks');
  });

  it('extracts URL and query fields from wrapped plugin result data', () => {
    const webResult = result(SearchResultType.WebSearch, {
      id: 'web',
      type: 'websearch',
      title: 'Search',
      score: 90,
      data: {
        url: 'https://example.com/search?q=volt',
        query: 'volt',
      },
    });

    expect(getWebResultDetails(webResult)).toEqual({
      url: 'https://example.com/search?q=volt',
      query: 'volt',
    });
  });
});

describe('ResultsList ordering', () => {
  it('keeps visual rows aligned with canonical keyboard indices across sections', () => {
    const results = [
      {
        ...result(SearchResultType.Application, {} as SearchResult['data']),
        id: 'app-a',
        title: 'App A',
      },
      {
        ...result(SearchResultType.WebSearch, {} as SearchResult['data']),
        id: 'web',
        title: 'Web result',
      },
      {
        ...result(SearchResultType.Application, {} as SearchResult['data']),
        id: 'app-b',
        title: 'App B',
      },
    ];

    render(
      createElement(ResultsList, {
        results,
        selectedIndex: 1,
        onSelect: () => undefined,
        onLaunch: () => undefined,
      })
    );

    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.getAttribute('aria-label'))).toEqual([
      'App A',
      'Web result',
      'App B',
    ]);
    expect(options[1]).toHaveAttribute('id', 'result-item-1');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
  });
});
