import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchResult, SearchResultType } from '../../shared/types/common.types';
import { ActionsMenu } from './ActionsMenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

function webResult(type = SearchResultType.WebSearch): SearchResult {
  return {
    id: 'web-result',
    type,
    title: 'Search Volt',
    score: 10,
    data: {
      id: 'web-result',
      type: 'websearch',
      title: 'Search Volt',
      score: 10,
      data: {
        url: 'https://example.com/search?q=volt',
        query: type === SearchResultType.WebSearch ? 'volt' : undefined,
      },
    },
  };
}

describe('ActionsMenu web actions', () => {
  it('offers browser actions without filesystem actions for web searches', () => {
    const onLaunch = vi.fn();

    render(
      <ActionsMenu
        isOpen
        result={webResult()}
        onLaunch={onLaunch}
        onShowProperties={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Open in Browser')).toBeInTheDocument();
    expect(screen.getByText('Copy URL')).toBeInTheDocument();
    expect(screen.getByText('Copy Search Query')).toBeInTheDocument();
    expect(screen.queryByText('contextMenu.openFolder')).not.toBeInTheDocument();
    expect(screen.queryByText('contextMenu.copyPath')).not.toBeInTheDocument();
    expect(screen.queryByText('contextMenu.properties')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Open in Browser'));
    expect(onLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ type: SearchResultType.WebSearch })
    );
  });

  it('does not expose a query action for a direct URL', () => {
    render(
      <ActionsMenu
        isOpen
        result={webResult(SearchResultType.Url)}
        onLaunch={vi.fn()}
        onShowProperties={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Copy URL')).toBeInTheDocument();
    expect(screen.queryByText('Copy Search Query')).not.toBeInTheDocument();
  });
});
