import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '../../../../shared/utils/logger';
import type { SystemMetricsV2 } from './types';

interface UseSystemMetricsV2Result {
  metrics: SystemMetricsV2 | null;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Polls `get_system_metrics_v2` on a fixed interval while mounted. The backend
 * already caches via a 5s ticker, so polling here is a read from RAM — cheap.
 * We serialize requests with an in-flight flag so a slow IPC never stacks.
 */
export function useSystemMetricsV2(
  intervalMs: number = 1000,
  enabled = true
): UseSystemMetricsV2Result {
  const [metrics, setMetrics] = useState<SystemMetricsV2 | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const requestGeneration = ++generation.current;
    if (!enabled) return;

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await invoke<SystemMetricsV2>('get_system_metrics_v2');
        if (cancelled || generation.current !== requestGeneration) return;
        setMetrics(next);
        setError(null);
        setIsLoading(false);
      } catch (e) {
        if (cancelled || generation.current !== requestGeneration) return;
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('useSystemMetricsV2 poll failed:', msg);
        setError(msg);
        setIsLoading(false);
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), Math.max(500, intervalMs));
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [intervalMs, enabled, attempt]);

  return { metrics, isLoading, error, retry };
}
