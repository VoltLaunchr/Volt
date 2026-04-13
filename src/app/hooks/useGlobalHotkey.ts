import { invoke } from '@tauri-apps/api/core';
import type React from 'react';
import { useCallback, useEffect } from 'react';
import { applicationService } from '../../features/applications/services/applicationService';
import { defaultSuggestions } from '../../shared/constants/suggestions';
import { KEYS } from '../../shared/constants/keys';
import { AppInfo, FileInfo, SearchResult, SearchResultType } from '../../shared/types/common.types';
import { logger } from '../../shared/utils/logger';
import { useSearchStore } from '../../stores/searchStore';

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
  hideWindow: () => Promise<void>;
  onLaunch: (result: SearchResult) => void | Promise<void>;
  onActivateSuggestion: (categoryIndex: number, itemIndex: number) => void | Promise<void>;
  onShowProperties: (result: SearchResult) => void;
  onOpenSettings: () => void | Promise<void>;
  onOpenCalculator: () => void;
  onOpenHelp: () => void;
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
  hideWindow,
  onLaunch,
  onActivateSuggestion,
  onShowProperties,
  onOpenSettings,
  onOpenCalculator,
  onOpenHelp,
}: UseGlobalHotkeyOptions): UseGlobalHotkeyResult {
  const results = useSearchStore((s) => s.results);
  const selectedIndex = useSearchStore((s) => s.selectedIndex);
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const { setSelectedIndex, setQuery: setSearchQuery, setResults } = useSearchStore.getState();
  // Setup global keyboard shortcuts (F1 / ? for help)
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
    const handleOpenSettings = () => {
      void onOpenSettings();
    };
    const handleOpenCalculator = () => {
      onOpenCalculator();
    };

    window.addEventListener('volt:open-settings', handleOpenSettings);
    window.addEventListener('volt:open-calculator', handleOpenCalculator);

    return () => {
      window.removeEventListener('volt:open-settings', handleOpenSettings);
      window.removeEventListener('volt:open-calculator', handleOpenCalculator);
    };
  }, [onOpenSettings, onOpenCalculator]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
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

      // --- Ctrl+K: Clear input ---
      if (e.key === 'k' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setSearchQuery('');
        setResults([]);
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
        hideWindow().catch((err) => logger.error(err));
        return;
      }

      // --- F1 / ?: Show help dialog ---
      if (e.key === 'F1' || (e.key === '?' && !e.ctrlKey && !e.altKey && !searchQuery.trim())) {
        e.preventDefault();
        onOpenHelp();
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
        applicationService.launchApplication(dirPath);
        return;
      }

      // --- Ctrl+I: Show item info (properties) ---
      if (e.key === 'i' && e.ctrlKey && !e.shiftKey && !e.altKey && selectedResult) {
        e.preventDefault();
        onShowProperties(selectedResult);
        return;
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
        navigator.clipboard.writeText(path);
        return;
      }

      // --- Ctrl+Delete: Remove from history ---
      if (e.key === 'Delete' && e.ctrlKey && !e.shiftKey && !e.altKey && selectedResult) {
        e.preventDefault();
        // Remove from history if it's an app or file
        if (selectedResult.type === SearchResultType.Application) {
          const appData = selectedResult.data as AppInfo;
          invoke('remove_from_history', { path: appData.path }).catch((err) => logger.error(err));
          // Remove from current results
          setResults(results.filter((r) => r.id !== selectedResult.id));
        }
        return;
      }

      // --- Shift+Enter: Execute as administrator ---
      if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && selectedResult) {
        e.preventDefault();
        // Launch as admin (Windows-specific via Tauri command)
        if (
          selectedResult.type === SearchResultType.Application ||
          selectedResult.type === SearchResultType.File
        ) {
          const path =
            selectedResult.type === SearchResultType.File
              ? (selectedResult.data as FileInfo).path
              : (selectedResult.data as AppInfo).path;
          invoke('launch_application', { path, asAdmin: true })
            .then(() => {
              if (closeOnLaunch) {
                hideWindow();
              }
              setSearchQuery('');
              setResults([]);
            })
            .catch((err) => logger.error(err));
        }
        return;
      }

      // --- Ctrl+Enter: Execute in background (don't close window) ---
      if (e.key === 'Enter' && e.ctrlKey && !e.shiftKey && !e.altKey && selectedResult) {
        e.preventDefault();
        // Launch without hiding window
        if (selectedResult.type === SearchResultType.Application) {
          const appData = selectedResult.data as { path: string };
          applicationService.launchApplication(appData.path).catch((err) => logger.error(err));
        } else if (selectedResult.type === SearchResultType.File) {
          const fileData = selectedResult.data as FileInfo;
          applicationService.launchApplication(fileData.path).catch((err) => logger.error(err));
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

        case KEYS.ESCAPE:
          e.preventDefault();
          setSearchQuery('');
          setResults([]);
          hideWindow().catch((err) => logger.error(err));
          break;
      }
    },
    [
      results,
      selectedIndex,
      searchQuery,
      setSelectedIndex,
      setSearchQuery,
      setResults,
      hideWindow,
      closeOnLaunch,
      onLaunch,
      onActivateSuggestion,
      onShowProperties,
      onOpenSettings,
      onOpenHelp,
    ]
  );

  return { handleKeyDown };
}
