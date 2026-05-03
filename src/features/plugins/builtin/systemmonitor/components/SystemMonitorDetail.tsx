import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../../../../shared/components/ui/Modal';
import { logger } from '../../../../../shared/utils/logger';
import { SystemMetricBadge } from './SystemMetricBadge';
import { LiveLineChart } from '../../../../../components/charts/live-line-chart';
import { LiveLine } from '../../../../../components/charts/live-line';
import { useSystemMetricsV2 } from '../useSystemMetricsV2';
import { useMetricsHistory, type MetricSample } from '../useMetricsHistory';
import { exportMetricsCsv, formatBytesPerSec, formatUptime } from '../utils';

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
  return '#FBBF24';
}

function isHighCpuSustained(history: MetricSample[]): boolean {
  if (history.length === 0) return false;
  const now = Date.now();
  const windowStart = now - HIGH_CPU_SECONDS * 1000;
  const inWindow = history.filter((s) => s.timestamp >= windowStart);
  if (inWindow.length < HIGH_CPU_SECONDS - 1) return false;
  return inWindow.every((s) => s.cpuUsage >= HIGH_CPU_THRESHOLD);
}

function toPoints(history: MetricSample[], getValue: (s: MetricSample) => number) {
  return history.map((s) => ({ time: s.timestamp / 1000, value: getValue(s) }));
}

const COMPACT_MARGIN = { top: 4, right: 4, bottom: 4, left: 4 };

export const SystemMonitorDetail: React.FC = () => {
  const { t } = useTranslation('systemmonitor');
  const [isOpen, setIsOpen] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);

  const { metrics } = useSystemMetricsV2(isOpen ? 1000 : 60_000);
  const history = useMetricsHistory(isOpen ? metrics : null, 90);

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

  const cpuPoints  = useMemo(() => toPoints(history, (s) => s.cpuUsage), [history]);
  const memPoints  = useMemo(() => toPoints(history, (s) => s.memoryUsage), [history]);
  const diskPoints = useMemo(() => toPoints(history, (s) => s.diskUsage), [history]);
  const rxPoints   = useMemo(() => toPoints(history, (s) => s.networkRxBps), [history]);
  const txPoints   = useMemo(() => toPoints(history, (s) => s.networkTxBps), [history]);

  const showHighCpuAlert = !alertDismissed && isHighCpuSustained(history);
  useEffect(() => {
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
        <div className="flex flex-col gap-4 text-ink text-sm">{t('usage.normal')}…</div>
      </Modal>
    );
  }

  const cpu = metrics.cpuUsage;
  const mem = metrics.memoryUsage;
  const disk = metrics.diskUsage;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('detailTitle')} size="large">
      <div className="flex flex-col gap-4 text-ink text-sm">
        {/* High CPU alert */}
        {showHighCpuAlert && (
          <div
            className="flex items-center justify-between gap-3 px-3 py-2 bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.45)] text-[#ef4444] font-medium"
            role="alert"
          >
            <span>
              {t('alertHighCpu', { threshold: HIGH_CPU_THRESHOLD, seconds: HIGH_CPU_SECONDS })}
            </span>
            <button
              type="button"
              className="bg-transparent border-0 cursor-pointer text-inherit text-lg leading-none px-1.5 py-0.5 hover:bg-[rgba(239,68,68,0.2)]"
              onClick={() => setAlertDismissed(true)}
              aria-label="Dismiss alert"
            >
              ×
            </button>
          </div>
        )}

        {/* Header: CPU / Memory / Disk + Uptime */}
        <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'repeat(3,1fr) auto' }}>
          {/* CPU hero */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-mute uppercase tracking-[0.5px]">{t('cpu')}</span>
            <span className="text-lg font-semibold tabular-nums">{cpu.toFixed(1)}%</span>
            <LiveLineChart
              data={cpuPoints}
              value={cpu}
              dataKey="value"
              window={60}
              style={{ height: 56 }}
              margin={COMPACT_MARGIN}
            >
              <LiveLine
                dataKey="value"
                stroke={usageFillColor(cpu)}
                fill
                badge={false}
                formatValue={(v) => `${v.toFixed(1)}%`}
              />
            </LiveLineChart>
          </div>

          {/* Memory hero */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-mute uppercase tracking-[0.5px]">{t('memory')}</span>
            <span className="text-lg font-semibold tabular-nums">{mem.toFixed(1)}%</span>
            <LiveLineChart
              data={memPoints}
              value={mem}
              dataKey="value"
              window={60}
              style={{ height: 56 }}
              margin={COMPACT_MARGIN}
            >
              <LiveLine
                dataKey="value"
                stroke="#57c1ff"
                fill
                badge={false}
                formatValue={(v) => `${v.toFixed(1)}%`}
              />
            </LiveLineChart>
          </div>

          {/* Disk hero */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-mute uppercase tracking-[0.5px]">{t('disk')}</span>
            <span className="text-lg font-semibold tabular-nums">{disk.toFixed(1)}%</span>
            <LiveLineChart
              data={diskPoints}
              value={disk}
              dataKey="value"
              window={60}
              style={{ height: 56 }}
              margin={COMPACT_MARGIN}
            >
              <LiveLine
                dataKey="value"
                stroke="#9c9c9d"
                fill
                badge={false}
                formatValue={(v) => `${v.toFixed(1)}%`}
              />
            </LiveLineChart>
          </div>

          {/* Uptime */}
          <div className="flex flex-col items-end gap-0.5 tabular-nums">
            <span className="text-lg font-semibold tabular-nums">
              {t('uptime', { value: formatUptime(metrics.uptimeSeconds) })}
            </span>
          </div>
        </div>

        {/* Per-core CPU */}
        <section className="flex flex-col gap-2" aria-labelledby="sm-cores-title">
          <h3
            id="sm-cores-title"
            className="m-0 text-sm font-semibold text-mute uppercase tracking-[0.5px]"
          >
            {t('perCoreTitle')}
          </h3>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))' }}>
            {metrics.perCoreCpu.map((core) => (
              <div
                key={core.name}
                className="p-2 bg-surface border border-hairline flex flex-col gap-1.5"
              >
                <span className="text-xs text-mute tabular-nums">{core.name}</span>
                <SystemMetricBadge value={core.usagePercent} status={usageStatus(core.usagePercent)} />
              </div>
            ))}
          </div>
        </section>

        {/* Per-disk list */}
        <section className="flex flex-col gap-2" aria-labelledby="sm-disks-title">
          <h3
            id="sm-disks-title"
            className="m-0 text-sm font-semibold text-mute uppercase tracking-[0.5px]"
          >
            {t('perDiskTitle')}
          </h3>
          <div className="flex flex-col gap-2">
            {metrics.perDisk.map((d) => {
              const pct = d.totalGb > 0 ? (d.usedGb / d.totalGb) * 100 : 0;
              return (
                <div
                  key={d.mountPoint}
                  className="grid items-center gap-3 p-2 border border-hairline bg-surface"
                  style={{ gridTemplateColumns: 'minmax(120px,1fr) auto auto' }}
                >
                  <span className="font-medium overflow-hidden text-ellipsis whitespace-nowrap" title={d.mountPoint}>
                    {d.mountPoint}
                  </span>
                  <span className="tabular-nums text-mute text-xs">
                    {d.usedGb.toFixed(0)} / {d.totalGb.toFixed(0)} GB ({pct.toFixed(1)}%)
                  </span>
                  <span className="px-2 py-0.5 bg-hairline text-xs uppercase tracking-[0.5px]">
                    {d.kind}
                  </span>
                  <div
                    className="col-span-3 h-1.5 bg-hairline overflow-hidden"
                    role="progressbar"
                    aria-valuenow={Math.round(pct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${d.mountPoint} ${pct.toFixed(0)}%`}
                  >
                    <div
                      className="h-full transition-all duration-300"
                      style={{ width: `${pct}%`, background: usageFillColor(pct) }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Network */}
        <section className="flex flex-col gap-2" aria-labelledby="sm-net-title">
          <h3
            id="sm-net-title"
            className="m-0 text-sm font-semibold text-mute uppercase tracking-[0.5px]"
          >
            {t('networkTitle')}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-2 bg-surface border border-hairline flex flex-col gap-1.5">
              <div className="flex justify-between items-baseline tabular-nums">
                <span className="text-xs text-mute uppercase tracking-[0.5px]">
                  {t('rxLabel', { value: formatBytesPerSec(metrics.network.receivedBytesPerSec) })}
                </span>
              </div>
              <LiveLineChart
                data={rxPoints}
                value={metrics.network.receivedBytesPerSec}
                dataKey="value"
                window={60}
                style={{ height: 48 }}
                margin={COMPACT_MARGIN}
              >
                <LiveLine
                  dataKey="value"
                  stroke="#59d499"
                  fill
                  badge={false}
                  pulse={false}
                  formatValue={(v) => formatBytesPerSec(v)}
                />
              </LiveLineChart>
            </div>
            <div className="p-2 bg-surface border border-hairline flex flex-col gap-1.5">
              <div className="flex justify-between items-baseline tabular-nums">
                <span className="text-xs text-mute uppercase tracking-[0.5px]">
                  {t('txLabel', {
                    value: formatBytesPerSec(metrics.network.transmittedBytesPerSec),
                  })}
                </span>
              </div>
              <LiveLineChart
                data={txPoints}
                value={metrics.network.transmittedBytesPerSec}
                dataKey="value"
                window={60}
                style={{ height: 48 }}
                margin={COMPACT_MARGIN}
              >
                <LiveLine
                  dataKey="value"
                  stroke="#a78bfa"
                  fill
                  badge={false}
                  pulse={false}
                  formatValue={(v) => formatBytesPerSec(v)}
                />
              </LiveLineChart>
            </div>
          </div>
          {metrics.network.interfaces.length > 0 && (
            <table className="w-full border-collapse text-xs tabular-nums">
              <thead>
                <tr>
                  <th scope="col" className="text-left px-2 py-1 border-b border-hairline text-mute font-medium uppercase tracking-[0.5px]">Interface</th>
                  <th scope="col" className="text-left px-2 py-1 border-b border-hairline text-mute font-medium uppercase tracking-[0.5px]">RX</th>
                  <th scope="col" className="text-left px-2 py-1 border-b border-hairline text-mute font-medium uppercase tracking-[0.5px]">TX</th>
                </tr>
              </thead>
              <tbody>
                {metrics.network.interfaces.map((iface) => (
                  <tr key={iface.name}>
                    <td className="text-left px-2 py-1 border-b border-hairline">{iface.name}</td>
                    <td className="text-left px-2 py-1 border-b border-hairline">{formatBytesPerSec(iface.receivedBytesPerSec)}</td>
                    <td className="text-left px-2 py-1 border-b border-hairline">{formatBytesPerSec(iface.transmittedBytesPerSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Top processes */}
        <section className="flex flex-col gap-2">
          {killError && (
            <div
              className="px-2.5 py-1.5 bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.35)] text-[#ef4444] text-xs mb-2"
              role="status"
            >
              {killError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <h3 className="m-0 mb-2 text-sm font-semibold text-mute uppercase tracking-[0.5px]">
                {t('topCpuTitle')}
              </h3>
              {metrics.topCpuProcesses.slice(0, 5).map((p) => (
                <div
                  key={`cpu-${p.pid}`}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-hairline last:border-0"
                >
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1" title={p.name}>
                    {p.name}
                  </span>
                  <span className="tabular-nums text-mute text-xs">{p.cpuUsagePercent.toFixed(1)}%</span>
                  <button
                    type="button"
                    className="px-2 py-0.5 bg-transparent border border-hairline text-mute text-xs cursor-pointer transition-all hover:bg-[rgba(239,68,68,0.12)] hover:border-[rgba(239,68,68,0.45)] hover:text-[#ef4444]"
                    aria-label={`${t('killProcess')} ${p.name} (PID ${p.pid})`}
                    onClick={() => handleKill(p.pid, p.name)}
                  >
                    {t('killProcess')}
                  </button>
                </div>
              ))}
            </div>
            <div>
              <h3 className="m-0 mb-2 text-sm font-semibold text-mute uppercase tracking-[0.5px]">
                {t('topMemoryTitle')}
              </h3>
              {metrics.topMemoryProcesses.slice(0, 5).map((p) => (
                <div
                  key={`mem-${p.pid}`}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-hairline last:border-0"
                >
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1" title={p.name}>
                    {p.name}
                  </span>
                  <span className="tabular-nums text-mute text-xs">
                    {(p.memoryBytes / (1024 * 1024)).toFixed(0)} MB
                  </span>
                  <button
                    type="button"
                    className="px-2 py-0.5 bg-transparent border border-hairline text-mute text-xs cursor-pointer transition-all hover:bg-[rgba(239,68,68,0.12)] hover:border-[rgba(239,68,68,0.45)] hover:text-[#ef4444]"
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
        <section className="flex flex-col gap-2" aria-labelledby="sm-temps-title">
          <h3
            id="sm-temps-title"
            className="m-0 text-sm font-semibold text-mute uppercase tracking-[0.5px]"
          >
            {t('temperaturesTitle')}
          </h3>
          {metrics.components.length === 0 ? (
            <div className="flex justify-between px-2 py-1 tabular-nums">{t('noTempSensors')}</div>
          ) : (
            <div className="flex flex-col gap-1">
              {metrics.components
                .filter((c) => c.temperatureC !== null)
                .map((c, idx) => (
                  <div
                    key={c.label}
                    className={`flex justify-between px-2 py-1 tabular-nums${idx % 2 === 0 ? ' bg-surface' : ''}`}
                  >
                    <span>{c.label}</span>
                    <span>{c.temperatureC!.toFixed(1)}°C</span>
                  </div>
                ))}
            </div>
          )}
        </section>

        {/* Footer actions */}
        <div className="flex gap-2 pt-3 border-t border-hairline">
          <button
            type="button"
            className="px-3 py-1.5 bg-surface border border-hairline text-ink text-sm cursor-pointer transition-all hover:bg-hairline"
            onClick={handleOpenTaskManager}
          >
            {t('openTaskManager')}
          </button>
          <button
            type="button"
            className="px-3 py-1.5 bg-surface border border-hairline text-ink text-sm cursor-pointer transition-all hover:bg-hairline"
            onClick={handleExport}
          >
            {t('exportCsv')}
          </button>
        </div>
      </div>
    </Modal>
  );
};
