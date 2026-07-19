import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchResult, SearchResultType } from '../../shared/types/common.types';
import { ResultContextMenu } from './ResultContextMenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const webResult: SearchResult = {
  id: 'web-result',
  type: SearchResultType.WebSearch,
  title: 'Search Volt',
  score: 10,
  data: {
    id: 'web-result',
    type: 'websearch',
    title: 'Search Volt',
    score: 10,
    data: {
      url: 'https://example.com/search?q=volt',
      query: 'volt',
    },
  },
};

describe('ResultContextMenu web actions', () => {
  it('replaces path and property actions with browser-specific actions', () => {
    render(
      <ResultContextMenu
        state={{
          isOpen: true,
          position: { x: 20, y: 20 },
          result: webResult,
        }}
        onLaunch={vi.fn()}
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
  });
});
