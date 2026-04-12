/**
 * Hook for managing launcher state
 * Provides access to recent, frequent, and pinned apps with history tracking
 */

import { useCallback, useEffect, useState } from 'react';
import { launcherService } from '../services/launcherService';
import { logger } from '../../../shared/utils';
import type { LaunchRecord, LauncherState } from '../types/launcher.types';
import { INITIAL_LAUNCHER_STATE } from '../types/launcher.types';

export interface UseLauncherReturn {
  /** Recent apps list */
  recentApps: LaunchRecord[];
  /** Frequently used apps */
  frequentApps: LaunchRecord[];
  /** Pinned/favorite apps */
  pinnedApps: LaunchRecord[];
  /** All available tags */
  tags: string[];
  /** Whether data is loading */
  isLoading: boolean;
  /** Error if any */
  error: string | null;
  /** Launch an app with history tracking */
  launchApp: (path: string) => Promise<void>;
  /** Pin an app to favorites */
  pinApp: (path: string) => Promise<void>;
  /** Unpin an app */
  unpinApp: (path: string) => Promise<void>;
  /** Add a tag to an app */
  addTag: (path: string, tag: string) => Promise<void>;
  /** Remove a tag from an app */
  removeTag: (path: string, tag: string) => Promise<void>;
  /** Refresh all data */
  refresh: () => Promise<void>;
  /** Clear all history */
  clearHistory: () => Promise<void>;
}

/**
 * Hook for managing launcher functionality
 *
 * @param autoLoad - Whether to load data on mount (default: true)
 * @returns Launcher state and control functions
 *
 * @example
 * ```tsx
 * const { recentApps, pinnedApps, launchApp, pinApp } = useLauncher();
 *
 * return (
 *   <div>
 *     <h2>Recent Apps</h2>
 *     {recentApps.map(app => (
 *       <button key={app.path} onClick={() => launchApp(app.path)}>
 *         {app.name}
 *       </button>
 *     ))}
 *   </div>
 * );
 * ```
 */
export function useLauncher(autoLoad = true): UseLauncherReturn {
  const [state, setState] = useState<LauncherState>(INITIAL_LAUNCHER_STATE);

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const [recentApps, frequentApps, pinnedApps, tags] = await Promise.all([
        launcherService.getRecentApps(10),
        launcherService.getFrequentApps(10),
        launcherService.getPinnedApps(),
        launcherService.getAllTags(),
      ]);

      setState({
        recentApps,
        frequentApps,
        pinnedApps,
        tags,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
    }
  }, []);

  const launchApp = useCallback(
    async (path: string) => {
      try {
        await launcherService.launchApp(path);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('Failed to launch app:', errorMessage);
      } finally {
        // Refresh to update recent/frequent lists
        await refresh();
      }
    },
    [refresh]
  );

  const pinApp = useCallback(
    async (path: string) => {
      try {
        await launcherService.pinApp(path);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('Failed to pin app:', errorMessage);
      } finally {
        await refresh();
      }
    },
    [refresh]
  );

  const unpinApp = useCallback(
    async (path: string) => {
      try {
        await launcherService.unpinApp(path);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('Failed to unpin app:', errorMessage);
      } finally {
        await refresh();
      }
    },
    [refresh]
  );

  const addTag = useCallback(
    async (path: string, tag: string) => {
      try {
        await launcherService.addTag(path, tag);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('Failed to add tag:', errorMessage);
      } finally {
        await refresh();
      }
    },
    [refresh]
  );

  const removeTag = useCallback(
    async (path: string, tag: string) => {
      try {
        await launcherService.removeTag(path, tag);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('Failed to remove tag:', errorMessage);
      } finally {
        await refresh();
      }
    },
    [refresh]
  );

  const clearHistory = useCallback(async () => {
    try {
      await launcherService.clearHistory();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('Failed to clear history:', errorMessage);
    } finally {
      await refresh();
    }
  }, [refresh]);

  // Auto-load on mount
  useEffect(() => {
    if (autoLoad) {
      refresh();
    }
  }, [autoLoad, refresh]);

  return {
    recentApps: state.recentApps,
    frequentApps: state.frequentApps,
    pinnedApps: state.pinnedApps,
    tags: state.tags,
    isLoading: state.isLoading,
    error: state.error,
    launchApp,
    pinApp,
    unpinApp,
    addTag,
    removeTag,
    refresh,
    clearHistory,
  };
}

export default useLauncher;
