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
import type { ActiveView } from '../../stores/uiStore';

interface ViewRouterProps {
  activeView: ActiveView;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  results: SearchResult[];
  selectedIndex: number;
  onResetView: () => void;
  onSelectEmoji: (emoji: string) => void;
  onRetry: () => void;
  onClearError: () => void;
  onSelectResult: (index: number) => void;
  onLaunchResult: (result: SearchResult) => void;
  onSuggestionSelect: (categoryIndex: number, itemIndex: number) => void;
  onSuggestionActivate: (categoryIndex: number, itemIndex: number) => Promise<void>;
}

export function ViewRouter({
  activeView,
  isLoading,
  error,
  searchQuery,
  results,
  selectedIndex,
  onResetView,
  onSelectEmoji,
  onRetry,
  onClearError,
  onSelectResult,
  onLaunchResult,
  onSuggestionSelect,
  onSuggestionActivate,
}: ViewRouterProps) {
  switch (activeView.type) {
    case 'changelog':
      return <ChangelogView onClose={onResetView} />;
    case 'calculator':
      return <CalculatorView onClose={onResetView} />;
    case 'emoji':
      return (
        <EmojiPickerView
          onClose={onResetView}
          onSelectEmoji={onSelectEmoji}
          initialQuery={activeView.initialQuery || ''}
        />
      );
    case 'clipboard':
      return <ClipboardHistoryView onClose={onResetView} />;
    case 'files':
      return <FileSearchView onClose={onResetView} />;
    case 'games':
      return <GameView onClose={onResetView} />;
  }

  if (isLoading) {
    return (
      <div className="loading-container">
        <Spinner size="medium" message="Loading applications..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <ErrorMessage
          message={error}
          title="Error"
          variant="inline"
          onRetry={onRetry}
          onDismiss={onClearError}
        />
      </div>
    );
  }

  if (!searchQuery.trim() && results.length === 0) {
    return (
      <SuggestionsView
        suggestions={defaultSuggestions}
        selectedIndex={selectedIndex}
        onSelect={onSuggestionSelect}
        onActivate={onSuggestionActivate}
      />
    );
  }

  return (
    <ResultsList
      results={results}
      selectedIndex={selectedIndex}
      onSelect={onSelectResult}
      onLaunch={onLaunchResult}
    />
  );
}
