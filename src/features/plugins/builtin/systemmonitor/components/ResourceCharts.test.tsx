import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CapacityChart, CoreCharts, ProcessChart, StorageChart } from './ResourceCharts';
import { capacityValues, processChartData } from './resourceChartData';
import en from '../locales/en.json';
import { MemoryPanel } from './MemoryPanel';
import { ProcessPanel } from './ProcessPanel';
vi.mock('../../../../../components/charts/bklit/ring-chart', () => ({
  RingChart: ({ data }: { data: unknown }) => (
    <div data-testid="ring-data" data-values={JSON.stringify(data)} />
  ),
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
describe('real resource chart data', () => {
  it('uses actual occupied and available capacity, with percentage derived from those values', () => {
    render(<CapacityChart label="Memory" used={12} total={16} />);
    expect(screen.getByText('12.0 GiB')).toBeInTheDocument();
    expect(screen.getByText('4.0 GiB')).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('ring-data').dataset.values!)).toMatchObject([
      { value: 75, maxValue: 100 },
    ]);
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Memory: 12.0 GiB used, 4.0 GiB free, 16.0 GiB total'
    );
  });
  it('handles zero capacity without displaying NaN or a fabricated full volume', () => {
    expect(capacityValues(0, 0)).toEqual({ used: 0, free: 0, total: 0, percent: 0 });
    expect(capacityValues(20, 10)).toEqual({ used: 10, free: 0, total: 10, percent: 100 });
  });
  it('preserves multicore process CPU above 100% beside its process identity', () => {
    const processes = [
      { pid: 123, name: 'worker.exe', cpuUsagePercent: 240, memoryBytes: 20 * 1024 * 1024 },
    ];
    render(<ProcessChart processes={processes} sort="cpu" />);
    expect(screen.getByRole('listitem')).toHaveTextContent('worker.exePID 123240.0%');
  });
  it('switches ranked process data to true MiB amounts rather than CPU percentages', () => {
    const processes = [
      { pid: 123, name: 'worker.exe', cpuUsagePercent: 240, memoryBytes: 20 * 1024 * 1024 },
    ];
    const { rerender } = render(<ProcessChart processes={processes} sort="cpu" />);
    rerender(<ProcessChart processes={processes} sort="memory" />);
    expect(screen.getByRole('listitem')).toHaveTextContent('worker.exePID 12320 MiB');
    expect(screen.queryByText('240.0%')).not.toBeInTheDocument();
  });
  it('shows all sixteen core measurements directly without requiring chart hover', () => {
    const cores = Array.from({ length: 16 }, (_, i) => ({
      name: `cpu${i}`,
      usagePercent: i * 5,
      frequencyMhz: 3000,
    }));
    render(<CoreCharts cores={cores} />);
    const tiles = screen.getAllByRole('listitem');
    expect(tiles).toHaveLength(16);
    tiles.forEach((tile, index) => expect(tile).toHaveTextContent(`C${index + 1}${index * 5}%`));
  });
  it('keeps separate bars for processes with the same executable name', () => {
    const data = processChartData(
      [
        { pid: 1, name: 'node.exe', cpuUsagePercent: 80, memoryBytes: 1024 },
        { pid: 2, name: 'node.exe', cpuUsagePercent: 30, memoryBytes: 2048 },
      ],
      'cpu'
    );
    expect(new Set(data.map((process) => process.name)).size).toBe(2);
  });
  it('retains all thirty-two core measurements on larger CPUs', () => {
    const cores = Array.from({ length: 32 }, (_, i) => ({
      name: `cpu${i}`,
      usagePercent: i,
      frequencyMhz: 3000,
    }));
    render(<CoreCharts cores={cores} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(32);
    expect(screen.getAllByRole('listitem').at(-1)).toHaveTextContent('C3231%');
  });
  it('identifies each volume with its own capacity rather than adding percentages together', () => {
    render(
      <StorageChart
        disks={[
          {
            mountPoint: 'C:',
            kind: 'SSD',
            fileSystem: 'NTFS',
            totalGb: 100,
            usedGb: 75,
            availableGb: 25,
          },
          {
            mountPoint: 'D:',
            kind: 'SSD',
            fileSystem: 'NTFS',
            totalGb: 200,
            usedGb: 50,
            availableGb: 150,
          },
        ]}
      />
    );
    expect(screen.getAllByRole('img').map((chart) => chart.getAttribute('aria-label'))).toEqual([
      'C:: 75.0 GiB used, 25.0 GiB free, 100.0 GiB total',
      'D:: 50.0 GiB used, 150.0 GiB free, 200.0 GiB total',
    ]);
    expect(
      screen
        .getAllByTestId('ring-data')
        .map((chart) => (JSON.parse(chart.dataset.values!) as { value: number }[])[0].value)
    ).toEqual([75, 25]);
  });
  it('derives critical memory pressure and free capacity from the measured amounts', () => {
    render(<MemoryPanel used={14.7} total={15.7} historyChart={<div>Actual history</div>} />);
    expect(screen.getByRole('meter', { name: 'Memory' })).toHaveAttribute(
      'aria-valuenow',
      String((14.7 / 15.7) * 100)
    );
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('1.0 GiB free')).toBeInTheDocument();
    expect(screen.getByText('Actual history')).toBeInTheDocument();
  });
  it('shows the multicore CPU convention only when ranking by CPU', () => {
    const props = { processes: [], onSort: vi.fn(), onStop: vi.fn() };
    const { rerender } = render(<ProcessPanel {...props} processSort="cpu" />);
    expect(screen.getByText(en.dashboard.cpuConvention)).toBeInTheDocument();
    rerender(<ProcessPanel {...props} processSort="memory" />);
    expect(screen.queryByText(en.dashboard.cpuConvention)).not.toBeInTheDocument();
  });
  it('limits process chart to the same top five actual entries as the process table', () => {
    const processes = Array.from({ length: 7 }, (_, i) => ({
      pid: i,
      name: `p${i}`,
      cpuUsagePercent: 300 - i * 10,
      memoryBytes: i * 1024 * 1024,
    }));
    expect(processChartData(processes, 'cpu')).toHaveLength(5);
    expect(processChartData(processes, 'cpu')[0].value).toBe(300);
  });
});
