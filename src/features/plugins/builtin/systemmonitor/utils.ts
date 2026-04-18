import type { SystemMetricsV2 } from './types';
import type { MetricSample } from './useMetricsHistory';

/** IEC-binary (1024-based) bytes-per-second formatter. */
export function formatBytesPerSec(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B/s';
  const units = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s', 'TiB/s'];
  let value = n;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const digits = value >= 100 || idx === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[idx]}`;
}

/** Format uptime seconds as `Dd HHh MMm`. */
export function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  return `${days}d ${hours.toString().padStart(2, '0')}h ${mins.toString().padStart(2, '0')}m`;
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvEscape).join(',');
}

function timestampFile(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}`;
}

/** Build and trigger a CSV download of the current metrics + history. */
export function exportMetricsCsv(metrics: SystemMetricsV2, history: MetricSample[]): void {
  const lines: string[] = [];

  lines.push(csvRow(['Section', 'Key', 'Value']));
  lines.push(csvRow(['Summary', 'CPU %', metrics.cpuUsage.toFixed(2)]));
  lines.push(csvRow(['Summary', 'Memory %', metrics.memoryUsage.toFixed(2)]));
  lines.push(csvRow(['Summary', 'Memory Used GB', metrics.memoryUsedGb.toFixed(2)]));
  lines.push(csvRow(['Summary', 'Memory Total GB', metrics.memoryTotalGb.toFixed(2)]));
  lines.push(csvRow(['Summary', 'Disk %', metrics.diskUsage.toFixed(2)]));
  lines.push(csvRow(['Summary', 'Disk Used GB', metrics.diskUsedGb.toFixed(2)]));
  lines.push(csvRow(['Summary', 'Disk Total GB', metrics.diskTotalGb.toFixed(2)]));
  lines.push(csvRow(['Summary', 'Uptime seconds', metrics.uptimeSeconds]));

  lines.push('');
  lines.push(csvRow(['CPU Core', 'Frequency MHz', 'Usage %']));
  for (const c of metrics.perCoreCpu) {
    lines.push(csvRow([c.name, c.frequencyMhz, c.usagePercent.toFixed(2)]));
  }

  lines.push('');
  lines.push(csvRow(['Disk Mount', 'File System', 'Kind', 'Used GB', 'Total GB', 'Available GB']));
  for (const d of metrics.perDisk) {
    lines.push(
      csvRow([
        d.mountPoint,
        d.fileSystem,
        d.kind,
        d.usedGb.toFixed(2),
        d.totalGb.toFixed(2),
        d.availableGb.toFixed(2),
      ]),
    );
  }

  lines.push('');
  lines.push(csvRow(['Network Aggregate', 'RX B/s', 'TX B/s']));
  lines.push(
    csvRow(['total', metrics.network.receivedBytesPerSec, metrics.network.transmittedBytesPerSec]),
  );
  lines.push('');
  lines.push(csvRow(['Network Interface', 'RX B/s', 'TX B/s', 'Total RX bytes', 'Total TX bytes']));
  for (const iface of metrics.network.interfaces) {
    lines.push(
      csvRow([
        iface.name,
        iface.receivedBytesPerSec,
        iface.transmittedBytesPerSec,
        iface.totalReceivedBytes,
        iface.totalTransmittedBytes,
      ]),
    );
  }

  lines.push('');
  lines.push(csvRow(['Top CPU PID', 'Name', 'CPU %', 'Memory MB']));
  for (const p of metrics.topCpuProcesses) {
    lines.push(
      csvRow([p.pid, p.name, p.cpuUsagePercent.toFixed(2), (p.memoryBytes / (1024 * 1024)).toFixed(1)]),
    );
  }

  lines.push('');
  lines.push(csvRow(['Top Memory PID', 'Name', 'CPU %', 'Memory MB']));
  for (const p of metrics.topMemoryProcesses) {
    lines.push(
      csvRow([p.pid, p.name, p.cpuUsagePercent.toFixed(2), (p.memoryBytes / (1024 * 1024)).toFixed(1)]),
    );
  }

  lines.push('');
  lines.push(csvRow(['History timestamp ISO', 'CPU %', 'Memory %', 'Disk %', 'RX B/s', 'TX B/s']));
  for (const s of history) {
    lines.push(
      csvRow([
        new Date(s.timestamp).toISOString(),
        s.cpuUsage.toFixed(2),
        s.memoryUsage.toFixed(2),
        s.diskUsage.toFixed(2),
        s.networkRxBps,
        s.networkTxBps,
      ]),
    );
  }

  // UTF-8 BOM so Excel opens the file as UTF-8 instead of the legacy code page.
  const csv = '\ufeff' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `volt-metrics-${timestampFile(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
