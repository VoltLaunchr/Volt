import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { SystemMonitorDashboard } from './SystemMonitorDashboard';
import { useSystemMetricsV2 } from '../useSystemMetricsV2';
import { exportMetricsCsv } from '../utils';
import en from '../locales/en.json';
import type { SystemMetricsV2 } from '../types';

vi.mock('./ResourceCharts', () => ({
  CapacityChart: () => null,
  CoreCharts: () => null,
  ProcessChart: () => null,
  StorageChart: () => null,
}));
vi.mock('../useSystemMetricsV2', () => ({ useSystemMetricsV2: vi.fn() }));
vi.mock('../../../../settings/behavior/useLiveSettings', () => ({ useLiveSettings: () => null }));
vi.mock('../useMetricsHistory', () => ({ useMetricsHistory: () => [] }));
vi.mock('../../../../../components/charts/live-line-chart', () => ({
  LiveLineChart: () => <div data-testid="bklit-chart" />,
}));
vi.mock('../utils', () => ({
  exportMetricsCsv: vi.fn(),
  formatBytesPerSec: (n: number) => `${n} B/s`,
  formatUptime: () => '1d 00h 00m',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, args?: Record<string, unknown>) => {
      const value = key
        .split('.')
        .reduce<unknown>((result, part) => (result as Record<string, unknown>)?.[part], en);
      return (typeof value === 'string' ? value : key).replace(/{{(\w+)}}/g, (_, name: string) =>
        typeof args?.[name] === 'string' || typeof args?.[name] === 'number' ? `${args[name]}` : ''
      );
    },
  }),
}));
const metrics: SystemMetricsV2 = {
  cpuUsage: 42,
  memoryUsage: 70,
  diskUsage: 65,
  memoryTotalGb: 16,
  memoryUsedGb: 11.2,
  diskTotalGb: 1000,
  diskUsedGb: 650,
  perCoreCpu: [{ name: 'cpu0', usagePercent: 42, frequencyMhz: 3000 }],
  perDisk: [
    {
      mountPoint: 'C:\\',
      kind: 'SSD',
      fileSystem: 'NTFS',
      totalGb: 1000,
      usedGb: 650,
      availableGb: 350,
    },
  ],
  network: { receivedBytesPerSec: 1024, transmittedBytesPerSec: 512, interfaces: [] },
  topCpuProcesses: [
    { pid: 123, name: 'worker.exe', cpuUsagePercent: 240, memoryBytes: 1024 * 1024 * 20 },
  ],
  topMemoryProcesses: [
    { pid: 456, name: 'editor.exe', cpuUsagePercent: 10, memoryBytes: 1024 * 1024 * 900 },
  ],
  uptimeSeconds: 86400,
  components: [],
};
const retry = vi.fn();
beforeEach(() => {
  vi.mocked(useSystemMetricsV2).mockReturnValue({ metrics, isLoading: false, error: null, retry });
  vi.mocked(invoke).mockResolvedValue(undefined);
});
describe('System Monitor dashboard', () => {
  it('pauses and resumes collection, rather than only changing chart cosmetics', () => {
    render(<SystemMonitorDashboard onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(vi.mocked(useSystemMetricsV2).mock.lastCall?.[1]).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(vi.mocked(useSystemMetricsV2).mock.lastCall?.[1]).toBe(true);
  });
  it('shows actionable initial load failures without fabricated zero measurements', () => {
    vi.mocked(useSystemMetricsV2).mockReturnValue({
      metrics: null,
      isLoading: false,
      error: 'offline',
      retry,
    });
    render(<SystemMonitorDashboard onClose={vi.fn()} />);
    expect(screen.getByText('Measurements unavailable')).toBeInTheDocument();
    expect(screen.queryByText('0.0')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });
  it('clearly marks retained metrics when sampling fails', () => {
    vi.mocked(useSystemMetricsV2).mockReturnValue({
      metrics,
      isLoading: false,
      error: 'offline',
      retry,
    });
    render(<SystemMonitorDashboard onClose={vi.fn()} />);
    expect(screen.getByText('Last available reading')).toBeInTheDocument();
    expect(screen.getByText('42.0')).toBeInTheDocument();
  });
  it('resumes collection when retrying a stale reading after pausing', () => {
    vi.mocked(useSystemMetricsV2).mockReturnValue({
      metrics,
      isLoading: false,
      error: 'offline',
      retry,
    });
    render(<SystemMonitorDashboard onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(vi.mocked(useSystemMetricsV2).mock.lastCall?.[1]).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(vi.mocked(useSystemMetricsV2).mock.lastCall?.[1]).toBe(true);
    expect(retry).toHaveBeenCalled();
  });
  it('switches process ordering and does not clamp multicore CPU percentages', () => {
    render(<SystemMonitorDashboard onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByText('240.0%')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort processes by resource' }), {
      target: { value: 'memory' },
    });
    expect(screen.getByText('editor.exe')).toBeInTheDocument();
    expect(screen.queryByText('worker.exe')).not.toBeInTheDocument();
  });
  it('navigates to network details and exposes unsupported temperature state in overview', () => {
    render(<SystemMonitorDashboard onClose={vi.fn()} />);
    expect(
      screen.getByText('Temperature sensors are not exposed by this system.')
    ).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'System resources' })).getByRole('button', {
        name: 'Network',
      })
    );
    expect(screen.queryByRole('heading', { name: 'Active processes' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Network', level: 2 })).toBeInTheDocument();
  });
  it('exports current actual measurements and history', () => {
    render(<SystemMonitorDashboard onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(exportMetricsCsv).toHaveBeenCalledWith(metrics, []);
  });
  it('requires explicit confirmation before terminating a process and supports cancellation', async () => {
    render(<SystemMonitorDashboard onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    fireEvent.click(screen.getByRole('button', { name: 'End worker.exe (PID 123)' }));
    const confirmation = await screen.findByRole('alertdialog');
    expect(invoke).not.toHaveBeenCalledWith('kill_process_by_pid', expect.anything());
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(invoke).not.toHaveBeenCalledWith('kill_process_by_pid', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'End worker.exe (PID 123)' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'End process' })
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('kill_process_by_pid', { pid: 123 }));
  });
  it('keeps termination failures readable inside the focused confirmation dialog', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Access denied'));
    render(<SystemMonitorDashboard onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    fireEvent.click(screen.getByRole('button', { name: 'End worker.exe (PID 123)' }));
    const confirmation = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'End process' }));
    expect(await within(confirmation).findByRole('alert')).toHaveTextContent('worker.exe');
    expect(within(confirmation).getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
});
