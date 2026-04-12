/**
 * Hook for managing pinned/favorite applications
 */

import { useCallback, useEffect, useState } from 'react';
import { launcherService } from '../services/launcherService';
import type { LaunchRecord } from '../types/launcher.types';

export interface UsePinnedAppsReturn {
  /** List of pinned/favorite apps */
  pinnedApps: LaunchRecord[];
  /** Whether data is loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh the pinned apps list */
  refresh: () => Promise<void>;
  /** Pin an app to favorites */
  pinApp: (path: string) => Promise<void>;
  /** Unpin an app from favorites */
  unpinApp: (path: string) => Promise<void>;
  /** Check if an app is pinned */
  isPinned: (path: string) => boolean;
  /** Toggle pin state */
  togglePin: (path: string) => Promise<void>;
  /** Launch a pinned app */
  launchApp: (path: string) => Promise<void>;
}

/**
 * Hook for managing pinned/favorite applications
 *
 * @param autoLoad - Whether to load on mount (default: true)
 * @returns Pinned apps state and actions
 *
 * @example
 * ```tsx
 * const { pinnedApps, pinApp, unpinApp, isPinned, togglePin } = usePinnedApps();
 *
 * return (
 *   <div>
 *     <h3>Favorites</h3>
 *     {pinnedApps.map(app => (
 *       <div key={app.path}>
 *         <span>{app.name}</span>
 *         <button onClick={() => togglePin(app.path)}>
 *           {isPinned(app.path) ? '★' : '☆'}
 *         </button>
 *       </div>
 *     ))}
 *   </div>
 * );
 * ```
 */
export function usePinnedApps(autoLoad = true): UsePinnedAppsReturn {
  const [pinnedApps, setPinnedApps] = useState<LaunchRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const apps = await launcherService.getPinnedApps();
      setPinnedApps(apps);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const pinApp = useCallback(
    async (path: string) => {
      try {
        await launcherService.pinApp(path);
        await refresh();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        throw err;
      }
    },
    [refresh]
  );

  const unpinApp = useCallback(
    async (path: string) => {
      try {
        await launcherService.unpinApp(path);
        await refresh();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        throw err;
      }
    },
    [refresh]
  );

  const isPinned = useCallback(
    (path: string) => {
      return pinnedApps.some((app) => app.path === path);
    },
    [pinnedApps]
  );

  const togglePin = useCallback(
    async (path: string) => {
      if (isPinned(path)) {
        await unpinApp(path);
      } else {
        await pinApp(path);
      }
    },
    [isPinned, pinApp, unpinApp]
  );

  const launchApp = useCallback(async (path: string) => {
    try {
      await launcherService.launchApp(path);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      throw err;
    }
  }, []);

  // Auto-load on mount
  useEffect(() => {
    if (autoLoad) {
      refresh();
    }
  }, [autoLoad, refresh]);

  return {
    pinnedApps,
    isLoading,
    error,
    refresh,
    pinApp,
    unpinApp,
    isPinned,
    togglePin,
    launchApp,
  };
}

export default usePinnedApps;
