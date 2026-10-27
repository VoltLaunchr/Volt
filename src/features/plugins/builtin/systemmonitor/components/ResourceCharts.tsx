import React from 'react';
import { useTranslation } from 'react-i18next';
import { RingChart } from '../../../../../components/charts/bklit/ring-chart';
import { Ring } from '../../../../../components/charts/bklit/ring';
import type { CpuCoreInfo, ProcessInfo, DiskInfo } from '../types';
import { capacityValues, processChartData } from './resourceChartData';
import { CoreTiles } from './CpuCorePanel';

export function CapacityChart({
  label,
  used,
  total,
  kind,
  compact = false,
}: {
  label: string;
  used: number;
  total: number;
  kind?: string;
  compact?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('systemmonitor');
  const capacity = capacityValues(used, total);
  const text = t('dashboard.capacitySummary', {
    used: capacity.used.toFixed(1),
    free: capacity.free.toFixed(1),
    total: capacity.total.toFixed(1),
  });
  return (
    <div className={`sm-capacity ${compact ? 'is-compact' : ''}`}>
      <div className="sm-capacity-ring" role="img" aria-label={`${label}: ${text}`} title={text}>
        <RingChart
          data={[
            {
              label: t('dashboard.usedSpace'),
              value: capacity.percent,
              maxValue: 100,
              color: 'var(--sm-series)',
            },
          ]}
          size={compact ? 92 : 128}
          strokeWidth={compact ? 7 : 9}
          baseInnerRadius={compact ? 30 : 44}
          animationDuration={0}
          enterStaggerScale={0}
        >
          <Ring index={0} animate={false} showGlow={false} />
        </RingChart>
        <div className="sm-capacity-center" aria-hidden="true">
          <strong>
            {Math.round(capacity.percent)}
            <small>%</small>
          </strong>
          <span>{t('dashboard.occupied')}</span>
        </div>
      </div>
      <div className="sm-capacity-legend">
        <div className="sm-capacity-heading">
          <strong>{label}</strong>
          {kind && <span className="sm-kind">{kind}</span>}
        </div>
        <div>
          <span className="sm-legend-dot is-used" />
          {t('dashboard.usedSpace')}
          <strong>
            {capacity.used.toFixed(1)} {t('dashboard.gb')}
          </strong>
        </div>
        <div>
          <span className="sm-legend-dot is-free" />
          {t('dashboard.freeSpace')}
          <strong>
            {capacity.free.toFixed(1)} {t('dashboard.gb')}
          </strong>
        </div>
        <p>{t('dashboard.totalSpace', { value: capacity.total.toFixed(1) })}</p>
      </div>
    </div>
  );
}

export function CoreCharts({ cores }: { cores: CpuCoreInfo[] }): React.JSX.Element {
  return <CoreTiles cores={cores} />;
}

export function ProcessChart({
  processes,
  sort,
}: {
  processes: ProcessInfo[];
  sort: 'cpu' | 'memory';
}): React.JSX.Element {
  const { t } = useTranslation('systemmonitor');
  const data = processChartData(processes, sort);
  const maximum = Math.max(1, ...data.map((datum) => datum.value));
  const format = (value: number) =>
    sort === 'cpu' ? `${value.toFixed(1)}%` : `${Math.round(value)} ${t('dashboard.mb')}`;
  return (
    <ol
      className={`sm-process-chart ${sort === 'cpu' ? 'sm-cpu' : 'sm-memory'}`}
      aria-label={t('dashboard.processes')}
    >
      {data.map((datum, index) => (
        <li
          className="sm-process-row"
          key={datum.pid}
          style={
            { '--sm-load': `${Math.max(0, (datum.value / maximum) * 100)}%` } as React.CSSProperties
          }
        >
          <span className="sm-process-badge" aria-hidden="true">
            {processes[index].name
              .replace(/[^a-z0-9]/gi, '')
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <div className="sm-process-identity">
            <strong title={processes[index].name}>{processes[index].name}</strong>
            <span>PID {datum.pid}</span>
          </div>
          <div className="sm-process-measure">
            <strong className="sm-process-value">{format(datum.value)}</strong>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function StorageChart({
  disks,
  expanded = false,
}: {
  disks: DiskInfo[];
  expanded?: boolean;
}): React.JSX.Element {
  return (
    <div className={`sm-storage-volumes ${expanded ? 'is-expanded' : ''}`}>
      {disks.map((disk) => (
        <CapacityChart
          key={disk.mountPoint}
          label={disk.mountPoint}
          used={disk.usedGb}
          total={disk.totalGb}
          kind={disk.kind}
          compact={!expanded}
        />
      ))}
    </div>
  );
}
