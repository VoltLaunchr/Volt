import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';
import { useApplications } from '../../features/applications';
import { ClipboardPlugin } from '../../features/clipboard';
import { extensionLoader } from '../../features/extensions';
import {
  CalculatorPlugin,
  EmojiPickerPlugin,
  GamesPlugin,
  SteamPlugin,
  SystemCommandsPlugin,
  SystemMonitorPlugin,
  TimerPlugin,
  WebSearchPlugin,
} from '../../features/plugins/builtin';
import { pluginRegistry } from '../../features/plugins/core';
import {
  applyTheme,
  settingsService,
  setupThemeListener,
} from '../../features/settings';
import { updateService } from '../../features/settings/services/updateService';
import { AppInfo } from '../../shared/types/common.types';
import { logger } from '../../shared/utils/logger';
import { useToastStore } from '../../shared/components/ui/Toast';
import { useAppStore } from '../../stores/appStore';

export interface UseAppLifecycleResult {
  allApps: AppInfo[];
  isLoading: boolean;
  appError: string | null;
  refreshApps: () => Promise<void>;
  clearAppError: () => void;
}

/**
 * Owns app-wide lifecycle concerns:
 * - Initial app scan (delegates to `useApplications`)
 * - Settings load + theme apply + system theme listener
 * - Built-in plugin registration + extension loader bootstrap
 * - Background file indexing kickoff
 * - Best-effort updater check on startup
 * - Listening for `extension-changed` events from settings window
 *
 * Settings and indexing state live in appStore (zustand).
 */
export function useAppLifecycle(): UseAppLifecycleResult {
  const {
    apps: allApps,
    isLoading,
    error: appError,
    refresh: refreshApps,
    clearError: clearAppError,
  } = useApplications();

  const settings = useAppStore((s) => s.settings);
  const { setSettings, setIsIndexing } = useAppStore.getState();

  const indexingStarted = useRef(false); // Prevent double indexing (StrictMode)
  const updateCheckDone = useRef(false); // Prevent double update check

  // Load settings, theme, and initialize plugins on mount
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const loadedSettings = await settingsService.loadSettings();
        setSettings(loadedSettings);
        applyTheme(loadedSettings.appearance.theme);

        // Register built-in plugins (only once - prevents StrictMode double-registration)
        if (!pluginRegistry.isInitialized()) {
          pluginRegistry.register(new ClipboardPlugin());
          pluginRegistry.register(new CalculatorPlugin());
          pluginRegistry.register(new EmojiPickerPlugin());
          pluginRegistry.register(new WebSearchPlugin());
          pluginRegistry.register(new SystemCommandsPlugin());
          pluginRegistry.register(new TimerPlugin());
          pluginRegistry.register(new SystemMonitorPlugin());
          pluginRegistry.register(new SteamPlugin());
          pluginRegistry.register(new GamesPlugin()); // Unified games plugin (all platforms)

          // Start clipboard monitoring
          await ClipboardPlugin.startMonitoring();

          pluginRegistry.markInitialized();

          console.log(
            '✓ Built-in plugins initialized:',
            pluginRegistry
              .getAllPlugins()
              .map((p) => p.name)
              .join(', ')
          );

          // Load external extensions
          try {
            const loadedExtensions = await extensionLoader.loadAllExtensions();
            if (loadedExtensions.length > 0) {
              console.log(
                '✓ External extensions loaded:',
                loadedExtensions.map((e) => e.manifest.name).join(', ')
              );
            }
          } catch (err) {
            console.warn('⚠ Failed to load external extensions:', err);
          }

          console.log(
            '✓ All plugins ready:',
            pluginRegistry
              .getAllPlugins()
              .map((p) => p.name)
              .join(', ')
          );
        }
      } catch (err) {
        logger.error('Failed to load settings:', err);
        applyTheme('dark');
      }
    };

    initializeApp();
  }, [setSettings]);

  // Best-effort update check on startup (silent)
  useEffect(() => {
    if (updateCheckDone.current) return;
    updateCheckDone.current = true;
    void updateService.checkUpdateOnStartup();
  }, []);

  // Setup listener for system theme changes (for auto mode)
  useEffect(() => {
    if (settings?.appearance.theme === 'auto') {
      const cleanup = setupThemeListener((isDark) => {
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      });
      return cleanup;
    }
  }, [settings?.appearance.theme]);

  // Listen for extension changes from settings window
  useEffect(() => {
    const unlisten = listen<{ action: 'load' | 'unload' | 'reload'; extensionId: string }>(
      'extension-changed',
      async (event) => {
        const { action, extensionId } = event.payload;
        console.log(`[App] Received extension event: ${action} ${extensionId}`);

        try {
          switch (action) {
            case 'load':
            case 'reload':
              await extensionLoader.reloadExtension(extensionId);
              console.log(`✓ Extension ${extensionId} ${action}ed in main window`);
              break;
            case 'unload':
              extensionLoader.unloadExtension(extensionId);
              console.log(`✓ Extension ${extensionId} unloaded from main window`);
              break;
          }
        } catch (err) {
          logger.error(`Failed to ${action} extension ${extensionId}:`, err);
        }
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Start file indexing if enabled in settings
  useEffect(() => {
    const startFileIndexing = async () => {
      // Prevent double indexing (StrictMode)
      if (indexingStarted.current) return;

      if (!settings?.indexing.indexOnStartup) {
        return;
      }

      indexingStarted.current = true;

      // If no folders configured, auto-configure with default folders
      let foldersToIndex = settings.indexing.folders;
      if (foldersToIndex.length === 0) {
        try {
          const defaultFolders = await invoke<string[]>('get_default_index_folders');
          if (defaultFolders.length > 0) {
            // Update settings with default folders
            await settingsService.updateIndexingSettings({
              ...settings.indexing,
              folders: defaultFolders,
            });
            foldersToIndex = defaultFolders;
            console.log('✓ Auto-configured indexing with default folders:', defaultFolders);
          }
        } catch (err) {
          logger.error('Failed to get default folders:', err);
          return;
        }
      }

      if (foldersToIndex.length === 0) {
        return;
      }

      try {
        setIsIndexing(true);
        const { addToast } = useToastStore.getState();
        addToast(`Indexing ${foldersToIndex.length} folder(s)...`, 'info');
        await invoke('start_indexing', {
          folders: foldersToIndex,
          excludedPaths: settings.indexing.excludedPaths,
          fileExtensions: settings.indexing.fileExtensions,
        });
        addToast('Indexing complete', 'success');
      } catch (err) {
        logger.error('Failed to start file indexing:', err);
        useToastStore.getState().addToast('Indexing failed', 'error');
      } finally {
        setIsIndexing(false);
      }
    };

    if (settings) {
      startFileIndexing();
    }
  }, [settings, setIsIndexing]);

  return {
    allApps,
    isLoading,
    appError,
    refreshApps,
    clearAppError,
  };
}
