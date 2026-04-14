import { useCallback, useEffect } from 'react';
import Snowfall from 'react-snowfall';
import { useTranslation } from 'react-i18next';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { TimerDisplay } from '../features/plugins/builtin';
import { SearchBar } from '../features/search/components/SearchBar';
import { useWindowState } from '../features/window';
import { Footer } from '../shared/components/layout';
import { HelpDialog, OnboardingModal, PreviewPanel, PropertiesDialog, ToastContainer } from '../shared/components/ui';
import { settingsService } from '../features/settings';
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
import i18n from '../i18n';
import '../styles/accessibility.css';
import './App.css';

const WINDOW_WIDTH_DEFAULT = 800;
const WINDOW_WIDTH_PREVIEW = 1100;
const WINDOW_HEIGHT = 550;

function App() {
  useAppLifecycle();
  const { hide: hideWindow, startDragging } = useWindowState();
  const { t } = useTranslation('common');

  // App store
  const settings = useAppStore((s) => s.settings);
  const isIndexing = useAppStore((s) => s.isIndexing);

  // Search store
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const results = useSearchStore((s) => s.results);
  const showSnowEffect = useSearchStore((s) => s.showSnowEffect);
  const { setQuery, clearSearch } = useSearchStore.getState();

  // UI store
  const activeView = useUiStore((s) => s.activeView);
  const contextMenu = useUiStore((s) => s.contextMenu);
  const isPropertiesOpen = useUiStore((s) => s.isPropertiesOpen);
  const propertiesResult = useUiStore((s) => s.propertiesResult);
  const isHelpOpen = useUiStore((s) => s.isHelpOpen);
  const isPreviewOpen = useUiStore((s) => s.isPreviewOpen);
  const { setActiveView, closeContextMenu, openProperties, closeProperties, toggleHelp, togglePreview } =
    useUiStore.getState();

  // Get selected result for preview panel
  const selectedIndex = useSearchStore((s) => s.selectedIndex);
  const selectedResult = results[selectedIndex] ?? null;

  // Resize window when preview panel opens/closes
  useEffect(() => {
    const width = isPreviewOpen ? WINDOW_WIDTH_PREVIEW : WINDOW_WIDTH_DEFAULT;
    getCurrentWindow()
      .setSize(new LogicalSize(width, WINDOW_HEIGHT))
      .catch(() => {});
  }, [isPreviewOpen]);

  useSearchPipeline({
    maxResults: settings?.general.maxResults ?? 8,
    suspended: activeView.type !== 'search',
  });

  const closeOnLaunch = settings?.general.closeOnLaunch !== false;

  // Switch to emoji picker when query starts with `:`
  useEffect(() => {
    if (searchQuery.startsWith(':')) {
      setActiveView({ type: 'emoji', initialQuery: searchQuery.substring(1) });
    } else if (activeView.type === 'emoji' && !searchQuery.startsWith(':')) {
      setActiveView({ type: 'search' });
    }
  }, [searchQuery, activeView.type, setActiveView]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ language: string }>('volt://language-changed', ({ payload }) => {
      i18n.changeLanguage(payload.language);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const { handleLaunch, handleSuggestionActivate } = useResultActions({
    closeOnLaunch,
    hideWindow,
    openSettingsWindow,
  });

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
    closeOnLaunch,
    hideWindow,
    onLaunch: handleLaunch,
    onActivateSuggestion: handleSuggestionActivate,
    onShowProperties: handleShowProperties,
    onOpenSettings: openSettingsWindow,
    onOpenCalculator: handleOpenCalculatorView,
    onOpenHelp: handleOpenHelp,
    onTogglePreview: togglePreview,
  });

  const handleOnboardingComplete = useCallback(async () => {
    if (!settings) return;
    const updated = {
      ...settings,
      general: { ...settings.general, hasSeenOnboarding: true },
    };
    await settingsService.updateGeneralSettings(updated.general).catch(() => {});
    useAppStore.getState().setSettings(updated);
  }, [settings]);

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
      <a href="#search-input" className="skip-link">
        {t('accessibility.skipToSearch')}
      </a>
      {activeView.type === 'search' && (
        <>
          <div className="drag-region" onMouseDown={startDragging}>
            <div className="drag-handle"></div>
          </div>
          <SearchBar
            value={searchQuery}
            onChange={setQuery}
            onKeyDown={handleKeyDown}
            placeholder={t('search.placeholder')}
            resultCount={results.length}
          />
        </>
      )}

      <div className={`search-content${isPreviewOpen ? ' with-preview' : ''}`}>
        <ViewRouter
          onSelectEmoji={handleSelectEmoji}
          onLaunchResult={handleLaunch}
        />
        <PreviewPanel result={selectedResult} isOpen={isPreviewOpen} />
      </div>

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

      <ToastContainer />

      {settings && !settings.general.hasSeenOnboarding && (
        <OnboardingModal isOpen={true} onComplete={handleOnboardingComplete} />
      )}

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
