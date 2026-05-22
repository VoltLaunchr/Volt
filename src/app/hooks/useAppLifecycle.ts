import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';
import { useApplications } from '../../features/applications';
import { ClipboardPlugin } from '../../features/clipboard';
import { extensionLoader } from '../../features/extensions';
import {
  AiChatPlugin,
  CalculatorPlugin,
  DeveloperCommandsPlugin,
  EmojiPickerPlugin,
  GamesPlugin,
  NotesPlugin,
  QuicklinksPlugin,
  WindowManagementPlugin,
  ShellCommandPlugin,
  SystemCommandsPlugin,
  SystemMonitorPlugin,
  TimerPlugin,
  WebSearchPlugin,
} from '../../features/plugins/builtin';
import { SnippetsPlugin } from '../../features/plugins/builtin/snippets';
import { pluginRegistry } from '../../features/plugins/core';
import {
  applyTheme,
  applyTransparency,
  settingsService,
  setupThemeListener,
} from '../../features/settings';
import type { Settings } from '../../features/settings/types/settings.types';
import { updateService } from '../../features/settings/services/updateService';
import { AppInfo } from '../../shared/types/common.types';
import { logger } from '../../shared/utils/logger';
import { useToastStore } from '../../shared/components/ui/toast-store';
import { useAppStore } from '../../stores/appStore';
import { useUiStore } from '../../stores/uiStore';
import type { ExtensionPermission } from '../../features/extensions/types/extension.types';

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
  const { setSettings, setIsIndexing, setAllApps, setIsLoading, setAppError } = useAppStore.getState();

  const indexingStarted = useRef(false); // Prevent double indexing (StrictMode)
  const updateCheckDone = useRef(false); // Prevent double update check
  // Tracks the active `indexing-progress` Tauri listener so both effects below
  // (settings-changed restart + start-indexing-on-mount) can tear it down.
  // Declared at the top so both effects see the same ref instance.
  const indexingUnlistenRef = useRef<(() => void) | null>(null);
  // Set to true right before the main window itself writes indexing settings
  // (auto-seed of default folders on first launch). The `settings-changed`
  // listener checks this ref to avoid restarting an indexing run that the
  // startup effect is about to kick off — fixes "Indexing already in progress".
  const selfTriggeredSettingsSaveRef = useRef(false);

  // Sync app data into store (single effect to avoid cascading re-renders)
  useEffect(() => {
    setAllApps(allApps);
    setIsLoading(isLoading);
    setAppError(appError);
  }, [allApps, isLoading, appError, setAllApps, setIsLoading, setAppError]);

  // Load settings, theme, and initialize plugins on mount
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const loadedSettings = await settingsService.loadSettings();
        setSettings(loadedSettings);
        applyTheme(loadedSettings.appearance.theme);
        applyTransparency(loadedSettings.appearance.transparency);

        // Register built-in plugins (only once - prevents StrictMode double-registration).
        // markInitialized() runs synchronously right after register() and BEFORE any await,
        // so the second StrictMode mount sees the guard before its sibling reaches an await.
        if (!pluginRegistry.isInitialized()) {
          pluginRegistry.register(new ClipboardPlugin());
          pluginRegistry.register(new AiChatPlugin());
          pluginRegistry.register(new CalculatorPlugin());
          pluginRegistry.register(new DeveloperCommandsPlugin());
          pluginRegistry.register(new EmojiPickerPlugin());
          pluginRegistry.register(new WebSearchPlugin());
          pluginRegistry.register(new SystemCommandsPlugin());
          pluginRegistry.register(new TimerPlugin());
          pluginRegistry.register(new SystemMonitorPlugin());
          pluginRegistry.register(new GamesPlugin()); // Unified games plugin (all platforms)
          pluginRegistry.register(new SnippetsPlugin());
          pluginRegistry.register(new QuicklinksPlugin());
          pluginRegistry.register(new NotesPlugin());
          pluginRegistry.register(new WindowManagementPlugin());
          pluginRegistry.register(new ShellCommandPlugin());
          pluginRegistry.markInitialized();

          // Start clipboard monitoring
          await ClipboardPlugin.startMonitoring();

          logger.info(
            '✓ Built-in plugins initialized:',
            pluginRegistry
              .getAllPlugins()
              .map((p) => p.name)
              .join(', ')
          );

          // Wire up permission consent handler before loading extensions
          extensionLoader.setPermissionRequestHandler(
            (extensionName: string, permissions: ExtensionPermission[]) =>
              new Promise<ExtensionPermission[]>((resolve) => {
                useUiStore.getState().setPermissionRequest({
                  extensionName,
                  permissions,
                  resolve,
                });
              })
          );

          // Load external extensions
          try {
            const loadedExtensions = await extensionLoader.loadAllExtensions();
            if (loadedExtensions.length > 0) {
              logger.info(
                '✓ External extensions loaded:',
                loadedExtensions.map((e) => e.manifest.name).join(', ')
              );
            }
          } catch (err) {
            logger.warn('⚠ Failed to load external extensions:', err);
          }

          logger.info(
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

    void initializeApp();
  }, [setSettings]);

  // Best-effort update check on startup + periodic background check.
  // Respects the autoCheckForUpdates setting, throttle (6h), snooze, and skip-version.
  useEffect(() => {
    const autoCheck = settings?.general.autoCheckForUpdates ?? true;
    if (!autoCheck) {
      updateService.stopPeriodicCheck();
      return;
    }

    const channel = settings?.general.updateChannel ?? 'stable';

    const showUpdateToast = (update: { version: string; critical?: boolean; isBeta?: boolean }) => {
      const { addToast } = useToastStore.getState();
      const label = update.isBeta ? `v${update.version} (beta)` : `v${update.version}`;
      const message = update.critical
        ? `Critical update ${label} available — install immediately`
        : `Update available: ${label} — Open Settings to update`;

      addToast(
        message,
        'update',
        0,
        () => {
          // Open the settings window and navigate to About section
          void import('@tauri-apps/api/webviewWindow').then(({ WebviewWindow }) => {
            WebviewWindow.getByLabel('settings').then((win) => {
              if (win) {
                void win.show();
                void win.setFocus();
              }
            }).catch(() => {});
          });
        },
        // Critical updates cannot be dismissed — the user must open Settings
        !update.critical
      );
    };

    // Startup check (once per mount, throttled inside the service)
    if (!updateCheckDone.current) {
      updateCheckDone.current = true;
      void updateService.checkUpdateOnStartup(channel).then((update) => {
        if (update) showUpdateToast(update);
      });
    }

    // Periodic background check every 6h
    updateService.startPeriodicCheck((update) => showUpdateToast(update), channel);

    return () => {
      updateService.stopPeriodicCheck();
    };
  }, [settings?.general.autoCheckForUpdates, settings?.general.updateChannel]);

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
    let unlistenFn: (() => void) | undefined;
    let cancelled = false;

    void listen<{ action: 'load' | 'unload' | 'reload'; extensionId: string }>(
      'extension-changed',
      (event) => {
        const { action, extensionId } = event.payload;
        logger.info(`[App] Received extension event: ${action} ${extensionId}`);

        const run = async () => {
          try {
            switch (action) {
              case 'load':
              case 'reload':
                await extensionLoader.reloadExtension(extensionId);
                logger.info(`✓ Extension ${extensionId} ${action}ed in main window`);
                break;
              case 'unload':
                extensionLoader.unloadExtension(extensionId);
                logger.info(`✓ Extension ${extensionId} unloaded from main window`);
                break;
            }
          } catch (err) {
            logger.error(`Failed to ${action} extension ${extensionId}:`, err);
          }
        };
        void run();
      }
    ).then((fn) => {
      // If the component already unmounted while the Promise was pending,
      // tear down the listener immediately instead of leaking it.
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  // Listen for settings changes from settings window and sync to main window store
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    let cancelled = false;

    void listen<Settings>('settings-changed', (event) => {
      const newSettings = event.payload;
      const currentSettings = useAppStore.getState().settings;

      setSettings(newSettings);
      applyTheme(newSettings.appearance.theme);
      applyTransparency(newSettings.appearance.transparency);

      // Self-write echo: the main window just persisted these settings itself
      // (e.g. auto-seeding default folders on first launch). The startup effect
      // owns the start_indexing call in that path — don't race it from here.
      if (selfTriggeredSettingsSaveRef.current) {
        selfTriggeredSettingsSaveRef.current = false;
        return;
      }

      const foldersChanged =
        currentSettings == null ||
        JSON.stringify(newSettings.indexing.folders) !==
          JSON.stringify(currentSettings.indexing.folders);
      const extensionsChanged =
        currentSettings == null ||
        JSON.stringify(newSettings.indexing.fileExtensions) !==
          JSON.stringify(currentSettings.indexing.fileExtensions);

      if ((foldersChanged || extensionsChanged) && newSettings.indexing.folders.length > 0) {
        const restart = async () => {
          // Tear down any active progress listener from a previous indexing run
          // before registering a new one, so we don't double-fire setIsIndexing.
          indexingUnlistenRef.current?.();
          indexingUnlistenRef.current = null;

          try {
            setIsIndexing(true);
            const { addToast } = useToastStore.getState();
            addToast(`Indexing ${newSettings.indexing.folders.length} folder(s)...`, 'info');

            const unlisten = await listen<{
              phase: string;
              indexedFiles: number;
            }>('indexing-progress', (evt) => {
              const { phase, indexedFiles } = evt.payload;
              if (phase === 'complete') {
                setIsIndexing(false);
                addToast(`Indexing complete — ${indexedFiles} files indexed`, 'success');
                unlisten();
                indexingUnlistenRef.current = null;
              } else if (phase === 'error') {
                setIsIndexing(false);
                addToast('Indexing failed', 'error', 0);
                unlisten();
                indexingUnlistenRef.current = null;
              }
            });
            indexingUnlistenRef.current = unlisten;

            await invoke<void>('start_indexing', {
              folders: newSettings.indexing.folders,
              excludedPaths: newSettings.indexing.excludedPaths,
              fileExtensions: newSettings.indexing.fileExtensions,
              force: true,
              deepSearch: newSettings.indexing.deepSearch,
            });
          } catch (err) {
            logger.error('Failed to restart indexing after settings change:', err);
            setIsIndexing(false);
            indexingUnlistenRef.current?.();
            indexingUnlistenRef.current = null;
          }
        };
        void restart();
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenFn = fn;
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
      // Tear down any indexing-progress listener installed by an in-flight
      // restart. Without this, an unmount mid-restart leaks the listener and
      // fires setIsIndexing/addToast on a torn-down store subscriber.
      indexingUnlistenRef.current?.();
      indexingUnlistenRef.current = null;
    };
  }, [setSettings, setIsIndexing]);

  // Start file indexing if enabled in settings.
  // ONE-SHOT BY DESIGN: `indexingStarted.current` is set on first run and
  // never reset, so this effect can fire at most once per component lifetime.
  // Restart logic on settings changes is owned by the `settings-changed`
  // Tauri listener above, which manages its own progress-listener lifecycle.
  // We therefore depend only on whether settings have arrived
  // (`indexOnStartup !== undefined` doubles as a "settings loaded" gate);
  // the indexing.folders / excludedPaths / fileExtensions arrays are read
  // fresh from the store inside the effect body via `useAppStore.getState()`,
  // not captured from the closure, so they don't belong in the deps array.
  const indexOnStartup = settings?.indexing.indexOnStartup;
  useEffect(() => {
    const startFileIndexing = async () => {
      // Prevent double indexing (StrictMode)
      if (indexingStarted.current) return;

      const currentSettings = useAppStore.getState().settings;
      if (!currentSettings?.indexing.indexOnStartup) {
        return;
      }

      indexingStarted.current = true;

      // If no folders configured, auto-configure with default folders
      let foldersToIndex = currentSettings.indexing.folders;
      if (foldersToIndex.length === 0) {
        try {
          const defaultFolders = await invoke<string[]>('get_default_index_folders');
          if (defaultFolders.length > 0) {
            // Mark this save as self-triggered so the `settings-changed` listener
            // (which echoes back into the same window) doesn't race-start indexing.
            selfTriggeredSettingsSaveRef.current = true;
            await settingsService.updateIndexingSettings({
              ...currentSettings.indexing,
              folders: defaultFolders,
            });
            foldersToIndex = defaultFolders;
            logger.info('✓ Auto-configured indexing with default folders:', defaultFolders);
          }
        } catch (err) {
          selfTriggeredSettingsSaveRef.current = false;
          logger.error('Failed to get default folders:', err);
          return;
        }
      }

      if (foldersToIndex.length === 0) {
        return;
      }

      // Detect if the indexing config changed since the last app session.
      // When it changes (e.g. folders added, or file_extensions migrated from ["exe","lnk"]→[]),
      // pass force=true to bypass the SQLite cache and do a full rescan with the new config.
      const INDEX_CONFIG_KEY = 'volt:lastIndexConfig';
      const currentConfigSig = JSON.stringify({
        folders: [...foldersToIndex].sort(),
        ext: [...currentSettings.indexing.fileExtensions].sort(),
      });
      const lastConfigSig = localStorage.getItem(INDEX_CONFIG_KEY);
      const forceRescan = lastConfigSig !== currentConfigSig;
      if (forceRescan) {
        localStorage.setItem(INDEX_CONFIG_KEY, currentConfigSig);
      }

      try {
        setIsIndexing(true);
        const { addToast } = useToastStore.getState();
        addToast(`Indexing ${foldersToIndex.length} folder(s)...`, 'info');

        // Listen for progress events from backend
        const unlisten = await listen<{
          phase: string;
          indexedFiles: number;
          totalFiles: number;
          isComplete: boolean;
        }>('indexing-progress', (event) => {
          const { phase, indexedFiles } = event.payload;

          if (phase === 'complete') {
            setIsIndexing(false);
            addToast(`Indexing complete — ${indexedFiles} files indexed`, 'success');
            unlisten();
            indexingUnlistenRef.current = null;
            // Initial scan is done — start the incremental file watcher so the
            // SQLite index stays in sync with FS changes (create/delete/rename).
            // Without this the "File Watcher" status stays Inactive and changes
            // only land at the next start_indexing run.
            invoke('start_file_watcher').catch((err) => {
              logger.warn('Failed to start file watcher:', err);
            });
          } else if (phase === 'error') {
            setIsIndexing(false);
            addToast('Indexing failed', 'error', 0); // duration 0 = persistent
            unlisten();
            indexingUnlistenRef.current = null;
          }
        });

        // Store unlisten for cleanup on unmount
        indexingUnlistenRef.current = unlisten;

        // Start indexing (returns immediately, work happens in background).
        // force=true bypasses the SQLite cache when the config changed since last run.
        await invoke<void>('start_indexing', {
          folders: foldersToIndex,
          excludedPaths: currentSettings.indexing.excludedPaths,
          fileExtensions: currentSettings.indexing.fileExtensions,
          force: forceRescan || undefined,
          deepSearch: currentSettings.indexing.deepSearch,
        });
      } catch (err) {
        logger.error('Failed to start file indexing:', err);
        useToastStore.getState().addToast('Indexing failed', 'error', 0);
        setIsIndexing(false);
      }
    };

    if (indexOnStartup !== undefined) {
      void startFileIndexing();
    }

    return () => {
      // Clean up indexing listener on unmount
      if (indexingUnlistenRef.current) {
        indexingUnlistenRef.current();
        indexingUnlistenRef.current = null;
      }
    };
  }, [indexOnStartup, setIsIndexing]);

  return {
    allApps,
    isLoading,
    appError,
    refreshApps,
    clearAppError,
  };
}
