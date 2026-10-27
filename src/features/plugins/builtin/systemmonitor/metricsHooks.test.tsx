import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useSystemMetricsV2 } from './useSystemMetricsV2';
import { useMetricsHistory } from './useMetricsHistory';
import type { SystemMetricsV2 } from './types';

vi.mock('../../../../shared/utils/logger', () => ({ logger: { warn: vi.fn() } }));

const metrics: SystemMetricsV2 = {
  cpuUsage: 42,
  memoryUsage: 65,
  diskUsage: 75,
  memoryUsedGb: 10.4,
  memoryTotalGb: 16,
  diskUsedGb: 750,
  diskTotalGb: 1000,
  perCoreCpu: [],
  perDisk: [],
  components: [],
  topCpuProcesses: [],
  topMemoryProcesses: [],
  uptimeSeconds: 3600,
  network: { receivedBytesPerSec: 1200, transmittedBytesPerSec: 400, interfaces: [] },
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('system metric polling', () => {
  it('stops requests while paused and immediately refreshes on resume', async () => {
    vi.mocked(invoke).mockResolvedValue(metrics);
    const { result, rerender } = renderHook(({ enabled }) => useSystemMetricsV2(1000, enabled), {
      initialProps: { enabled: true },
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.metrics).toEqual(metrics);
    rerender({ enabled: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    rerender({ enabled: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('does not stack slow polling requests or apply a result after pause', async () => {
    let finish!: (value: SystemMetricsV2) => void;
    vi.mocked(invoke).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const { result, rerender } = renderHook(({ enabled }) => useSystemMetricsV2(1000, enabled), {
      initialProps: { enabled: true },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    rerender({ enabled: false });
    await act(async () => {
      finish(metrics);
      await Promise.resolve();
    });
    expect(result.current.metrics).toBeNull();
  });
  it('exposes failure and retry while retaining previous measurements', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(metrics)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ...metrics, cpuUsage: 43 });
    const { result } = renderHook(() => useSystemMetricsV2(1000));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.error).toBe('offline');
    expect(result.current.metrics?.cpuUsage).toBe(42);
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.metrics?.cpuUsage).toBe(43);
  });
});

describe('metric history', () => {
  it('caps by elapsed time as well as count at a slow sampling cadence', () => {
    vi.setSystemTime(1_000_000);
    const { result, rerender } = renderHook(({ value }) => useMetricsHistory(value, 90, 90), {
      initialProps: { value: metrics },
    });
    for (let sample = 1; sample <= 10; sample++) {
      vi.setSystemTime(1_000_000 + sample * 30_000);
      rerender({ value: { ...metrics, cpuUsage: sample } });
    }
    expect(result.current).toHaveLength(4);
    expect(result.current[0].timestamp).toBe(1_210_000);
  });
  it('does not append duplicate snapshots and keeps the configured count bound', () => {
    const { result, rerender } = renderHook(({ value }) => useMetricsHistory(value, 2), {
      initialProps: { value: metrics },
    });
    rerender({ value: metrics });
    expect(result.current).toHaveLength(1);
    rerender({ value: { ...metrics, cpuUsage: 43 } });
    rerender({ value: { ...metrics, cpuUsage: 44 } });
    expect(result.current.map((sample) => sample.cpuUsage)).toEqual([43, 44]);
  });
});
