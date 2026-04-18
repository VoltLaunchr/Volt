import { useEffect, useRef, useState } from 'react';
import type { SystemMetricsV2 } from './types';

export interface MetricSample {
  timestamp: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkRxBps: number;
  networkTxBps: number;
}

/**
 * Ring-buffer history of metric snapshots. Appends on every `metrics` change
 * and caps at `maxSamples` so the detail modal can render rolling sparklines
 * without leaking memory over a long session.
 */
export function useMetricsHistory(
  metrics: SystemMetricsV2 | null,
  maxSamples: number = 60,
): MetricSample[] {
  const [history, setHistory] = useState<MetricSample[]>([]);
  const lastRef = useRef<SystemMetricsV2 | null>(null);

  useEffect(() => {
    if (!metrics) return;
    if (lastRef.current === metrics) return;
    lastRef.current = metrics;

    const sample: MetricSample = {
      timestamp: Date.now(),
      cpuUsage: metrics.cpuUsage,
      memoryUsage: metrics.memoryUsage,
      diskUsage: metrics.diskUsage,
      networkRxBps: metrics.network.receivedBytesPerSec,
      networkTxBps: metrics.network.transmittedBytesPerSec,
    };
    setHistory((prev) => {
      const next = prev.length >= maxSamples ? prev.slice(prev.length - maxSamples + 1) : prev;
      return [...next, sample];
    });
  }, [metrics, maxSamples]);

  return history;
}
