/**
 * Hook for managing applications state
 * Handles loading, caching, and refreshing applications
 */

import { useCallback, useEffect, useState } from 'react';
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

  const refresh = useCallback(async () => {
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
