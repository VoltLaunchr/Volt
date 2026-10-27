import React, { useMemo } from 'react';
import { ArrowDown, ArrowUp, Cpu, HardDrive, MemoryStick, Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AreaSparkline,
  LineSparkline,
  useSparklineHover,
} from '../../../../../components/charts/bklit/sparkline';
import { formatBytesPerSec } from '../utils';
import type { SystemMetricsV2 } from '../types';
import type { MetricSample } from '../useMetricsHistory';

type Tone = 'normal' | 'high' | 'critical';
const toneOf = (value: number): Tone =>
  value >= 90 ? 'critical' : value >= 75 ? 'high' : 'normal';
const NOTCHES = 24;

interface KpiTileProps {
  kind: 'cpu' | 'memory' | 'disk' | 'network';
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
  status?: Tone;
  children: React.ReactNode;
}

function KpiTile({
  kind,
  icon,
  label,
  onSelect,
  status,
  children,
}: KpiTileProps): React.JSX.Element {
  const { t } = useTranslation('systemmonitor');
  return (
    <section className={`sm-kpi sm-kpi-${kind}`}>
      <div className="sm-kpi-head">
        <button className="sm-card-title" onClick={onSelect}>
          {icon}
          {label}
        </button>
        {status && (
          <span className={`sm-status sm-status-${status}`}>{t(`dashboard.status.${status}`)}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function PercentValue({ value }: { value: number }): React.JSX.Element {
  return (
    <div className="sm-kpi-value">
      <strong>{value.toFixed(1)}</strong>
      <span>%</span>
    </div>
  );
}

export interface OverviewKpisProps {
  metrics: SystemMetricsV2;
  history: MetricSample[];
  seconds: number;
  onSelect: (key: 'cpu' | 'memory' | 'disk' | 'network') => void;
}

/**
 * Four KPI tiles over one shared hover state (bklit "KPI sparklines" recipe):
 * moving the cursor across any sparkline scrubs every tile to the same instant.
 */
export function OverviewKpis({
  metrics,
  history,
  seconds,
  onSelect,
}: OverviewKpisProps): React.JSX.Element {
  const { t } = useTranslation('systemmonitor');
  const hover = useSparklineHover<MetricSample>();
  const windowed = useMemo(() => {
    const newest = history.at(-1);
    if (!newest) return [];
    return history.filter((sample) => sample.timestamp >= newest.timestamp - seconds * 1000);
  }, [history, seconds]);
  const scrub = hover.datum;
  const hasTrend = windowed.length >= 2;
  const cpu = scrub?.cpuUsage ?? metrics.cpuUsage;
  const memory = scrub?.memoryUsage ?? metrics.memoryUsage;
  const rx = scrub?.networkRxBps ?? metrics.network.receivedBytesPerSec;
  const tx = scrub?.networkTxBps ?? metrics.network.transmittedBytesPerSec;
  const netMax = useMemo(
    () => Math.max(1, ...windowed.map((s) => Math.max(s.networkRxBps, s.networkTxBps))) * 1.15,
    [windowed]
  );
  const diskFree = metrics.diskTotalGb - metrics.diskUsedGb;
  const filled = Math.round((Math.max(0, Math.min(100, metrics.diskUsage)) / 100) * NOTCHES);
  const trend = (key: 'cpuUsage' | 'memoryUsage', color: string): React.JSX.Element | null =>
    hasTrend ? (
      <div className="sm-kpi-trend">
        <AreaSparkline
          data={windowed}
          dataKey={key}
          color={color}
          height={56}
          yDomain={[0, 100]}
          strokeWidth={1.75}
          padding={{ top: 6, right: 0, bottom: 0, left: 0 }}
          {...hover.sparklineProps}
        />
      </div>
    ) : null;

  return (
    <div className="sm-kpi-grid">
      <KpiTile
        kind="cpu"
        icon={<Cpu size={14} />}
        label={t('cpu')}
        status={toneOf(metrics.cpuUsage)}
        onSelect={() => onSelect('cpu')}
      >
        <PercentValue value={cpu} />
        <p className="sm-kpi-detail">
          {t('dashboard.logicalCores', { count: metrics.perCoreCpu.length })}
        </p>
        {trend('cpuUsage', 'var(--sm-cpu)')}
      </KpiTile>

      <KpiTile
        kind="memory"
        icon={<MemoryStick size={14} />}
        label={t('memory')}
        status={toneOf(metrics.memoryUsage)}
        onSelect={() => onSelect('memory')}
      >
        <PercentValue value={memory} />
        <p className="sm-kpi-detail">
          {metrics.memoryUsedGb.toFixed(1)} / {metrics.memoryTotalGb.toFixed(1)} {t('dashboard.gb')}
        </p>
        {trend('memoryUsage', 'var(--sm-memory)')}
      </KpiTile>

      <KpiTile
        kind="disk"
        icon={<HardDrive size={14} />}
        label={t('disk')}
        status={toneOf(metrics.diskUsage)}
        onSelect={() => onSelect('disk')}
      >
        <PercentValue value={metrics.diskUsage} />
        <p className="sm-kpi-detail">
          {metrics.diskUsedGb.toFixed(0)} / {metrics.diskTotalGb.toFixed(0)} {t('dashboard.gb')} ·{' '}
          {t('dashboard.free', { value: diskFree.toFixed(1) })}
        </p>
        <div
          className="sm-notches"
          role="meter"
          aria-label={t('dashboard.usedSpace')}
          aria-valuenow={metrics.diskUsage}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {Array.from({ length: NOTCHES }, (_, i) => (
            <i key={i} className={i < filled ? 'is-on' : undefined} />
          ))}
        </div>
      </KpiTile>

      <KpiTile
        kind="network"
        icon={<Wifi size={14} />}
        label={t('networkTitle')}
        onSelect={() => onSelect('network')}
      >
        <div className="sm-kpi-rates">
          <span className="sm-rate sm-rate-rx">
            <ArrowDown size={13} aria-label={t('dashboard.download')} />
            <strong>{formatBytesPerSec(rx)}</strong>
          </span>
          <span className="sm-rate sm-rate-tx">
            <ArrowUp size={13} aria-label={t('dashboard.upload')} />
            <strong>{formatBytesPerSec(tx)}</strong>
          </span>
        </div>
        <p className="sm-kpi-detail">{t('dashboard.aggregate')}</p>
        {hasTrend && (
          <div className="sm-kpi-trend">
            <AreaSparkline
              data={windowed}
              dataKey="networkRxBps"
              color="var(--sm-rx)"
              height={56}
              yDomain={[0, netMax]}
              strokeWidth={1.75}
              padding={{ top: 6, right: 0, bottom: 0, left: 0 }}
              {...hover.sparklineProps}
            />
            <div className="sm-kpi-overlay" aria-hidden="true">
              <LineSparkline
                data={windowed}
                dataKey="networkTxBps"
                color="var(--sm-tx)"
                height={56}
                yDomain={[0, netMax]}
                strokeWidth={1.5}
                padding={{ top: 6, right: 0, bottom: 0, left: 0 }}
                crosshair={false}
                dot={false}
                showHighlight={false}
                interactive={false}
                hoverIndex={hover.index}
              />
            </div>
          </div>
        )}
      </KpiTile>
    </div>
  );
}
