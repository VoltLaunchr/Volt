import { useCallback, useEffect } from 'react';
import Snowfall from 'react-snowfall';
import { TimerDisplay } from '../features/plugins/builtin';
import { SearchBar } from '../features/search/components/SearchBar';
import { useWindowState } from '../features/window';
import { Footer } from '../shared/components/layout';
import { HelpDialog, PropertiesDialog } from '../shared/components/ui';
import { defaultSuggestions } from '../shared/constants/suggestions';
import { SearchResult } from '../shared/types/common.types';
import { useAppStore } from '../stores/appStore';
import { useSearchStore } from '../stores/searchStore';
import { useUiStore } from '../stores/uiStore';
import { ResultContextMenu } from './components/ResultContextMenu';
import { ViewRouter } from './components/ViewRouter';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { useGlobalHotkey } from './hooks/useGlobalHotkey';
import { useResultActions } from './hooks/useResultActions';
import { useSearchPipeline } from './hooks/useSearchPipeline';
import { openSettingsWindow } from './utils';
import './App.css';

function App() {
  const { allApps, isLoading, appError, refreshApps, clearAppError } = useAppLifecycle();
  const { hide: hideWindow, startDragging } = useWindowState();

  // App store
  const settings = useAppStore((s) => s.settings);
  const isIndexing = useAppStore((s) => s.isIndexing);

  // Search store
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const results = useSearchStore((s) => s.results);
  const selectedIndex = useSearchStore((s) => s.selectedIndex);
  const searchError = useSearchStore((s) => s.searchError);
  const showSnowEffect = useSearchStore((s) => s.showSnowEffect);
  const { setQuery, setResults, setSelectedIndex, setSearchError, clearSearch } =
    useSearchStore.getState();

  // UI store
  const activeView = useUiStore((s) => s.activeView);
  const contextMenu = useUiStore((s) => s.contextMenu);
  const isPropertiesOpen = useUiStore((s) => s.isPropertiesOpen);
  const propertiesResult = useUiStore((s) => s.propertiesResult);
  const isHelpOpen = useUiStore((s) => s.isHelpOpen);
  const { setActiveView, closeContextMenu, openProperties, closeProperties, toggleHelp } =
    useUiStore.getState();

  useSearchPipeline({
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
  }, [searchQuery, activeView.type, setActiveView]);

  const { handleLaunch, handleSuggestionActivate } = useResultActions({
    closeOnLaunch,
    hideWindow,
    openSettingsWindow,
    setSearchQuery: setQuery,
    setResults,
    setSearchError,
    setActiveView,
  });

  const handleSuggestionSelect = useCallback(
    (categoryIndex: number, itemIndex: number) => {
      let globalIndex = 0;
      for (let i = 0; i < categoryIndex; i++) {
        globalIndex += defaultSuggestions[i].items.length;
      }
      setSelectedIndex(globalIndex + itemIndex);
    },
    [setSelectedIndex]
  );

  const handleShowProperties = useCallback(
    (result: SearchResult) => {
      openProperties(result);
    },
    [openProperties]
  );

  const handleOpenHelp = useCallback(() => {
    toggleHelp();
  }, [toggleHelp]);

  const resetToSearchView = useCallback(() => {
    setActiveView({ type: 'search' });
    clearSearch();
  }, [setActiveView, clearSearch]);

  const handleOpenCalculatorView = useCallback(() => {
    setActiveView({ type: 'calculator' });
    clearSearch();
  }, [setActiveView, clearSearch]);

  const { handleKeyDown } = useGlobalHotkey({
    results,
    selectedIndex,
    setSelectedIndex,
    searchQuery,
    setSearchQuery: setQuery,
    setResults,
    closeOnLaunch,
    hideWindow,
    onLaunch: handleLaunch,
    onActivateSuggestion: handleSuggestionActivate,
    onShowProperties: handleShowProperties,
    onOpenSettings: openSettingsWindow,
    onOpenCalculator: handleOpenCalculatorView,
    onOpenHelp: handleOpenHelp,
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
            onChange={setQuery}
            onKeyDown={handleKeyDown}
            placeholder={isLoading ? 'Loading applications...' : 'Search for apps and commands...'}
            resultCount={results.length}
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
          <Footer isIndexing={isIndexing} />
        </>
      )}

      <ResultContextMenu
        state={contextMenu}
        onLaunch={handleLaunch}
        onShowProperties={handleShowProperties}
        onClose={closeContextMenu}
      />

      <PropertiesDialog
        isOpen={isPropertiesOpen}
        onClose={closeProperties}
        result={propertiesResult}
      />

      <HelpDialog isOpen={isHelpOpen} onClose={toggleHelp} />

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
