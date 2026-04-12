import { useCallback, useEffect, useState } from 'react';
import Snowfall from 'react-snowfall';
import { TimerDisplay } from '../features/plugins/builtin';
import { SearchBar } from '../features/search/components/SearchBar';
import { useWindowState } from '../features/window';
import { Footer } from '../shared/components/layout';
import { PropertiesDialog } from '../shared/components/ui';
import { defaultSuggestions } from '../shared/constants/suggestions';
import { SearchResult } from '../shared/types/common.types';
import { ResultContextMenu, type ContextMenuState } from './components/ResultContextMenu';
import { ViewRouter } from './components/ViewRouter';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { useGlobalHotkey } from './hooks/useGlobalHotkey';
import { useResultActions, type ActiveView } from './hooks/useResultActions';
import { useSearchPipeline } from './hooks/useSearchPipeline';
import { openSettingsWindow } from './utils';
import './App.css';

function App() {
  const { allApps, isLoading, appError, refreshApps, clearAppError, settings } = useAppLifecycle();
  const { hide: hideWindow, startDragging } = useWindowState();

  const [activeView, setActiveView] = useState<ActiveView>({ type: 'search' });
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    result: null,
  });
  const [isPropertiesOpen, setIsPropertiesOpen] = useState(false);
  const [propertiesResult, setPropertiesResult] = useState<SearchResult | null>(null);

  const {
    searchQuery,
    setSearchQuery,
    results,
    setResults,
    selectedIndex,
    setSelectedIndex,
    searchError,
    setSearchError,
    showSnowEffect,
  } = useSearchPipeline({
    allApps,
    isLoading,
    maxResults: settings?.general.maxResults ?? 8,
    suspended: activeView.type !== 'search',
  });

  const error = appError || searchError;
  const closeOnLaunch = settings?.general.closeOnLaunch !== false;

  const clearError = useCallback(() => {
    clearAppError();
    setSearchError(null);
  }, [clearAppError, setSearchError]);

  // Switch to emoji picker when query starts with `:`
  useEffect(() => {
    if (searchQuery.startsWith(':')) {
      setActiveView({ type: 'emoji', initialQuery: searchQuery.substring(1) });
    } else if (activeView.type === 'emoji' && !searchQuery.startsWith(':')) {
      setActiveView({ type: 'search' });
    }
  }, [searchQuery, activeView.type]);

  const { handleLaunch, handleSuggestionActivate } = useResultActions({
    closeOnLaunch,
    hideWindow,
    openSettingsWindow,
    setSearchQuery,
    setResults,
    setSearchError,
    setActiveView,
  });

  const handleSuggestionSelect = useCallback((categoryIndex: number, itemIndex: number) => {
    let globalIndex = 0;
    for (let i = 0; i < categoryIndex; i++) {
      globalIndex += defaultSuggestions[i].items.length;
    }
    setSelectedIndex(globalIndex + itemIndex);
  }, [setSelectedIndex]);

  const handleShowProperties = useCallback((result: SearchResult) => {
    setPropertiesResult(result);
    setIsPropertiesOpen(true);
  }, []);

  const resetToSearchView = useCallback(() => {
    setActiveView({ type: 'search' });
    setSearchQuery('');
    setResults([]);
  }, [setSearchQuery, setResults]);

  const handleOpenCalculatorView = useCallback(() => {
    setActiveView({ type: 'calculator' });
    setSearchQuery('');
    setResults([]);
  }, [setSearchQuery, setResults]);

  const { handleKeyDown } = useGlobalHotkey({
    results,
    selectedIndex,
    setSelectedIndex,
    searchQuery,
    setSearchQuery,
    setResults,
    closeOnLaunch,
    hideWindow,
    onLaunch: handleLaunch,
    onActivateSuggestion: handleSuggestionActivate,
    onShowProperties: handleShowProperties,
    onOpenSettings: openSettingsWindow,
    onOpenCalculator: handleOpenCalculatorView,
  });

  const handleRetry = useCallback(async () => {
    clearError();
    await refreshApps();
  }, [clearError, refreshApps]);

  const handleSelectEmoji = useCallback(
    async (emoji: string) => {
      await navigator.clipboard.writeText(emoji).catch(() => {});
      resetToSearchView();
      if (closeOnLaunch) await hideWindow();
    },
    [closeOnLaunch, hideWindow, resetToSearchView]
  );

  return (
    <div className="app-container glass">
      {activeView.type === 'search' && (
        <>
          <div className="drag-region" onMouseDown={startDragging}>
            <div className="drag-handle"></div>
          </div>
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            onKeyDown={handleKeyDown}
            placeholder={isLoading ? 'Loading applications...' : 'Search for apps and commands...'}
          />
        </>
      )}

      <ViewRouter
        activeView={activeView}
        isLoading={isLoading}
        error={error}
        searchQuery={searchQuery}
        results={results}
        selectedIndex={selectedIndex}
        onResetView={resetToSearchView}
        onSelectEmoji={handleSelectEmoji}
        onRetry={handleRetry}
        onClearError={clearError}
        onSelectResult={setSelectedIndex}
        onLaunchResult={handleLaunch}
        onSuggestionSelect={handleSuggestionSelect}
        onSuggestionActivate={handleSuggestionActivate}
      />

      {activeView.type === 'search' && (
        <>
          <TimerDisplay />
          <Footer />
        </>
      )}

      <ResultContextMenu
        state={contextMenu}
        onLaunch={handleLaunch}
        onShowProperties={handleShowProperties}
        onClose={() =>
          setContextMenu({ isOpen: false, position: { x: 0, y: 0 }, result: null })
        }
      />

      <PropertiesDialog
        isOpen={isPropertiesOpen}
        onClose={() => setIsPropertiesOpen(false)}
        result={propertiesResult}
      />

      {showSnowEffect && (
        <Snowfall
          color="#dee4fd"
          snowflakeCount={200}
          style={{ position: 'fixed', width: '100vw', height: '100vh', zIndex: 9999 }}
        />
      )}
    </div>
  );
}

export default App;
