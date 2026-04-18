import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../../../../shared/components/ui/Modal';
import { logger } from '../../../../../shared/utils/logger';
import { SystemMetricBadge } from './SystemMetricBadge';
import { Sparkline } from './Sparkline';
import { useSystemMetricsV2 } from '../useSystemMetricsV2';
import { useMetricsHistory, type MetricSample } from '../useMetricsHistory';
import { exportMetricsCsv, formatBytesPerSec, formatUptime } from '../utils';
import './SystemMonitorDetail.css';

const OPEN_EVENT = 'volt:openSystemMonitor';
const HIGH_CPU_THRESHOLD = 90;
const HIGH_CPU_SECONDS = 30;

type UsageStatus = 'normal' | 'moderate' | 'high' | 'critical';

function usageStatus(v: number): UsageStatus {
  if (v >= 90) return 'critical';
  if (v >= 75) return 'high';
  if (v >= 50) return 'moderate';
  return 'normal';
}

function usageFillColor(v: number): string {
  if (v >= 90) return '#ef4444';
  if (v >= 75) return '#f97316';
  if (v >= 50) return '#f59e0b';
  return '#10b981';
}

function isHighCpuSustained(history: MetricSample[]): boolean {
  if (history.length === 0) return false;
  const now = Date.now();
  // Look at samples from the last HIGH_CPU_SECONDS window.
  const windowStart = now - HIGH_CPU_SECONDS * 1000;
  const inWindow = history.filter((s) => s.timestamp >= windowStart);
  // Require at least HIGH_CPU_SECONDS-1 samples (1Hz poll) AND all above threshold.
  if (inWindow.length < HIGH_CPU_SECONDS - 1) return false;
  return inWindow.every((s) => s.cpuUsage >= HIGH_CPU_THRESHOLD);
}

export const SystemMonitorDetail: React.FC = () => {
  const { t } = useTranslation('systemmonitor');
  const [isOpen, setIsOpen] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);

  // Only poll while the modal is open.
  const { metrics } = useSystemMetricsV2(isOpen ? 1000 : 60_000);
  const history = useMetricsHistory(isOpen ? metrics : null, 60);

  useEffect(() => {
    const onOpen = () => {
      setIsOpen(true);
      setAlertDismissed(false);
      setKillError(null);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const handleClose = useCallback(() => setIsOpen(false), []);

  const cpuSeries = useMemo(() => history.map((s) => s.cpuUsage), [history]);
  const memSeries = useMemo(() => history.map((s) => s.memoryUsage), [history]);
  const diskSeries = useMemo(() => history.map((s) => s.diskUsage), [history]);
  const rxSeries = useMemo(() => history.map((s) => s.networkRxBps), [history]);
  const txSeries = useMemo(() => history.map((s) => s.networkTxBps), [history]);

  const showHighCpuAlert = !alertDismissed && isHighCpuSustained(history);
  useEffect(() => {
    // Auto-reset dismissal once CPU drops below the threshold.
    if (alertDismissed && metrics && metrics.cpuUsage < HIGH_CPU_THRESHOLD) {
      setAlertDismissed(false);
    }
  }, [alertDismissed, metrics]);

  const handleKill = useCallback(
    async (pid: number, name: string) => {
      if (!window.confirm(`${t('killProcess')} "${name}" (PID ${pid})?`)) return;
      try {
        await invoke('kill_process_by_pid', { pid });
        logger.info(`Killed process ${name} (${pid})`);
        setKillError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('kill_process_by_pid failed:', msg);
        setKillError(`${name} (PID ${pid}): ${msg}`);
      }
    },
    [t],
  );

  const handleOpenTaskManager = useCallback(async () => {
    try {
      await invoke('open_task_manager');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('open_task_manager failed:', msg);
    }
  }, []);

  const handleExport = useCallback(() => {
    if (!metrics) return;
    try {
      exportMetricsCsv(metrics, history);
    } catch (e) {
      logger.error('exportMetricsCsv failed:', e);
    }
  }, [metrics, history]);

  if (!metrics) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} title={t('detailTitle')} size="large">
        <div className="sm-detail">{t('usage.normal')}…</div>
      </Modal>
    );
  }

  const cpu = metrics.cpuUsage;
  const mem = metrics.memoryUsage;
  const disk = metrics.diskUsage;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('detailTitle')} size="large">
      <div className="sm-detail">
        {showHighCpuAlert && (
          <div className="sm-detail__alert" role="alert">
            <span>
              {t('alertHighCpu', { threshold: HIGH_CPU_THRESHOLD, seconds: HIGH_CPU_SECONDS })}
            </span>
            <button
              type="button"
              className="sm-detail__alert-close"
              onClick={() => setAlertDismissed(true)}
              aria-label="Dismiss alert"
            >
              ×
            </button>
          </div>
        )}

        {/* Header: CPU / Memory / Disk + Uptime */}
        <div className="sm-detail__header">
          <div className="sm-detail__hero">
            <span className="sm-detail__hero-label">{t('cpu')}</span>
            <span className="sm-detail__hero-value">{cpu.toFixed(1)}%</span>
            <Sparkline
              data={cpuSeries}
              min={0}
              max={100}
              width={140}
              height={30}
              color={usageFillColor(cpu)}
              label={t('cpu')}
              valueSuffix="%"
            />
          </div>
          <div className="sm-detail__hero">
            <span className="sm-detail__hero-label">{t('memory')}</span>
            <span className="sm-detail__hero-value">{mem.toFixed(1)}%</span>
            <Sparkline
              data={memSeries}
              min={0}
              max={100}
              width={140}
              height={30}
              color={usageFillColor(mem)}
              label={t('memory')}
              valueSuffix="%"
            />
          </div>
          <div className="sm-detail__hero">
            <span className="sm-detail__hero-label">{t('disk')}</span>
            <span className="sm-detail__hero-value">{disk.toFixed(1)}%</span>
            <Sparkline
              data={diskSeries}
              min={0}
              max={100}
              width={140}
              height={30}
              color={usageFillColor(disk)}
              label={t('disk')}
              valueSuffix="%"
            />
          </div>
          <div className="sm-detail__hero-uptime">
            <span className="sm-detail__hero-value">
              {t('uptime', { value: formatUptime(metrics.uptimeSeconds) })}
            </span>
          </div>
        </div>

        {/* Per-core CPU */}
        <section className="sm-detail__section" aria-labelledby="sm-cores-title">
          <h3 id="sm-cores-title" className="sm-detail__section-title">
            {t('perCoreTitle')}
          </h3>
          <div className="sm-detail__cores">
            {metrics.perCoreCpu.map((core) => (
              <div key={core.name} className="sm-detail__core">
                <span className="sm-detail__core-name">{core.name}</span>
                <SystemMetricBadge value={core.usagePercent} status={usageStatus(core.usagePercent)} />
              </div>
            ))}
          </div>
        </section>

        {/* Per-disk list */}
        <section className="sm-detail__section" aria-labelledby="sm-disks-title">
          <h3 id="sm-disks-title" className="sm-detail__section-title">
            {t('perDiskTitle')}
          </h3>
          <div className="sm-detail__disks">
            {metrics.perDisk.map((d) => {
              const pct = d.totalGb > 0 ? (d.usedGb / d.totalGb) * 100 : 0;
              return (
                <div key={d.mountPoint} className="sm-detail__disk">
                  <span className="sm-detail__disk-mount" title={d.mountPoint}>
                    {d.mountPoint}
                  </span>
                  <span className="sm-detail__disk-usage">
                    {d.usedGb.toFixed(0)} / {d.totalGb.toFixed(0)} GB ({pct.toFixed(1)}%)
                  </span>
                  <span className="sm-detail__disk-kind">{d.kind}</span>
                  <div
                    className="sm-detail__disk-bar"
                    role="progressbar"
                    aria-valuenow={Math.round(pct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${d.mountPoint} ${pct.toFixed(0)}%`}
                  >
                    <div
                      className="sm-detail__disk-bar-fill"
                      style={{ width: `${pct}%`, background: usageFillColor(pct) }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Network */}
        <section className="sm-detail__section" aria-labelledby="sm-net-title">
          <h3 id="sm-net-title" className="sm-detail__section-title">
            {t('networkTitle')}
          </h3>
          <div className="sm-detail__net">
            <div className="sm-detail__net-card">
              <div className="sm-detail__net-card-header">
                <span className="sm-detail__net-card-label">
                  {t('rxLabel', { value: formatBytesPerSec(metrics.network.receivedBytesPerSec) })}
                </span>
              </div>
              <Sparkline
                data={rxSeries}
                min={0}
                width={260}
                height={36}
                color="#10b981"
                label="RX"
                valueSuffix=" B/s"
              />
            </div>
            <div className="sm-detail__net-card">
              <div className="sm-detail__net-card-header">
                <span className="sm-detail__net-card-label">
                  {t('txLabel', {
                    value: formatBytesPerSec(metrics.network.transmittedBytesPerSec),
                  })}
                </span>
              </div>
              <Sparkline
                data={txSeries}
                min={0}
                width={260}
                height={36}
                color="#3b82f6"
                label="TX"
                valueSuffix=" B/s"
              />
            </div>
          </div>
          {metrics.network.interfaces.length > 0 && (
            <table className="sm-detail__ifaces">
              <thead>
                <tr>
                  <th scope="col">Interface</th>
                  <th scope="col">RX</th>
                  <th scope="col">TX</th>
                </tr>
              </thead>
              <tbody>
                {metrics.network.interfaces.map((iface) => (
                  <tr key={iface.name}>
                    <td>{iface.name}</td>
                    <td>{formatBytesPerSec(iface.receivedBytesPerSec)}</td>
                    <td>{formatBytesPerSec(iface.transmittedBytesPerSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Top processes */}
        <section className="sm-detail__section">
          {killError && (
            <div className="sm-detail__inline-error" role="status">
              {killError}
            </div>
          )}
          <div className="sm-detail__top-cols">
            <div>
              <h3 className="sm-detail__section-title">{t('topCpuTitle')}</h3>
              {metrics.topCpuProcesses.slice(0, 5).map((p) => (
                <div key={`cpu-${p.pid}`} className="sm-detail__proc">
                  <span className="sm-detail__proc-name" title={p.name}>
                    {p.name}
                  </span>
                  <span className="sm-detail__proc-val">{p.cpuUsagePercent.toFixed(1)}%</span>
                  <button
                    type="button"
                    className="sm-detail__kill-btn"
                    aria-label={`${t('killProcess')} ${p.name} (PID ${p.pid})`}
                    onClick={() => handleKill(p.pid, p.name)}
                  >
                    {t('killProcess')}
                  </button>
                </div>
              ))}
            </div>
            <div>
              <h3 className="sm-detail__section-title">{t('topMemoryTitle')}</h3>
              {metrics.topMemoryProcesses.slice(0, 5).map((p) => (
                <div key={`mem-${p.pid}`} className="sm-detail__proc">
                  <span className="sm-detail__proc-name" title={p.name}>
                    {p.name}
                  </span>
                  <span className="sm-detail__proc-val">
                    {(p.memoryBytes / (1024 * 1024)).toFixed(0)} MB
                  </span>
                  <button
                    type="button"
                    className="sm-detail__kill-btn"
                    aria-label={`${t('killProcess')} ${p.name} (PID ${p.pid})`}
                    onClick={() => handleKill(p.pid, p.name)}
                  >
                    {t('killProcess')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Temperatures */}
        <section className="sm-detail__section" aria-labelledby="sm-temps-title">
          <h3 id="sm-temps-title" className="sm-detail__section-title">
            {t('temperaturesTitle')}
          </h3>
          {metrics.components.length === 0 ? (
            <div className="sm-detail__temp">{t('noTempSensors')}</div>
          ) : (
            <div className="sm-detail__temps">
              {metrics.components
                .filter((c) => c.temperatureC !== null)
                .map((c) => (
                  <div key={c.label} className="sm-detail__temp">
                    <span>{c.label}</span>
                    <span>{c.temperatureC!.toFixed(1)}°C</span>
                  </div>
                ))}
            </div>
          )}
        </section>

        {/* Footer actions */}
        <div className="sm-detail__footer">
          <button
            type="button"
            className="sm-detail__action-btn"
            onClick={handleOpenTaskManager}
          >
            {t('openTaskManager')}
          </button>
          <button type="button" className="sm-detail__action-btn" onClick={handleExport}>
            {t('exportCsv')}
          </button>
        </div>
      </div>
    </Modal>
  );
};
