import { useDeferredValue } from 'react';
import { useTranslation } from 'react-i18next';
import { ChangelogView } from '../../features/changelog';
import { ClipboardHistoryView } from '../../features/clipboard';
import { FileSearchView } from '../../features/files';
import {
  CalculatorView,
  EmojiPickerView,
  GameView,
} from '../../features/plugins/builtin';
import { ResultsList } from '../../features/results/components/ResultsList';
import { SuggestionsView } from '../../features/suggestions';
import { ErrorMessage, Spinner } from '../../shared/components/ui';
import { defaultSuggestions } from '../../shared/constants/suggestions';
import { SearchResult } from '../../shared/types/common.types';
import { logger } from '../../shared/utils/logger';
import { useAppStore } from '../../stores/appStore';
import { useSearchStore } from '../../stores/searchStore';
import { useUiStore } from '../../stores/uiStore';
import { openSettingsWindow } from '../utils';

interface ViewRouterProps {
  onSelectEmoji: (emoji: string) => void;
  onLaunchResult: (result: SearchResult) => void;
}

export function ViewRouter({ onSelectEmoji, onLaunchResult }: ViewRouterProps) {
  const { t } = useTranslation('common');
  const activeView = useUiStore((s) => s.activeView);
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const results = useSearchStore((s) => s.results);
  const deferredResults = useDeferredValue(results);
  const isResultsStale = deferredResults !== results;
  const selectedIndex = useSearchStore((s) => s.selectedIndex);
  const isLoading = useAppStore((s) => s.isLoading);
  const searchError = useSearchStore((s) => s.searchError);
  const appError = useAppStore((s) => s.appError);

  const error = appError || searchError;

  const resetToSearchView = () => {
    useSearchStore.getState().clearSearch();
    useUiStore.getState().setActiveView({ type: 'search' });
  };

  const clearError = () => {
    useAppStore.getState().setAppError(null);
    useSearchStore.getState().setSearchError(null);
  };

  const handleSuggestionSelect = (categoryIndex: number, itemIndex: number) => {
    let globalIndex = 0;
    for (let i = 0; i < categoryIndex; i++) {
      globalIndex += defaultSuggestions[i].items.length;
    }
    useSearchStore.getState().setSelectedIndex(globalIndex + itemIndex);
  };

  const handleSuggestionActivate = async (categoryIndex: number, itemIndex: number) => {
    const category = defaultSuggestions[categoryIndex];
    const item = category.items[itemIndex];
    const { setQuery } = useSearchStore.getState();
    const { setActiveView } = useUiStore.getState();

    switch (item.id) {
      case 'whats-new':
        setActiveView({ type: 'changelog' });
        break;
      case 'settings':
      case 'account':
        await openSettingsWindow();
        break;
      case 'about':
        try {
          const { openUrl } = await import('@tauri-apps/plugin-opener');
          await openUrl('https://voltlaunchr.com');
        } catch (err) {
          logger.error('Failed to open website:', err);
          window.open('https://voltlaunchr.com', '_blank');
        }
        break;
      case 'clipboard-history':
        setActiveView({ type: 'clipboard' });
        break;
      case 'search-emoji':
        setQuery(':');
        break;
      case 'search-files':
        setActiveView({ type: 'files' });
        break;
      case 'system-monitor':
        setQuery('system ');
        break;
      case 'calculator':
        setActiveView({ type: 'calculator' });
        break;
      case 'timer':
        setQuery('timer ');
        break;
      case 'web-search':
        setQuery('? ');
        break;
      case 'steam-games':
        setActiveView({ type: 'games' });
        break;
      default:
        console.log('Unknown suggestion:', item.id);
    }
  };

  switch (activeView.type) {
    case 'changelog':
      return <ChangelogView onClose={resetToSearchView} />;
    case 'calculator':
      return <CalculatorView onClose={resetToSearchView} />;
    case 'emoji':
      return (
        <EmojiPickerView
          onClose={resetToSearchView}
          onSelectEmoji={onSelectEmoji}
          initialQuery={activeView.initialQuery || ''}
        />
      );
    case 'clipboard':
      return <ClipboardHistoryView onClose={resetToSearchView} />;
    case 'files':
      return <FileSearchView onClose={resetToSearchView} />;
    case 'games':
      return <GameView onClose={resetToSearchView} />;
  }

  if (error) {
    return (
      <div className="error-container">
        <ErrorMessage
          message={error}
          title={t('viewRouter.error')}
          variant="inline"
          onRetry={clearError}
          onDismiss={clearError}
        />
      </div>
    );
  }

  if (!searchQuery.trim() && deferredResults.length === 0) {
    return (
      <SuggestionsView
        suggestions={defaultSuggestions}
        selectedIndex={selectedIndex}
        onSelect={handleSuggestionSelect}
        onActivate={handleSuggestionActivate}
      />
    );
  }

  if (isLoading && searchQuery.trim() && deferredResults.length === 0) {
    return (
      <div className="loading-container">
        <Spinner size="medium" message={t('viewRouter.loading')} />
      </div>
    );
  }

  return (
    <div
      style={{
        opacity: isResultsStale ? 0.7 : 1,
        transition: 'opacity 100ms ease-out',
      }}
    >
      <ResultsList
        results={deferredResults}
        selectedIndex={selectedIndex}
        onSelect={(index: number) => useSearchStore.getState().setSelectedIndex(index)}
        onLaunch={onLaunchResult}
      />
    </div>
  );
}
