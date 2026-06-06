import { lazy, Suspense, useDeferredValue } from 'react';
import { useTranslation } from 'react-i18next';
import { ResultsList } from '../../features/results/components/ResultsList';
import { SuggestionsView } from '../../features/suggestions';
import { ErrorMessage, Spinner } from '../../shared/components/ui';
import { defaultSuggestions } from '../../shared/constants/suggestions';
import { SearchResult } from '../../shared/types/common.types';
import { useAppStore } from '../../stores/appStore';
import { useSearchStore } from '../../stores/searchStore';
import { useUiStore } from '../../stores/uiStore';

// Heavy secondary views are loaded on demand to keep the boot bundle small —
// only the search/results/suggestions path above is eager. Each view is a
// named export, so we adapt it to the default-export shape that React.lazy
// expects. Importing the component file directly (not the feature barrel)
// avoids dragging the rest of the barrel into the boot graph.
const AiChatView = lazy(() =>
  import('../../features/plugins/builtin/ai-chat/components/AiChatView').then((m) => ({
    default: m.AiChatView,
  }))
);
const QuickAiView = lazy(() =>
  import('../../features/plugins/builtin/ai-chat/components/QuickAiView').then((m) => ({
    default: m.QuickAiView,
  }))
);
const CalculatorView = lazy(() =>
  import('../../features/plugins/builtin/calculator/components/CalculatorView').then((m) => ({
    default: m.CalculatorView,
  }))
);
const EmojiPickerView = lazy(() =>
  import('../../features/plugins/builtin/emoji-picker/components/EmojiPickerView').then((m) => ({
    default: m.EmojiPickerView,
  }))
);
const GameView = lazy(() =>
  import('../../features/plugins/builtin/games/components/GameView').then((m) => ({
    default: m.GameView,
  }))
);
const TimerView = lazy(() =>
  import('../../features/plugins/builtin/timer/TimerView').then((m) => ({
    default: m.TimerView,
  }))
);
const ClipboardHistoryView = lazy(() =>
  import('../../features/clipboard/components/ClipboardHistoryView').then((m) => ({
    default: m.ClipboardHistoryView,
  }))
);
const FileSearchView = lazy(() =>
  import('../../features/files/components/FileSearchView').then((m) => ({
    default: m.FileSearchView,
  }))
);
const ChangelogView = lazy(() =>
  import('../../features/changelog/components/ChangelogView').then((m) => ({
    default: m.ChangelogView,
  }))
);
const CreateExtensionView = lazy(() =>
  import('../../features/developer/components/CreateExtensionView').then((m) => ({
    default: m.CreateExtensionView,
  }))
);
const ManageExtensionsView = lazy(() =>
  import('../../features/developer/components/ManageExtensionsView').then((m) => ({
    default: m.ManageExtensionsView,
  }))
);

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

  // Lightweight fallback while a lazy view chunk is fetched. Reuses the shared
  // Spinner so there is no jarring flash between views.
  const viewFallback = (
    <div className="loading-container">
      <Spinner size="medium" />
    </div>
  );

  switch (activeView.type) {
    case 'ai-chat':
      return (
        <Suspense fallback={viewFallback}>
          <AiChatView
            onClose={resetToSearchView}
            initialQuery={activeView.initialQuery}
            systemPrompt={activeView.systemPrompt}
          />
        </Suspense>
      );
    case 'quick-ai':
      return (
        <Suspense fallback={viewFallback}>
          <QuickAiView
            onClose={resetToSearchView}
            initialQuery={activeView.initialQuery}
            systemPrompt={activeView.systemPrompt}
          />
        </Suspense>
      );
    case 'changelog':
      return (
        <Suspense fallback={viewFallback}>
          <ChangelogView onClose={resetToSearchView} />
        </Suspense>
      );
    case 'calculator':
      return (
        <Suspense fallback={viewFallback}>
          <CalculatorView onClose={resetToSearchView} />
        </Suspense>
      );
    case 'emoji':
      return (
        <Suspense fallback={viewFallback}>
          <EmojiPickerView
            onClose={resetToSearchView}
            onSelectEmoji={onSelectEmoji}
            initialQuery={activeView.initialQuery || ''}
          />
        </Suspense>
      );
    case 'clipboard':
      return (
        <Suspense fallback={viewFallback}>
          <ClipboardHistoryView onClose={resetToSearchView} />
        </Suspense>
      );
    case 'files':
      return (
        <Suspense fallback={viewFallback}>
          <FileSearchView onClose={resetToSearchView} />
        </Suspense>
      );
    case 'games':
      return (
        <Suspense fallback={viewFallback}>
          <GameView onClose={resetToSearchView} />
        </Suspense>
      );
    case 'timer':
      return (
        <Suspense fallback={viewFallback}>
          <TimerView onClose={resetToSearchView} />
        </Suspense>
      );
    case 'create-extension':
      return (
        <Suspense fallback={viewFallback}>
          <CreateExtensionView onClose={resetToSearchView} />
        </Suspense>
      );
    case 'manage-extensions':
      return (
        <Suspense fallback={viewFallback}>
          <ManageExtensionsView
            onClose={resetToSearchView}
            onCreateExtension={() =>
              useUiStore.getState().setActiveView({ type: 'create-extension' })
            }
          />
        </Suspense>
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
