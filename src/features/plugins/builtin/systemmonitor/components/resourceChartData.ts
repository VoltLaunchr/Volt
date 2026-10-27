import type { ProcessInfo } from '../types';

export function capacityValues(
  used: number,
  total: number
): { used: number; free: number; total: number; percent: number } {
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  const safeUsed = Number.isFinite(used) ? Math.max(0, Math.min(safeTotal, used)) : 0;
  return {
    used: safeUsed,
    free: safeTotal - safeUsed,
    total: safeTotal,
    percent: safeTotal > 0 ? (safeUsed / safeTotal) * 100 : 0,
  };
}

export function processChartData(
  processes: ProcessInfo[],
  sort: 'cpu' | 'memory'
): { name: string; value: number; pid: number }[] {
  return processes.slice(0, 5).map((process) => ({
    name: `${process.name} · ${process.pid}`,
    value: sort === 'cpu' ? process.cpuUsagePercent : process.memoryBytes / 1024 / 1024,
    pid: process.pid,
  }));
}
