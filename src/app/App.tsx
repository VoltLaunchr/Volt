import { useCallback, useEffect, useRef } from 'react';
import Snowfall from 'react-snowfall';
import { useTranslation } from 'react-i18next';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { TimerDisplay } from '../features/plugins/builtin';
import { PermissionDialog } from '../features/extensions/components/PermissionDialog';
import { SearchBar } from '../features/search/components/SearchBar';
import { useWindowState } from '../features/window';
import { Footer } from '../shared/components/layout';
import { HelpDialog, PreviewPanel, PropertiesDialog, ToastContainer } from '../shared/components/ui';
import { SearchResult } from '../shared/types/common.types';
import { useAppStore } from '../stores/appStore';
import { useSearchStore } from '../stores/searchStore';
import { useUiStore } from '../stores/uiStore';
import { ActionsMenu } from './components/ActionsMenu';
import { ResultContextMenu } from './components/ResultContextMenu';
import { ViewRouter } from './components/ViewRouter';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { useGlobalHotkey } from './hooks/useGlobalHotkey';
import { useResultActions } from './hooks/useResultActions';
import { useSearchPipeline } from './hooks/useSearchPipeline';
import { openSettingsWindow } from './utils';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { installPendingUpdate, hasPendingUpdate } from '../features/settings/services/updateService';
import i18n from '../i18n';

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
  const permissionRequest = useUiStore((s) => s.permissionRequest);
  const isActionsMenuOpen = useUiStore((s) => s.isActionsMenuOpen);
  const actionsMenuResult = useUiStore((s) => s.actionsMenuResult);
  const { setActiveView, closeContextMenu, openProperties, closeProperties, toggleHelp, togglePreview, openActionsMenu, closeActionsMenu, setPermissionRequest } =
    useUiStore.getState();

  // Get selected result for preview panel
  const selectedIndex = useSearchStore((s) => s.selectedIndex);
  const selectedResult = results[selectedIndex] ?? null;

  // Resize window when preview panel opens/closes (skip while onboarding is active)
  const hasSeenOnboarding = settings?.general.hasSeenOnboarding ?? false;
  useEffect(() => {
    if (!hasSeenOnboarding) return; // OnboardingModal owns the window size
    const width = isPreviewOpen ? WINDOW_WIDTH_PREVIEW : WINDOW_WIDTH_DEFAULT;
    getCurrentWindow()
      .setSize(new LogicalSize(width, WINDOW_HEIGHT))
      .catch(() => {});
  }, [isPreviewOpen, hasSeenOnboarding]);

  useSearchPipeline({
    maxResults: settings?.general.maxResults ?? 8,
    suspended: activeView.type !== 'search',
  });

  const closeOnLaunch = settings?.general.closeOnLaunch !== false;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ language: string }>('volt://language-changed', ({ payload }) => {
      void i18n.changeLanguage(payload.language);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen('volt://restart-onboarding', () => {
      const current = useAppStore.getState().settings;
      if (current) {
        useAppStore.getState().setSettings({
          ...current,
          general: { ...current.general, hasSeenOnboarding: false },
        });
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // Open the dedicated onboarding window for first-time users (or after restart-onboarding).
  // The window is pre-configured at 1300×800 in tauri.conf.json — no JS resize needed.
  const rawHasSeenOnboarding = settings?.general.hasSeenOnboarding;
  useEffect(() => {
    if (rawHasSeenOnboarding !== false) return;
    WebviewWindow.getByLabel('onboarding').then((win) => {
      if (win) { void win.show(); void win.setFocus(); }
    }).catch(() => {});
  }, [rawHasSeenOnboarding]);

  // Main window starts hidden in tauri.conf.json (launcher behaviour). Reveal it
  // once settings are loaded AND onboarding is already done. First-time users
  // stay hidden until OnboardingPage.handleComplete shows the main window itself.
  const mainShownRef = useRef(false);
  useEffect(() => {
    if (mainShownRef.current) return;
    if (rawHasSeenOnboarding !== true) return;
    mainShownRef.current = true;
    const win = getCurrentWindow();
    win.show().then(() => win.setFocus()).catch(() => {});
  }, [rawHasSeenOnboarding]);

  // Install a deferred update when the user closes the app.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async (event) => {
      if (!hasPendingUpdate()) return;
      event.preventDefault();
      try {
        await installPendingUpdate();
      } catch {
        // If install fails, allow the app to close normally
        await win.destroy();
      }
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  // When the onboarding window closes, mark onboarding as done in this window's store.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen('volt://onboarding-complete', () => {
      const current = useAppStore.getState().settings;
      if (current) {
        useAppStore.getState().setSettings({
          ...current,
          general: { ...current.general, hasSeenOnboarding: true },
        });
      }
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

  const handleOpenTimerView = useCallback(() => {
    setActiveView({ type: 'timer' });
    clearSearch();
  }, [setActiveView, clearSearch]);

  useEffect(() => {
    const openTimer = () => handleOpenTimerView();
    window.addEventListener('volt:open-timer', openTimer);
    return () => window.removeEventListener('volt:open-timer', openTimer);
  }, [handleOpenTimerView]);

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
    onOpenActionsMenu: openActionsMenu,
  });

  const handleSelectEmoji = useCallback(
    async (emoji: string) => {
      try {
        await navigator.clipboard.writeText(emoji);
      } catch {
        // Clipboard write failure is non-critical
      }
      resetToSearchView();
      if (closeOnLaunch) await hideWindow();
    },
    [closeOnLaunch, hideWindow, resetToSearchView]
  );

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden isolate glass">
      <a href="#search-input" className="skip-link">
        {t('accessibility.skipToSearch')}
      </a>
      {activeView.type === 'search' && (
        <>
          <div className="drag-region" onMouseDown={() => { void startDragging(); }}>
            <div className="drag-handle"></div>
          </div>
          <SearchBar
            value={searchQuery}
            onChange={setQuery}
            onKeyDown={handleKeyDown}
            placeholder={t('search.placeholder')}
            resultCount={results.length}
            selectedIndex={selectedIndex}
          />
        </>
      )}

      <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <ViewRouter
            onSelectEmoji={(emoji) => { void handleSelectEmoji(emoji); }}
            onLaunchResult={(result) => { void handleLaunch(result); }}
            onActivateSuggestion={handleSuggestionActivate}
          />
        </div>
        <PreviewPanel result={selectedResult} isOpen={isPreviewOpen} />
      </div>

      {activeView.type === 'search' && (
        <>
          <TimerDisplay onOpenView={handleOpenTimerView} />
          <Footer isIndexing={isIndexing} />
        </>
      )}

      <ResultContextMenu
        state={contextMenu}
        onLaunch={(result) => { void handleLaunch(result); }}
        onShowProperties={handleShowProperties}
        onClose={closeContextMenu}
      />

      <ActionsMenu
        isOpen={isActionsMenuOpen}
        result={actionsMenuResult}
        onLaunch={(result) => { void handleLaunch(result); }}
        onShowProperties={handleShowProperties}
        onClose={closeActionsMenu}
      />

      <PropertiesDialog
        isOpen={isPropertiesOpen}
        onClose={closeProperties}
        result={propertiesResult}
      />

      <HelpDialog isOpen={isHelpOpen} onClose={toggleHelp} />

      <ToastContainer />

      {permissionRequest && (
        <PermissionDialog
          isOpen={true}
          extensionName={permissionRequest.extensionName}
          permissions={permissionRequest.permissions}
          onGrant={() => {
            permissionRequest.resolve(permissionRequest.permissions);
            setPermissionRequest(null);
          }}
          onDeny={() => {
            permissionRequest.resolve([]);
            setPermissionRequest(null);
          }}
        />
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
