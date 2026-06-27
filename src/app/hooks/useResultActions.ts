import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';
import { consumePendingHud } from '../../features/extensions/loader/hud-queue';
import { applicationService } from '../../features/applications/services/applicationService';
import { pluginRegistry } from '../../features/plugins/core';
import { PluginResult as PluginResultData } from '../../features/plugins/types';
import { defaultSuggestions } from '../../shared/constants/suggestions';
import { FileInfo, SearchResult, SearchResultType } from '../../shared/types/common.types';
import { extractErrorMessage } from '../../shared/utils/error';
import { logger } from '../../shared/utils/logger';
import { isPluginResultData } from '../../shared/utils/typeGuards';
import { VOLT_EVENTS, emitVoltEvent } from '../../shared/events';
import { openSystemMonitorWindow } from '../windows';
import { useSearchStore } from '../../stores/searchStore';
import { useUiStore } from '../../stores/uiStore';
import type { ActiveView } from '../../stores/uiStore';

export type { ActiveView };

interface UseResultActionsOptions {
  closeOnLaunch: boolean;
  hideWindow: () => Promise<void>;
  openSettingsWindow: (section?: string) => Promise<void>;
}

export interface UseResultActionsResult {
  handleLaunch: (result: SearchResult) => Promise<void>;
  handleSuggestionActivate: (categoryIndex: number, itemIndex: number) => Promise<void>;
}

/**
 * Owns the high-level "what happens when the user activates a result" logic:
 * - Launching apps, files, plugin results (with admin/background variants handled
 *   in `useGlobalHotkey`)
 * - Routing default suggestion items to their target views or query prefills
 *
 * Splitting this out keeps `App.tsx` focused on composition rather than dispatch.
 */
export function useResultActions({
  closeOnLaunch,
  hideWindow,
  openSettingsWindow,
}: UseResultActionsOptions): UseResultActionsResult {
  const { setQuery: setSearchQuery, setResults, setSearchError } = useSearchStore.getState();
  const { setActiveView } = useUiStore.getState();
  const handleLaunch = useCallback(
    async (result: SearchResult) => {
      try {
        let shouldHideWindow = true;

        if (result.type === SearchResultType.Application) {
          const appData = result.data as { path: string };
          await applicationService.launchApplication(appData.path);
        } else if (result.type === SearchResultType.File) {
          const fileData = result.data as FileInfo;
          await applicationService.launchApplication(fileData.path);
          // Track file access for recent files
          await invoke('track_file_access', { path: fileData.path, name: fileData.name });
        } else if (result.type === SearchResultType.SystemCommand) {
          const pluginResult = result.data as PluginResultData;
          if (!isPluginResultData(pluginResult)) {
            throw new Error('Invalid plugin result data');
          }
          const action = pluginResult.data?.action;

          // Don't hide window for settings/account commands - we want to show the settings window
          if (action === 'settings' || action === 'account') {
            shouldHideWindow = false;
            await openSettingsWindow();
          } else if (action === 'create-extension') {
            shouldHideWindow = false;
            setActiveView({ type: 'create-extension' });
          } else if (action === 'manage-extensions') {
            shouldHideWindow = false;
            await openSettingsWindow();
          } else {
            // Execute other system commands via plugin (about, reload, quit, etc.)
            const plugin = pluginRegistry.getPlugin(pluginResult.pluginId || 'systemcommands');
            if (plugin) {
              await plugin.execute(pluginResult);
            }
          }
        } else if (result.type === SearchResultType.Game) {
          // Handle game results - launch via GamesPlugin
          const pluginResult = result.data as PluginResultData;
          if (!isPluginResultData(pluginResult)) {
            throw new Error('Invalid plugin result data');
          }
          const plugin = pluginRegistry.getPlugin('games');
          if (plugin) {
            await plugin.execute(pluginResult);
          }
        } else if (result.type === SearchResultType.Url) {
          // URL results store the normalised URL in data.data.url (PluginResultData shape)
          const pluginData = result.data as PluginResultData;
          const url = (pluginData?.data as Record<string, unknown>)?.url as string | undefined;
          if (url) {
            const { openUrl } = await import('@tauri-apps/plugin-opener');
            await openUrl(url);
          }
        } else if (result.type === SearchResultType.SystemMonitor) {
          shouldHideWindow = false;
          await openSystemMonitorWindow();
        } else {
          // Handle other plugin results (Calculator, WebSearch, Timer, etc.)
          const pluginResult = result.data as PluginResultData;
          if (!isPluginResultData(pluginResult)) {
            throw new Error('Invalid plugin result data');
          }
          const pluginId = pluginResult.pluginId || pluginResult.type;

          // Don't hide window for Timer or Shell commands - we want to show output
          if (
            result.type === SearchResultType.Timer ||
            result.type === SearchResultType.ShellCommand
          ) {
            shouldHideWindow = false;
          }

          if (pluginId === 'emoji-picker' && pluginResult.data?.action === 'open-picker') {
            shouldHideWindow = false;
            const initialQuery =
              typeof pluginResult.data.initialQuery === 'string'
                ? pluginResult.data.initialQuery
                : '';
            setActiveView({ type: 'emoji', initialQuery });
          } else {
            const plugin = pluginRegistry.getPlugin(pluginId);
            if (plugin) {
              await plugin.execute(pluginResult);
            } else {
              logger.error('Plugin not found! ID:', pluginId);
            }
          }
        }

        // Record query→result binding for learning (fire-and-forget)
        const currentQuery = useSearchStore.getState().searchQuery;
        if (currentQuery.trim()) {
          const resultId =
            result.type === SearchResultType.Application
              ? (result.data as { path: string }).path
              : result.type === SearchResultType.File
                ? (result.data as FileInfo).path
                : result.id;
          invoke('record_search_selection', { query: currentQuery, resultId }).catch((err) =>
            logger.error('Failed to record search selection:', err)
          );
        }

        // If the extension called showHUD(), show the overlay for 1.5s before hiding.
        const hudMessage = consumePendingHud();
        if (hudMessage) {
          emitVoltEvent(VOLT_EVENTS.HUD_SHOW, { message: hudMessage });
          await new Promise<void>((resolve) => { setTimeout(resolve, 1500); });
        }

        // Hide window after launching if closeOnLaunch is enabled and action allows it
        if (shouldHideWindow && closeOnLaunch) {
          await hideWindow();
        }

        // Keep query and results visible for shell commands so user can read output
        if (result.type !== SearchResultType.ShellCommand) {
          setSearchQuery('');
          setResults([]);
        }
      } catch (err) {
        const errorMessage = extractErrorMessage(err);
        logger.error('Failed to launch:', errorMessage);
        setSearchError(`Failed to launch: ${errorMessage}`);
      }
    },
    [closeOnLaunch, hideWindow, openSettingsWindow, setActiveView, setSearchQuery, setResults, setSearchError]
  );

  const handleSuggestionActivate = useCallback(
    async (categoryIndex: number, itemIndex: number) => {
      const category = defaultSuggestions[categoryIndex];
      const item = category.items[itemIndex];

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
          } catch (error) {
            logger.error('Failed to open website:', error);
            window.open('https://voltlaunchr.com', '_blank');
          }
          break;
        case 'clipboard-history':
          setActiveView({ type: 'clipboard' });
          break;
        case 'search-emoji':
          setSearchQuery(':');
          break;
        case 'search-files':
          setActiveView({ type: 'files' });
          break;
        case 'system-monitor':
          setSearchQuery('system ');
          break;
        case 'calculator':
          setActiveView({ type: 'calculator' });
          break;
        case 'timer':
          setActiveView({ type: 'timer' });
          break;
        case 'web-search':
          setSearchQuery('? ');
          break;
        case 'steam-games':
          setActiveView({ type: 'games' });
          break;
        case 'notes':
          try {
            await invoke<void>('open_notes_window', { noteId: null });
            await hideWindow();
          } catch (err) {
            logger.error('Failed to open notes window:', err);
          }
          break;
        case 'create-note': {
          try {
            const created = await invoke<{ id: string }>('create_note', {
              title: null,
              content: null,
              tags: null,
            });
            await invoke<void>('open_notes_window', { noteId: created.id });
            await hideWindow();
          } catch (err) {
            logger.error('Failed to create note:', err);
          }
          break;
        }
        case 'search-notes':
          setSearchQuery('n ');
          break;
        case 'create-extension':
          setActiveView({ type: 'create-extension' });
          break;
        case 'manage-extensions':
          setActiveView({ type: 'manage-extensions' });
          break;
        case 'ai-chat':
          setActiveView({ type: 'ai-chat', initialQuery: '' });
          break;
        case 'ai-quick-actions':
          // The AI Settings panel hosts the Quick Actions editor. We open
          // the settings window with a hash so SettingsApp can land on the
          // AI section instead of the default General tab.
          await openSettingsWindow('ai');
          break;
        case 'custom-emojis':
          setActiveView({ type: 'emoji', initialQuery: '', initialCategory: 'custom' });
          break;
        default:
          logger.warn('Unknown suggestion:', item.id);
      }
    },
    [openSettingsWindow, setSearchQuery, setActiveView, hideWindow]
  );

  return { handleLaunch, handleSuggestionActivate };
}
