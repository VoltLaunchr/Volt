import { describe, expect, it } from 'vitest';
import { buildMetricsCsv, formatBytesPerSec } from './utils';
import type { SystemMetricsV2 } from './types';

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
describe('system monitor CSV export', () => {
  it.each(['=1+1', '+SUM(1)', '-1+2', '@SUM(1)', '  =1+1', '\tformula'])(
    'preserves formula-looking process names as literal text: %s',
    (name) => {
      const csv = buildMetricsCsv(
        {
          ...metrics,
          topCpuProcesses: [{ pid: 42, name, cpuUsagePercent: 240, memoryBytes: 1048576 }],
        },
        []
      );
      expect(csv).toContain(`42,'${name},240.00,1.0`);
      expect(csv).toMatch(/^\ufeffSection,Key,Value/);
    }
  );
  it('escapes delimiters and preserves numeric process CPU above 100%', () => {
    const csv = buildMetricsCsv(
      {
        ...metrics,
        topCpuProcesses: [
          { pid: 42, name: 'process,"quoted".exe', cpuUsagePercent: 240, memoryBytes: 1048576 },
        ],
      },
      []
    );
    expect(csv).toContain('42,"process,""quoted"".exe",240.00,1.0');
  });
});
describe('network rate formatting', () => {
  it('uses binary rates and never prints NaN or Infinity', () => {
    expect(formatBytesPerSec(1024)).toBe('1.00 KiB/s');
    expect(formatBytesPerSec(Infinity)).toBe('0 B/s');
  });
});
