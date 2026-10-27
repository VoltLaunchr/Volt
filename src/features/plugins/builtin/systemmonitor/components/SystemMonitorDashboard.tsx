import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  CirclePause,
  Cpu,
  Download,
  HardDrive,
  MemoryStick,
  Monitor,
  Play,
  Thermometer,
  TriangleAlert,
  X,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'motion/react';
import { Dialog } from '@base-ui/react/dialog';
import { LiveLineChart } from '../../../../../components/charts/live-line-chart';
import { LiveLine } from '../../../../../components/charts/live-line';
import { ChartTooltip } from '../../../../../components/charts/tooltip/chart-tooltip';
import { LiveXAxis } from '../../../../../components/charts/live-x-axis';
import { useSystemMetricsV2 } from '../useSystemMetricsV2';
import { useMetricsHistory, type MetricSample } from '../useMetricsHistory';
import { exportMetricsCsv, formatBytesPerSec, formatUptime } from '../utils';
import type { ProcessInfo, SystemMetricsV2 } from '../types';
import { resolveMonitorRefreshMs } from '../../../../settings/behavior/pluginOptions';
import { useLiveSettings } from '../../../../settings/behavior/useLiveSettings';
import { StorageChart } from './ResourceCharts';
import { CpuCorePanel } from './CpuCorePanel';
import { ProcessPanel } from './ProcessPanel';
import { MemoryPanel } from './MemoryPanel';
import { OverviewKpis } from './OverviewKpis';
import '../system-monitor.css';

type Resource = 'overview' | 'cpu' | 'memory' | 'disk' | 'network';
const RESOURCE_ICONS = {
  overview: Activity,
  cpu: Cpu,
  memory: MemoryStick,
  disk: HardDrive,
  network: ArrowDown,
};
const percent = (value: number) => `${value.toFixed(1)}%`;
function tone(value: number): string {
  return value >= 90 ? 'critical' : value >= 75 ? 'high' : 'normal';
}

export interface SystemMonitorDashboardProps {
  onClose: () => void;
  enabled?: boolean;
}
export function SystemMonitorDashboard({
  onClose,
  enabled = true,
}: SystemMonitorDashboardProps): React.JSX.Element {
  const { t } = useTranslation('systemmonitor');
  const settings = useLiveSettings();
  const refreshMs = resolveMonitorRefreshMs(settings?.plugins);
  const [paused, setPaused] = useState(false);
  const [resource, setResource] = useState<Resource>('overview');
  const [windowSeconds, setWindowSeconds] = useState(60);
  const [processSort, setProcessSort] = useState<'cpu' | 'memory'>('cpu');
  const [pendingKill, setPendingKill] = useState<ProcessInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [cpuAlertDismissed, setCpuAlertDismissed] = useState(false);
  const { metrics, isLoading, error, retry } = useSystemMetricsV2(refreshMs, enabled && !paused);
  const history = useMetricsHistory(metrics, Math.ceil(90_000 / refreshMs) + 2);
  const sustainedCpu = useMemo(() => {
    const newest = history.at(-1);
    if (!newest) return false;
    const recent = history.filter((sample) => sample.timestamp >= newest.timestamp - 30_000);
    return (
      recent.length >= 2 &&
      newest.timestamp - recent[0].timestamp >= 30_000 &&
      recent.every((sample) => sample.cpuUsage >= 90)
    );
  }, [history]);
  useEffect(() => {
    if (metrics && metrics.cpuUsage < 90) setCpuAlertDismissed(false);
  }, [metrics]);
  const reducedMotion = useReducedMotion();
  const chartPaused = paused || !!error;
  const unavailable = !metrics;
  const readingState = error
    ? t('dashboard.stale')
    : paused
      ? t('dashboard.paused')
      : t('dashboard.live');
  const processes = useMemo(() => {
    if (!metrics) return [];
    const source = processSort === 'cpu' ? metrics.topCpuProcesses : metrics.topMemoryProcesses;
    return [...source].sort((a, b) =>
      processSort === 'cpu' ? b.cpuUsagePercent - a.cpuUsagePercent : b.memoryBytes - a.memoryBytes
    );
  }, [metrics, processSort]);
  const chart = (key: keyof Omit<MetricSample, 'timestamp'>, value: number, large = false) => (
    <MetricChart
      history={history}
      dataKey={key}
      value={value}
      seconds={windowSeconds}
      paused={chartPaused}
      reducedMotion={!!reducedMotion}
      large={large}
    />
  );
  const taskManager = async () => {
    setActionError(null);
    try {
      await invoke('open_task_manager');
    } catch {
      setActionError(t('dashboard.taskManagerError'));
    }
  };
  const exportCsv = () => {
    if (!metrics) return;
    setActionError(null);
    try {
      exportMetricsCsv(metrics, history);
      setActionSuccess(t('dashboard.exported'));
    } catch {
      setActionError(t('dashboard.exportError'));
    }
  };
  const kill = async () => {
    if (!pendingKill || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await invoke('kill_process_by_pid', { pid: pendingKill.pid });
      setActionSuccess(t('dashboard.stopped', { name: pendingKill.name }));
      setPendingKill(null);
    } catch {
      setActionError(t('dashboard.killError', { name: pendingKill.name }));
    } finally {
      setBusy(false);
    }
  };
  const selectResource = (key: Resource) => {
    setResource(key);
    if (key === 'memory' || key === 'cpu') setProcessSort(key);
  };
  const resourceLabel = (key: Resource) =>
    key === 'overview' ? t('dashboard.overview') : key === 'network' ? t('networkTitle') : t(key);
  return (
    <div className="system-monitor">
      <header className="sm-header">
        <span className="sm-brand-icon">
          <Activity size={19} />
        </span>
        <div className="sm-brand">
          <h1>{t('detailTitle')}</h1>
          <span>{t('dashboard.subtitle')}</span>
        </div>
        <div className="sm-header-actions">
          <button onClick={exportCsv} disabled={unavailable} title={t('exportCsv')}>
            <Download size={15} />
            <span>{t('exportCsv')}</span>
          </button>
          <button onClick={() => void taskManager()} title={t('openTaskManager')}>
            <Monitor size={15} />
            <span>{t('dashboard.taskManager')}</span>
          </button>
          <button className="sm-icon-button" onClick={onClose} aria-label={t('dashboard.close')}>
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="sm-toolbar">
        <nav aria-label={t('dashboard.resources')} className="sm-resource-nav">
          {(Object.keys(RESOURCE_ICONS) as Resource[]).map((key) => {
            const Icon = RESOURCE_ICONS[key];
            return (
              <button key={key} aria-pressed={resource === key} onClick={() => selectResource(key)}>
                <Icon size={14} />
                <span>{resourceLabel(key)}</span>
              </button>
            );
          })}
        </nav>
        <div className="sm-stream-controls">
          {metrics && (
            <span className={`sm-live-state ${error || paused ? 'is-paused' : ''}`}>
              <i />
              {readingState}
            </span>
          )}
          <label>
            <span className="sm-sr-only">{t('dashboard.historyWindow')}</span>
            <select
              value={windowSeconds}
              onChange={(e) => setWindowSeconds(Number(e.target.value))}
            >
              {[30, 60, 90].map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds} s
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            disabled={unavailable}
            title={paused ? t('dashboard.resume') : t('dashboard.pause')}
          >
            {paused ? <Play size={14} /> : <CirclePause size={14} />}
            <span>{paused ? t('dashboard.resume') : t('dashboard.pause')}</span>
          </button>
        </div>
      </div>
      <div className="sm-scroll">
        {sustainedCpu && !cpuAlertDismissed && (
          <div className="sm-notice is-warning" role="status">
            <TriangleAlert size={16} />
            <span>{t('alertHighCpu', { threshold: 90, seconds: 30 })}</span>
            <button
              className="sm-icon-button"
              onClick={() => setCpuAlertDismissed(true)}
              aria-label={t('dashboard.dismiss')}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {error && (
          <div className="sm-notice is-warning" role="status">
            <TriangleAlert size={16} />
            <span>{metrics ? t('dashboard.staleError') : t('dashboard.loadError')}</span>
            <button
              onClick={() => {
                setPaused(false);
                retry();
              }}
            >
              {t('dashboard.retry')}
            </button>
          </div>
        )}
        {actionError && !pendingKill && (
          <div className="sm-notice is-danger" role="alert">
            <TriangleAlert size={16} />
            <span>{actionError}</span>
            <button
              className="sm-icon-button"
              onClick={() => setActionError(null)}
              aria-label={t('dashboard.dismiss')}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {actionSuccess && (
          <div className="sm-notice" role="status">
            <Check size={15} />
            <span>{actionSuccess}</span>
            <button
              className="sm-icon-button"
              onClick={() => setActionSuccess(null)}
              aria-label={t('dashboard.dismiss')}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {!metrics ? (
          <div className="sm-empty-state" role="status">
            <Activity size={28} />
            <h2>{isLoading ? t('dashboard.loading') : t('dashboard.unavailable')}</h2>
            <p>{isLoading ? t('dashboard.loadingHint') : t('dashboard.retryHint')}</p>
          </div>
        ) : (
          <>
            <h2 className="sm-sr-only">{resourceLabel(resource)}</h2>
            {resource === 'overview' && (
              <OverviewKpis
                metrics={metrics}
                history={history}
                seconds={windowSeconds}
                onSelect={selectResource}
              />
            )}
            {resource === 'cpu' && (
              <div className="sm-metric-grid is-focused">
                <section className="sm-metric-card sm-cpu">
                  <div className="sm-card-heading">
                    <span className="sm-card-title">
                      <Cpu size={16} />
                      {t('cpu')}
                    </span>
                    <span className={`sm-status sm-status-${tone(metrics.cpuUsage)}`}>
                      {t(`dashboard.status.${tone(metrics.cpuUsage)}`)}
                    </span>
                  </div>
                  <div className="sm-metric-value">
                    <strong>{metrics.cpuUsage.toFixed(1)}</strong>
                    <span>%</span>
                  </div>
                  <div className="sm-metric-detail">
                    {t('dashboard.logicalCores', { count: metrics.perCoreCpu.length })}
                  </div>
                  {chart('cpuUsage', metrics.cpuUsage, true)}
                </section>
              </div>
            )}
            {resource === 'memory' && (
              <MemoryPanel
                used={metrics.memoryUsedGb}
                total={metrics.memoryTotalGb}
                historyChart={chart('memoryUsage', metrics.memoryUsage, true)}
              />
            )}
            {(resource === 'overview' || resource === 'cpu' || resource === 'memory') && (
              <div className={`sm-analysis-grid ${resource === 'memory' ? 'is-single' : ''}`}>
                {resource !== 'memory' && <CpuCorePanel cores={metrics.perCoreCpu} />}
                <ProcessPanel
                  processes={processes}
                  processSort={processSort}
                  onSort={setProcessSort}
                  full={resource === 'memory'}
                  onStop={(process) => {
                    setPendingKill(process);
                    setActionError(null);
                  }}
                />
              </div>
            )}
            {(resource === 'overview' || resource === 'network' || resource === 'disk') && (
              <div className="sm-lower-grid is-focused">
                {resource === 'network' && (
                  <section className="sm-panel sm-network">
                    <div className="sm-panel-heading">
                      <h3>{t('networkTitle')}</h3>
                      <span>{t('dashboard.aggregate')}</span>
                    </div>
                    <div className="sm-network-grid">
                      {(['rx', 'tx'] as const).map((direction) => {
                        const download = direction === 'rx';
                        const value = download
                          ? metrics.network.receivedBytesPerSec
                          : metrics.network.transmittedBytesPerSec;
                        const Icon = download ? ArrowDown : ArrowUp;
                        return (
                          <div className={`sm-network-stat sm-${direction}`} key={direction}>
                            <span>
                              <Icon size={14} />
                              {t(download ? 'dashboard.download' : 'dashboard.upload')}
                            </span>
                            <strong>{formatBytesPerSec(value)}</strong>
                            {chart(
                              download ? 'networkRxBps' : 'networkTxBps',
                              value,
                              resource === 'network'
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {resource === 'network' && (
                      <div className="sm-network-interfaces">
                        {metrics.network.interfaces.map((iface) => (
                          <div key={iface.name}>
                            <span>{iface.name}</span>
                            <span>↓ {formatBytesPerSec(iface.receivedBytesPerSec)}</span>
                            <span>↑ {formatBytesPerSec(iface.transmittedBytesPerSec)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}
                {resource !== 'network' && (
                  <section className="sm-panel sm-storage">
                    <div className="sm-panel-heading">
                      <h3>{t('dashboard.storage')}</h3>
                      <span>{t('dashboard.volumes', { count: metrics.perDisk.length })}</span>
                    </div>
                    {metrics.perDisk.length > 0 && (
                      <StorageChart disks={metrics.perDisk} expanded={resource === 'disk'} />
                    )}
                    {!metrics.perDisk.length && (
                      <p className="sm-muted">{t('dashboard.noDisks')}</p>
                    )}
                  </section>
                )}
              </div>
            )}
            {resource === 'overview' && <TemperatureSummary metrics={metrics} />}
          </>
        )}
      </div>
      <footer className="sm-footer">
        <span>
          {metrics
            ? t('uptime', { value: formatUptime(metrics.uptimeSeconds) })
            : t('dashboard.waiting')}
        </span>
        <span>
          {t('dashboard.cadence', { seconds: refreshMs / 1000 })} · {t('dashboard.sessionOnly')}
        </span>
      </footer>
      <Dialog.Root
        open={!!pendingKill}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingKill(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="sm-confirm-backdrop" />
          <Dialog.Popup className="system-monitor sm-confirm" role="alertdialog">
            <TriangleAlert size={22} />
            <Dialog.Title>{t('dashboard.stopTitle', { name: pendingKill?.name })}</Dialog.Title>
            <Dialog.Description>
              {t('dashboard.stopDescription', { pid: pendingKill?.pid })}
            </Dialog.Description>
            {actionError && (
              <p className="sm-notice is-danger" role="alert">
                {actionError}
              </p>
            )}
            <div>
              <button disabled={busy} onClick={() => setPendingKill(null)}>
                {t('dashboard.cancel')}
              </button>
              <button className="sm-danger-button" disabled={busy} onClick={() => void kill()}>
                {busy ? t('dashboard.stopping') : t('dashboard.confirmStop')}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function MetricChart({
  history,
  dataKey,
  value,
  seconds,
  paused,
  reducedMotion,
  large,
}: {
  history: MetricSample[];
  dataKey: keyof Omit<MetricSample, 'timestamp'>;
  value: number;
  seconds: number;
  paused: boolean;
  reducedMotion: boolean;
  large: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('systemmonitor');
  const isNetwork = dataKey.startsWith('network');
  const format = isNetwork ? formatBytesPerSec : percent;
  const yMax = isNetwork ? Math.max(1, value, ...history.map((s) => s[dataKey])) * 1.1 : 100;
  const points = useMemo(
    () => history.map((sample) => ({ time: sample.timestamp / 1000, value: sample[dataKey] })),
    [history, dataKey]
  );
  return (
    <div
      className={`sm-chart ${large ? 'is-large' : ''}`}
      role="img"
      aria-label={t('dashboard.chartDescription', { value: format(value), seconds })}
    >
      <LiveLineChart
        data={points}
        value={value}
        window={seconds}
        paused={paused}
        yDomain={[0, yMax]}
        frameRate={reducedMotion ? 1 : 15}
        margin={{
          top: 10,
          right: 10,
          bottom: large ? 24 : 8,
          left: 8,
        }}
        style={{ height: large ? 200 : 66 }}
      >
        <LiveLine
          dataKey="value"
          stroke="var(--sm-series)"
          fill
          pulse={false}
          badge={false}
          dotSize={3}
          formatValue={format}
        />
        {large && <LiveXAxis />}
        <ChartTooltip
          showDatePill={false}
          indicatorColor="var(--sm-series)"
          content={({ point }) => (
            <div className="sm-chart-tooltip">
              <strong>{format(Number(point.value))}</strong>
              <span>
                {point.date instanceof Date
                  ? point.date.toLocaleTimeString()
                  : typeof point.time === 'number'
                    ? new Date(point.time * 1000).toLocaleTimeString()
                    : ''}
              </span>
            </div>
          )}
        />
      </LiveLineChart>
      {large && (
        <span className="sm-chart-scale">{isNetwork ? `max ${format(yMax)}` : '0 – 100 %'}</span>
      )}
      {!large && (
        <div className="sm-chart-caption">
          <span>−{seconds} s</span>
          <span>{t('dashboard.now')}</span>
        </div>
      )}
    </div>
  );
}
function TemperatureSummary({ metrics }: { metrics: SystemMetricsV2 }): React.JSX.Element {
  const { t } = useTranslation('systemmonitor');
  const sensors = metrics.components.filter((component) => component.temperatureC !== null);
  return (
    <section className="sm-temperature-summary">
      <Thermometer size={16} />
      <strong>{t('temperaturesTitle')}</strong>
      {sensors.length ? (
        sensors.map((sensor) => (
          <span key={sensor.label}>
            {sensor.label}
            <strong>{sensor.temperatureC!.toFixed(0)} °C</strong>
          </span>
        ))
      ) : (
        <span>{t('dashboard.noSensors')}</span>
      )}
    </section>
  );
}
