/**
 * Hook for managing applications state
 * Handles loading, caching, and refreshing applications
 */

import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppInfo } from '../../../shared/types/common.types';
import { applicationService } from '../services/applicationService';
import type { ApplicationsState, ScanStatus } from '../types';
import { INITIAL_APPLICATIONS_STATE } from '../types';

export interface UseApplicationsReturn {
  /** All loaded applications */
  apps: AppInfo[];
  /** Whether applications are currently loading */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Current scan status */
  scanStatus: ScanStatus;
  /** Timestamp of last refresh */
  lastRefresh: number | null;
  /** Refresh applications from system */
  refresh: () => Promise<void>;
  /** Clear the current error */
  clearError: () => void;
}

/**
 * Hook for managing the applications list
 * Automatically loads applications on mount and provides refresh functionality
 *
 * @param autoLoad - Whether to automatically load applications on mount (default: true)
 * @returns Applications state and control functions
 *
 * @example
 * ```tsx
 * const { apps, isLoading, error, refresh } = useApplications();
 *
 * if (isLoading) return <Spinner />;
 * if (error) return <ErrorMessage message={error} onRetry={refresh} />;
 *
 * return <AppList apps={apps} />;
 * ```
 */
export function useApplications(autoLoad = true): UseApplicationsReturn {
  const [state, setState] = useState<ApplicationsState>(INITIAL_APPLICATIONS_STATE);
  const iconLoadAbort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    // Abort any in-progress icon loading
    iconLoadAbort.current?.abort();

    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      scanStatus: {
        isScanning: true,
        progress: 0,
        appsFound: 0,
        startedAt: Date.now(),
      },
    }));

    try {
      const apps = await applicationService.scanApplications();

      // Set apps immediately (without icons) so the UI is usable right away
      setState((prev) => ({
        ...prev,
        apps,
        isLoading: false,
        error: null,
        scanStatus: {
          isScanning: false,
          progress: 100,
          appsFound: apps.length,
          completedAt: Date.now(),
        },
        lastRefresh: Date.now(),
      }));

      // Load icons lazily in the background (batches of 10)
      const abortCtrl = new AbortController();
      iconLoadAbort.current = abortCtrl;
      const BATCH_SIZE = 10;
      const appsNeedingIcons = apps.filter((a) => !a.icon);

      for (let i = 0; i < appsNeedingIcons.length; i += BATCH_SIZE) {
        if (abortCtrl.signal.aborted) break;

        const batch = appsNeedingIcons.slice(i, i + BATCH_SIZE);
        const iconResults = await Promise.all(
          batch.map((app) =>
            invoke<string | null>('get_app_icon', { path: app.path }).catch(() => null)
          )
        );

        if (abortCtrl.signal.aborted) break;

        // Update state with newly loaded icons
        setState((prev) => {
          const updatedApps = prev.apps.map((app) => {
            const batchIdx = batch.findIndex((b) => b.id === app.id);
            if (batchIdx !== -1 && iconResults[batchIdx]) {
              return { ...app, icon: iconResults[batchIdx] };
            }
            return app;
          });
          return { ...prev, apps: updatedApps };
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
        scanStatus: {
          ...prev.scanStatus,
          isScanning: false,
          error: errorMessage,
        },
      }));
    }
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      error: null,
      scanStatus: {
        ...prev.scanStatus,
        error: undefined,
      },
    }));
  }, []);

  // Auto-load on mount if enabled
  useEffect(() => {
    if (autoLoad) {
      refresh();
    }
  }, [autoLoad, refresh]);

  return {
    apps: state.apps,
    isLoading: state.isLoading,
    error: state.error,
    scanStatus: state.scanStatus,
    lastRefresh: state.lastRefresh,
    refresh,
    clearError,
  };
}

export default useApplications;
