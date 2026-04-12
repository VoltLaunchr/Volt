/**
 * Hook for accessing recent applications
 * Lightweight alternative to useLauncher when only recent apps are needed
 */

import { useCallback, useEffect, useState } from 'react';
import { launcherService } from '../services/launcherService';
import type { LaunchRecord } from '../types/launcher.types';

export interface UseRecentAppsOptions {
  /** Maximum number of recent apps to fetch (default: 10) */
  limit?: number;
  /** Auto-refresh interval in ms (0 = disabled) */
  refreshInterval?: number;
  /** Whether to load on mount (default: true) */
  autoLoad?: boolean;
}

export interface UseRecentAppsReturn {
  /** List of recently launched apps */
  recentApps: LaunchRecord[];
  /** Whether data is loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh the recent apps list */
  refresh: () => Promise<void>;
  /** Launch an app (updates recent list automatically) */
  launchApp: (path: string) => Promise<void>;
}

/**
 * Hook for accessing recently launched applications
 *
 * @param options - Configuration options
 * @returns Recent apps state and actions
 *
 * @example
 * ```tsx
 * const { recentApps, launchApp, isLoading } = useRecentApps({ limit: 5 });
 *
 * return (
 *   <div>
 *     <h3>Recent</h3>
 *     {isLoading ? <Spinner /> : (
 *       recentApps.map(app => (
 *         <button key={app.path} onClick={() => launchApp(app.path)}>
 *           {app.name}
 *         </button>
 *       ))
 *     )}
 *   </div>
 * );
 * ```
 */
export function useRecentApps(options: UseRecentAppsOptions = {}): UseRecentAppsReturn {
  const { limit = 10, refreshInterval = 0, autoLoad = true } = options;

  const [recentApps, setRecentApps] = useState<LaunchRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const apps = await launcherService.getRecentApps(limit);
      setRecentApps(apps);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  const launchApp = useCallback(
    async (path: string) => {
      try {
        await launcherService.launchApp(path);
        // Refresh to show updated order
        await refresh();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        throw err;
      }
    },
    [refresh]
  );

  // Auto-load on mount
  useEffect(() => {
    if (autoLoad) {
      refresh();
    }
  }, [autoLoad, refresh]);

  // Auto-refresh interval
  useEffect(() => {
    if (refreshInterval > 0) {
      const intervalId = setInterval(refresh, refreshInterval);
      return () => clearInterval(intervalId);
    }
  }, [refreshInterval, refresh]);

  return {
    recentApps,
    isLoading,
    error,
    refresh,
    launchApp,
  };
}

export default useRecentApps;
