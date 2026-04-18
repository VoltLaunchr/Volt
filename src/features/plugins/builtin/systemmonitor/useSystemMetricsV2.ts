import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '../../../../shared/utils/logger';
import type { SystemMetricsV2 } from './types';

interface UseSystemMetricsV2Result {
  metrics: SystemMetricsV2 | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Polls `get_system_metrics_v2` on a fixed interval while mounted. The backend
 * already caches via a 5s ticker, so polling here is a read from RAM — cheap.
 * We serialize requests with an in-flight flag so a slow IPC never stacks.
 */
export function useSystemMetricsV2(intervalMs: number = 1000): UseSystemMetricsV2Result {
  const [metrics, setMetrics] = useState<SystemMetricsV2 | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const next = await invoke<SystemMetricsV2>('get_system_metrics_v2');
        if (cancelled) return;
        setMetrics(next);
        setError(null);
        setIsLoading(false);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('useSystemMetricsV2 poll failed:', msg);
        setError(msg);
        setIsLoading(false);
      } finally {
        inFlight.current = false;
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [intervalMs]);

  return { metrics, isLoading, error };
}
