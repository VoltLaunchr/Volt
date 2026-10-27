import { invoke } from '@tauri-apps/api/core';
import type React from 'react';
import { useCallback, useEffect } from 'react';
import { applicationService } from '../../features/applications/services/applicationService';
import { openFilePath } from '../../features/files/services/fileOpenService';
import { defaultSuggestions } from '../../shared/constants/suggestions';
import { KEYS } from '../../shared/constants/keys';
import { AppInfo, FileInfo, SearchResult, SearchResultType } from '../../shared/types/common.types';
import { logger } from '../../shared/utils/logger';
import { pluginRegistry } from '../../features/plugins/core';
import { useSearchStore } from '../../stores/searchStore';
import { VOLT_EVENTS, onVoltEvent } from '../../shared/events';
import {
  isActionsMenuShortcut,
  resolveEscapeAction,
  resolveListNavigation,
} from '../../features/settings/behavior/keyboard';
import type { EscapeBehavior, ListNavigationPreset } from '../../features/settings/types/settings.types';

// Helper to extract directory path (cross-platform)
const getDirectoryPath = (filePath: string): string => {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastSlash === -1) {
    return '.'; // Current directory if no separator found
  }
  const dirPath = filePath.substring(0, lastSlash);
  return dirPath || '/'; // Return root if empty
};

interface UseGlobalHotkeyOptions {
  closeOnLaunch: boolean;
  /** Settings -> Keyboard: what Escape does in the search bar (default: clear and hide). */
  escapeBehavior?: EscapeBehavior;
  /** Settings -> Keyboard: extra list navigation keys (default: arrows + Ctrl+N/P). */
  listNavigation?: ListNavigationPreset;
  hideWindow: () => Promise<void>;
  onLaunch: (result: SearchResult) => void | Promise<void>;
  onActivateSuggestion: (categoryIndex: number, itemIndex: number) => void | Promise<void>;
  onShowProperties: (result: SearchResult) => void;
  onOpenSettings: () => void | Promise<void>;
  onOpenCalculator: () => void;
  onOpenHelp: () => void;
  onTogglePreview: () => void;
  onOpenActionsMenu: (result: SearchResult) => void;
}

export interface UseGlobalHotkeyResult {
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Owns global keyboard / window event wiring:
 * - F1 (global) → open documentation
 * - `volt:open-settings` / `volt:open-calculator` window events
 * - SearchBar onKeyDown handler (Alt+1-9, Ctrl+K/,/R/Q/O/I/C/Delete, Shift/Ctrl+Enter,
 *   navigation keys, Tab autocomplete, Enter, Escape)
 *
 * Returns the keyboard handler that App.tsx wires to its `<SearchBar>`.
 */
export function useGlobalHotkey({
  closeOnLaunch,
  escapeBehavior,
  listNavigation,
  hideWindow,
  onLaunch,
  onActivateSuggestion,
  onShowProperties,
  onOpenSettings,
  onOpenCalculator,
  onOpenHelp,
  onTogglePreview,
  onOpenActionsMenu,
}: UseGlobalHotkeyOptions): UseGlobalHotkeyResult {
  const { setSelectedIndex, setQuery: setSearchQuery, setResults } = useSearchStore.getState();
  // Setup the global help shortcut. Printable characters must stay available
  // to the search input because plugins and extensions use prefix triggers.
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        onOpenHelp();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [onOpenHelp]);

  // Setup listener for custom events (e.g., from plugins)
  useEffect(() => {
    const offSettings = onVoltEvent(VOLT_EVENTS.OPEN_SETTINGS, () => {
      void onOpenSettings();
    });
    const offCalculator = onVoltEvent(VOLT_EVENTS.OPEN_CALCULATOR, () => {
      onOpenCalculator();
    });

    return () => {
      offSettings();
      offCalculator();
    };
  }, [onOpenSettings, onOpenCalculator]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Read current state inside callback to avoid stale closures and unnecessary re-renders
      const { results, selectedIndex, searchQuery } = useSearchStore.getState();
      const isShowingSuggestions = !searchQuery.trim() && results.length === 0;
      const totalSuggestions = defaultSuggestions.reduce((sum, cat) => sum + cat.items.length, 0);
      const maxIndex = isShowingSuggestions ? totalSuggestions - 1 : results.length - 1;
      const selectedResult = results[selectedIndex];

      // ============================================================
      // KEYBOARD SHORTCUTS (per docs: /docs/user-guide/shortcuts)
      // ============================================================

      // --- Alt+1-9: Quick launch (first 9 results) ---
      if (e.altKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        if (results[index]) {
          void onLaunch(results[index]);
        }
        return;
      }

      // --- Ctrl+K: Open actions menu for selected result (falls back to clear if nothing selected).
      // The vim preset gives Ctrl+K to "previous result" and moves the menu to Ctrl+Shift+K. ---
      if (isActionsMenuShortcut(listNavigation, e)) {
        e.preventDefault();
        if (selectedResult) {
          onOpenActionsMenu(selectedResult);
        } else {
          setSearchQuery('');
          setResults([]);
        }
        return;
      }

      // --- Ctrl+,: Open Settings ---
      if (e.key === ',' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void onOpenSettings();
        return;
      }

      // --- Ctrl+R: Reload Volt ---
      if (e.key === 'r' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        window.location.reload();
        return;
      }

      // --- Ctrl+Q: Quit Volt ---
      if (e.key === 'q' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        hideWindow().catch((err: unknown) => logger.error('hideWindow failed:', err));
        return;
      }

      // --- F1: Show help dialog ---
      if (e.key === 'F1') {
        e.preventDefault();
        onOpenHelp();
        return;
      }

      // --- Alternative list navigation of the preset: Ctrl+N/P (emacs) or Ctrl+J/K (vim),
      // aliases of ArrowDown / ArrowUp. Emacs Ctrl+P keeps toggling the preview panel when
      // there is no result list to move through. ---
      const alternativeMove = resolveListNavigation(listNavigation, e);
      if (alternativeMove) {
        e.preventDefault();
        if (alternativeMove === 'down') {
          setSelectedIndex((prev) => (prev < maxIndex ? prev + 1 : prev));
        } else if (e.key.toLowerCase() === 'p' && (isShowingSuggestions || results.length === 0)) {
          onTogglePreview();
        } else {
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        }
        return;
      }

      // --- Ctrl+P: Toggle the preview panel (when Ctrl+P is not a navigation key) ---
      if (e.key === 'p' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        onTogglePreview();
        return;
      }

      // --- Ctrl+O: Open containing folder ---
      if (e.key === 'o' && e.ctrlKey && !e.shiftKey && !e.altKey && selectedResult) {
        e.preventDefault();
        const path =
          selectedResult.type === SearchResultType.File
            ? (selectedResult.data as FileInfo).path
            : (selectedResult.data as AppInfo).path;
        const dirPath = getDirectoryPath(path);
        invoke<void>('open_path', { path: dirPath }).catch((err: unknown) =>
          logger.error('open_path failed:', err)
        );
        return;
      }

      // --- Ctrl+I: Show item info (properties) ---
      if (e.key === 'i' && e.ctrlKey && !e.shiftKey && !e.altKey && selectedResult) {
        e.preventDefault();
        onShowProperties(selectedResult);
        return;
      }

      // --- Ctrl+C: Cancel running shell command (priority over copy) ---
      if (
        e.key === 'c' &&
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        selectedResult?.type === SearchResultType.ShellCommand
      ) {
        const shellData = selectedResult.data as unknown as {
          status?: string;
          command?: string;
        };
        if (shellData?.status === 'running' && shellData?.command) {
          e.preventDefault();
          const plugin = pluginRegistry.getPlugin('shellcommand');
          if (plugin && 'cancel' in plugin) {
            (plugin as { cancel: (cmd: string) => void }).cancel(shellData.command);
          }
          return;
        }
      }

      // --- Ctrl+C: Copy result path ---
      if (
        e.key === 'c' &&
        e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        selectedResult &&
        !window.getSelection()?.toString()
      ) {
        e.preventDefault();
        const path =
          selectedResult.type === SearchResultType.File
            ? (selectedResult.data as FileInfo).path
            : selectedResult.type === SearchResultType.Application
              ? (selectedResult.data as AppInfo).path
              : selectedResult.title;
        void navigator.clipboard.writeText(path);
        return;
      }

      // --- Ctrl+Delete: Remove from history ---
      if (e.key === 'Delete' && e.ctrlKey && !e.shiftKey && !e.altKey && selectedResult) {
        e.preventDefault();
        // Remove from history if it's an app or file
        if (selectedResult.type === SearchResultType.Application) {
          const appData = selectedResult.data as AppInfo;
          const removedId = selectedResult.id;
          invoke<void>('remove_from_history', { path: appData.path }).catch((err: unknown) =>
            logger.error('remove_from_history failed:', err)
          );
          // Re-read fresh results: a streaming batch may have arrived between
          // keydown and now — filtering the stale `results` snapshot would
          // resurrect removed items or drop fresh ones.
          const fresh = useSearchStore.getState().results;
          setResults(fresh.filter((r) => r.id !== removedId));
        }
        return;
      }

      // --- Shift+Enter: Execute application as administrator ---
      if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && selectedResult) {
        e.preventDefault();
        // Launch as admin (Windows-specific via Tauri command)
        if (selectedResult.type === SearchResultType.Application) {
          const path = (selectedResult.data as AppInfo).path;
          applicationService
            .launchApplication(path, true)
            .then((result) => {
              if (!result.success) {
                logger.error('launch_application failed:', result.error);
                return;
              }
              if (closeOnLaunch) {
                void hideWindow();
              }
              setSearchQuery('');
              setResults([]);
            })
            .catch((err: unknown) => logger.error('launch_application failed:', err));
        }
        return;
      }

      // --- Ctrl+Enter: Execute in background (don't close window) ---
      if (e.key === 'Enter' && e.ctrlKey && !e.shiftKey && !e.altKey && selectedResult) {
        e.preventDefault();
        // Launch without hiding window
        if (selectedResult.type === SearchResultType.Application) {
          const appData = selectedResult.data as { path: string };
          applicationService
            .launchApplication(appData.path)
            .catch((err: unknown) => logger.error('launchApplication failed:', err));
        } else if (selectedResult.type === SearchResultType.File) {
          const fileData = selectedResult.data as FileInfo;
          openFilePath(fileData).catch((err: unknown) => logger.error('open_path failed:', err));
        }
        // Don't hide window, just clear search
        setSearchQuery('');
        setResults([]);
        return;
      }

      // ============================================================
      // NAVIGATION KEYS
      // ============================================================
      switch (e.key) {
        case KEYS.ARROW_DOWN:
          e.preventDefault();
          setSelectedIndex((prev) => (prev < maxIndex ? prev + 1 : prev));
          break;

        case KEYS.ARROW_UP:
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;

        case KEYS.HOME:
          e.preventDefault();
          setSelectedIndex(0);
          break;

        case KEYS.END:
          e.preventDefault();
          setSelectedIndex(maxIndex);
          break;

        case KEYS.PAGE_DOWN:
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 5, maxIndex));
          break;

        case KEYS.PAGE_UP:
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 5, 0));
          break;

        case KEYS.TAB:
          // Tab: Autocomplete suggestion (fill search with selected result title)
          if (selectedResult && !e.shiftKey) {
            e.preventDefault();
            setSearchQuery(selectedResult.title);
          }
          break;

        case KEYS.ENTER:
          e.preventDefault();
          if (isShowingSuggestions) {
            // Find which category and item based on selectedIndex
            let globalIndex = 0;
            for (let catIndex = 0; catIndex < defaultSuggestions.length; catIndex++) {
              const category = defaultSuggestions[catIndex];
              if (selectedIndex < globalIndex + category.items.length) {
                const itemIndex = selectedIndex - globalIndex;
                void onActivateSuggestion(catIndex, itemIndex);
                return;
              }
              globalIndex += category.items.length;
            }
          } else if (selectedResult) {
            void onLaunch(selectedResult);
          }
          break;

        case KEYS.ESCAPE: {
          e.preventDefault();
          const action = resolveEscapeAction(escapeBehavior, searchQuery);
          setSearchQuery('');
          setResults([]);
          setSelectedIndex(0);
          if (action === 'hide') {
            hideWindow().catch((err: unknown) => logger.error('hideWindow failed:', err));
          }
          break;
        }
      }
    },
    [
      setSelectedIndex,
      setSearchQuery,
      setResults,
      hideWindow,
      closeOnLaunch,
      escapeBehavior,
      listNavigation,
      onLaunch,
      onActivateSuggestion,
      onShowProperties,
      onOpenSettings,
      onOpenHelp,
      onTogglePreview,
      onOpenActionsMenu,
    ]
  );

  return { handleKeyDown };
}
