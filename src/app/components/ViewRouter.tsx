import { useDeferredValue } from 'react';
import { useTranslation } from 'react-i18next';
import { ChangelogView } from '../../features/changelog';
import { ClipboardHistoryView } from '../../features/clipboard';
import { CreateExtensionView, ManageExtensionsView } from '../../features/developer';
import { FileSearchView } from '../../features/files';
import {
  AiChatView,
  CalculatorView,
  EmojiPickerView,
  GameView,
  QuickAiView,
  TimerView,
} from '../../features/plugins/builtin';
import { ResultsList } from '../../features/results/components/ResultsList';
import { SuggestionsView } from '../../features/suggestions';
import { ErrorMessage, Spinner } from '../../shared/components/ui';
import { defaultSuggestions } from '../../shared/constants/suggestions';
import { SearchResult } from '../../shared/types/common.types';
import { useAppStore } from '../../stores/appStore';
import { useSearchStore } from '../../stores/searchStore';
import { useUiStore } from '../../stores/uiStore';

interface ViewRouterProps {
  onSelectEmoji: (emoji: string) => void;
  onLaunchResult: (result: SearchResult) => void;
  onActivateSuggestion: (categoryIndex: number, itemIndex: number) => Promise<void>;
}

export function ViewRouter({ onSelectEmoji, onLaunchResult, onActivateSuggestion }: ViewRouterProps) {
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

  switch (activeView.type) {
    case 'ai-chat':
      return (
        <AiChatView
          onClose={resetToSearchView}
          initialQuery={activeView.initialQuery}
          systemPrompt={activeView.systemPrompt}
        />
      );
    case 'quick-ai':
      return (
        <QuickAiView
          onClose={resetToSearchView}
          initialQuery={activeView.initialQuery}
          systemPrompt={activeView.systemPrompt}
        />
      );
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
    case 'timer':
      return <TimerView onClose={resetToSearchView} />;
    case 'create-extension':
      return <CreateExtensionView onClose={resetToSearchView} />;
    case 'manage-extensions':
      return (
        <ManageExtensionsView
          onClose={resetToSearchView}
          onCreateExtension={() => useUiStore.getState().setActiveView({ type: 'create-extension' })}
        />
      );
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
        onActivate={(catIndex, itemIndex) => { void onActivateSuggestion(catIndex, itemIndex); }}
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
      className="flex flex-col flex-1 min-h-0"
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
