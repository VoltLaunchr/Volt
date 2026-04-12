/**
 * Hook for accessing frequently used applications
 * Lightweight alternative to useLauncher when only frequent apps are needed
 */

import { useCallback, useEffect, useState } from 'react';
import { launcherService } from '../services/launcherService';
import type { LaunchRecord } from '../types/launcher.types';

export interface UseFrequentAppsOptions {
  /** Maximum number of frequent apps to fetch (default: 10) */
  limit?: number;
  /** Auto-refresh interval in ms (0 = disabled) */
  refreshInterval?: number;
  /** Whether to load on mount (default: true) */
  autoLoad?: boolean;
}

export interface UseFrequentAppsReturn {
  /** List of most frequently launched apps */
  frequentApps: LaunchRecord[];
  /** Whether data is loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh the frequent apps list */
  refresh: () => Promise<void>;
  /** Launch an app (updates list automatically) */
  launchApp: (path: string) => Promise<void>;
}

/**
 * Hook for accessing most frequently launched applications
 *
 * @param options - Configuration options
 * @returns Frequent apps state and actions
 *
 * @example
 * ```tsx
 * const { frequentApps, launchApp } = useFrequentApps({ limit: 5 });
 *
 * return (
 *   <div>
 *     <h3>Most Used</h3>
 *     {frequentApps.map(app => (
 *       <div key={app.path}>
 *         <span>{app.name}</span>
 *         <small>{app.launchCount} launches</small>
 *         <button onClick={() => launchApp(app.path)}>Open</button>
 *       </div>
 *     ))}
 *   </div>
 * );
 * ```
 */
export function useFrequentApps(options: UseFrequentAppsOptions = {}): UseFrequentAppsReturn {
  const { limit = 10, refreshInterval = 0, autoLoad = true } = options;

  const [frequentApps, setFrequentApps] = useState<LaunchRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const apps = await launcherService.getFrequentApps(limit);
      setFrequentApps(apps);
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
        // Refresh to show updated counts
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
    frequentApps,
    isLoading,
    error,
    refresh,
    launchApp,
  };
}

export default useFrequentApps;
