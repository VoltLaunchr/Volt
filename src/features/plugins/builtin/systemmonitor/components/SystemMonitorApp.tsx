import React, { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSystemMetricsV2 } from '../useSystemMetricsV2';
import { useMetricsHistory, type MetricSample } from '../useMetricsHistory';
import { exportMetricsCsv, formatBytesPerSec, formatUptime } from '../utils';
import { LiveLineChart } from '../../../../../components/charts/live-line-chart';
import { LiveLine } from '../../../../../components/charts/live-line';
import { logger } from '../../../../../shared/utils/logger';
import type { CpuCoreInfo, ProcessInfo, DiskInfo, ComponentInfo } from '../types';

// ── Semantic accent colors ────────────────────────────────────────────────────
const A = {
  cpu:  '#2dd4bf',
  mem:  '#a78bfa',
  disk: '#fb923c',
  rx:   '#34d399',
  tx:   '#f472b6',
  red:  '#f87171',
} as const;

// ── Shared panel style (inline, no CSS file needed) ───────────────────────────
const panel: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-hairline)',
  borderRadius: '8px',
  padding: '14px 16px',
};

const CHART_MARGIN = { top: 0, right: 0, bottom: 0, left: 0 };

// ── Status helpers ────────────────────────────────────────────────────────────
function statusColor(v: number): string {
  if (v >= 90) return A.red;
  if (v >= 75) return A.disk;
  if (v >= 50) return '#fbbf24';
  return A.rx;
}

function statusLabel(v: number): string {
  if (v >= 90) return 'Critical';
  if (v >= 75) return 'High';
  if (v >= 50) return 'Moderate';
  return 'Normal';
}

function toPoints(history: MetricSample[], getValue: (s: MetricSample) => number) {
  return history.map((s) => ({ time: s.timestamp / 1000, value: getValue(s) }));
}

// ── Btn ───────────────────────────────────────────────────────────────────────
function Btn({
  onClick,
  children,
  danger,
  square,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  square?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: square ? undefined : '4px 10px',
        width: square ? 26 : undefined,
        height: square ? 26 : undefined,
        fontSize: 11,
        background: hov
          ? danger
            ? 'var(--color-accent-red-soft)'
            : 'var(--color-surface-elevated)'
          : 'transparent',
        border: `1px solid ${
          hov
            ? danger
              ? 'var(--color-accent-red)'
              : 'var(--color-hairline-strong)'
            : 'var(--color-hairline)'
        }`,
        color: hov
          ? danger
            ? 'var(--color-accent-red)'
            : 'var(--color-ink)'
          : 'var(--color-body)',
        cursor: 'pointer',
        borderRadius: '4px',
        transition: 'all 0.12s',
        fontFamily: 'var(--font-sans)',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

// ── SectionLabel ──────────────────────────────────────────────────────────────
function SectionLabel({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: 'var(--color-ash)',
        marginBottom: 10,
      }}
    >
      {title}
    </div>
  );
}

// ── MetricHeroCard ────────────────────────────────────────────────────────────
function MetricHeroCard({
  label,
  value,
  color,
  detail,
  points,
}: {
  label: string;
  value: number;
  color: string;
  detail: string;
  points: Array<{ time: number; value: number }>;
}) {
  const sc = statusColor(value);
  return (
    <div
      style={{
        ...panel,
        flex: 1,
        minWidth: 0,
        padding: '16px 18px 14px',
        borderLeft: `3px solid ${color}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: 'var(--color-ash)',
          }}
        >
          {label}
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 11,
            color: sc,
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: sc,
              flexShrink: 0,
            }}
          />
          {statusLabel(value)}
        </span>
      </div>

      {/* Value */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, lineHeight: 1 }}>
        <span
          style={{
            fontSize: 34,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: 'var(--color-ink)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {value.toFixed(1)}
        </span>
        <span
          style={{
            fontSize: 16,
            color: 'var(--color-stone)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          %
        </span>
      </div>

      {/* Sparkline */}
      <LiveLineChart
        data={points}
        value={value}
        dataKey="value"
        window={60}
        style={{ height: 50 }}
        margin={CHART_MARGIN}
      >
        <LiveLine
          dataKey="value"
          stroke={color}
          fill
          badge={false}
          formatValue={(v) => `${v.toFixed(1)}%`}
        />
      </LiveLineChart>

      {/* Detail */}
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-ash)',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.02em',
        }}
      >
        {detail}
      </div>
    </div>
  );
}

// ── CoreRow ───────────────────────────────────────────────────────────────────
function CoreRow({ core }: { core: CpuCoreInfo }) {
  const color = statusColor(core.usagePercent);
  const label = core.name.replace(/^cpu\s*/i, '').trim() || core.name;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '32px 1fr 30px',
        alignItems: 'center',
        gap: 8,
        padding: '3px 0',
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: 'var(--color-ash)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {label}
      </span>
      <div
        style={{
          height: 4,
          background: 'var(--color-hairline)',
          borderRadius: '9999px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${core.usagePercent}%`,
            height: '100%',
            background: color,
            borderRadius: '9999px',
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      <span
        style={{
          fontSize: 10,
          color,
          fontFamily: 'var(--font-mono)',
          textAlign: 'right',
        }}
      >
        {Math.round(core.usagePercent)}%
      </span>
    </div>
  );
}

// ── ProcessRow ────────────────────────────────────────────────────────────────
function ProcessRow({
  proc,
  valueLabel,
  barPct,
  onKill,
}: {
  proc: ProcessInfo;
  valueLabel: string;
  barPct: number;
  onKill: (pid: number, name: string) => void;
}) {
  const [hov, setHov] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => {
        setHov(false);
        setConfirming(false);
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderRadius: '4px',
        background: hov ? 'var(--color-surface-elevated)' : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      {/* Name + bar */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: 'var(--color-ink)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={`${proc.name} (PID ${proc.pid})`}
          >
            {proc.name}
          </span>
          <span
            style={{
              fontSize: 11,
              color: 'var(--color-mute)',
              fontFamily: 'var(--font-mono)',
              flexShrink: 0,
            }}
          >
            {valueLabel}
          </span>
        </div>
        <div
          style={{
            height: 3,
            background: 'var(--color-hairline)',
            borderRadius: '9999px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.min(barPct, 100)}%`,
              height: '100%',
              background: A.red,
              opacity: 0.65,
              borderRadius: '9999px',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      </div>

      {/* Kill action */}
      {confirming ? (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button
            onClick={() => {
              onKill(proc.pid, proc.name);
              setConfirming(false);
            }}
            style={{
              padding: '2px 8px',
              fontSize: 10,
              background: 'var(--color-accent-red-soft)',
              border: '1px solid var(--color-accent-red)',
              color: 'var(--color-accent-red)',
              cursor: 'pointer',
              borderRadius: '4px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Kill
          </button>
          <button
            onClick={() => setConfirming(false)}
            style={{
              padding: '2px 6px',
              fontSize: 10,
              background: 'transparent',
              border: '1px solid var(--color-hairline)',
              color: 'var(--color-ash)',
              cursor: 'pointer',
              borderRadius: '4px',
            }}
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          title={`Kill ${proc.name} (PID ${proc.pid})`}
          style={{
            width: 22,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: '1px solid transparent',
            color: 'var(--color-ash)',
            cursor: 'pointer',
            borderRadius: '4px',
            fontSize: 11,
            opacity: hov ? 1 : 0,
            pointerEvents: hov ? 'auto' : 'none',
            transition: 'opacity 0.1s',
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── DiskRow ───────────────────────────────────────────────────────────────────
function DiskRow({ disk }: { disk: DiskInfo }) {
  const pct = disk.totalGb > 0 ? (disk.usedGb / disk.totalGb) * 100 : 0;
  const color = statusColor(pct);
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span
            style={{
              fontSize: 10,
              color: 'var(--color-ash)',
              background: 'var(--color-surface-elevated)',
              padding: '1px 6px',
              borderRadius: '9999px',
              fontFamily: 'var(--font-mono)',
              flexShrink: 0,
            }}
          >
            {disk.kind}
          </span>
          <span
            style={{
              fontSize: 12,
              color: 'var(--color-body)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={disk.mountPoint}
          >
            {disk.mountPoint}
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            color,
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
          }}
        >
          {pct.toFixed(0)}%
        </span>
      </div>
      <div
        style={{
          height: 4,
          background: 'var(--color-hairline)',
          borderRadius: '9999px',
          overflow: 'hidden',
          marginBottom: 5,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: '9999px',
            transition: 'width 0.5s ease',
          }}
        />
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--color-ash)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {disk.usedGb.toFixed(1)} / {disk.totalGb.toFixed(1)} GB &nbsp;·&nbsp;{' '}
        {disk.availableGb.toFixed(1)} GB free
      </div>
    </div>
  );
}

// ── TempRow ───────────────────────────────────────────────────────────────────
function TempRow({ comp }: { comp: ComponentInfo }) {
  if (comp.temperatureC === null) return null;
  const temp = comp.temperatureC;
  const critC = comp.criticalC ?? 105;
  const maxC = comp.maxC ?? 90;
  const pct = Math.min((temp / critC) * 100, 100);
  const tColor = temp > maxC ? A.red : temp > maxC * 0.8 ? A.disk : '#fbbf24';

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 5,
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: 'var(--color-body)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '75%',
          }}
          title={comp.label}
        >
          {comp.label}
        </span>
        <span style={{ fontSize: 11, color: tColor, fontFamily: 'var(--font-mono)' }}>
          {temp.toFixed(1)}°C
        </span>
      </div>
      <div
        style={{
          height: 3,
          background: 'var(--color-hairline)',
          borderRadius: '9999px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: tColor,
            borderRadius: '9999px',
            transition: 'width 0.5s ease',
          }}
        />
      </div>
    </div>
  );
}

// ── NetStat ───────────────────────────────────────────────────────────────────
function NetStat({
  label,
  color,
  value,
  points,
}: {
  label: string;
  color: string;
  value: number;
  points: Array<{ time: number; value: number }>;
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color,
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-ink)', fontFamily: 'var(--font-mono)' }}>
          {formatBytesPerSec(value)}
        </span>
      </div>
      <LiveLineChart
        data={points}
        value={value}
        dataKey="value"
        window={60}
        style={{ height: 36 }}
        margin={CHART_MARGIN}
      >
        <LiveLine
          dataKey="value"
          stroke={color}
          fill
          badge={false}
          pulse={false}
          formatValue={(v) => formatBytesPerSec(v)}
        />
      </LiveLineChart>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────
export function SystemMonitorApp(): React.JSX.Element {
  const { metrics, isLoading } = useSystemMetricsV2(1000);
  const history = useMetricsHistory(metrics, 90);
  const [killError, setKillError] = useState<string | null>(null);
  const [processTab, setProcessTab] = useState<'cpu' | 'memory'>('cpu');

  const cpuPoints  = useMemo(() => toPoints(history, (s) => s.cpuUsage),    [history]);
  const memPoints  = useMemo(() => toPoints(history, (s) => s.memoryUsage),  [history]);
  const diskPoints = useMemo(() => toPoints(history, (s) => s.diskUsage),    [history]);
  const rxPoints   = useMemo(() => toPoints(history, (s) => s.networkRxBps), [history]);
  const txPoints   = useMemo(() => toPoints(history, (s) => s.networkTxBps), [history]);

  const handleKill = useCallback(async (pid: number, name: string) => {
    try {
      await invoke<void>('kill_process_by_pid', { pid });
      logger.info(`Killed process ${name} (${pid})`);
      setKillError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('kill_process_by_pid failed:', msg);
      setKillError(`Failed to kill ${name} (PID ${pid}): ${msg}`);
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

  const handleTaskManager = useCallback(async () => {
    try {
      await invoke<void>('open_task_manager');
    } catch (e) {
      logger.error('open_task_manager failed:', e);
    }
  }, []);

  const handleClose = useCallback(async () => {
    try {
      await getCurrentWindow().close();
    } catch (e) {
      logger.error('window close failed:', e);
    }
  }, []);

  const handleTitlebarMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button')) return;
      void (async () => {
        try {
          if (e.detail === 2) {
            await getCurrentWindow().toggleMaximize();
          } else {
            await getCurrentWindow().startDragging();
          }
        } catch (err) {
          logger.error('startDragging failed:', err);
        }
      })();
    },
    [],
  );

  const rootStyle: React.CSSProperties = {
    width: '100vw',
    height: '100vh',
    background: 'var(--color-canvas)',
    color: 'var(--color-ink)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'var(--font-sans)',
    fontSize: 13,
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!metrics) {
    return (
      <div style={{ ...rootStyle, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <div
          style={{
            width: 28,
            height: 28,
            border: `2px solid ${A.cpu}`,
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
          }}
        />
        <span style={{ fontSize: 12, color: 'var(--color-ash)', letterSpacing: '0.04em' }}>
          {isLoading ? 'Loading…' : 'No data'}
        </span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const maxCpuVal = Math.max(...metrics.topCpuProcesses.map((p) => p.cpuUsagePercent), 1);
  const maxMemVal = Math.max(...metrics.topMemoryProcesses.map((p) => p.memoryBytes), 1);
  const processes = processTab === 'cpu' ? metrics.topCpuProcesses : metrics.topMemoryProcesses;

  return (
    <div style={rootStyle}>
      {/* ── Titlebar ──────────────────────────────────────────────────────── */}
      <div
        onMouseDown={handleTitlebarMouseDown}
        style={{
          height: 44,
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-hairline)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
          gap: 10,
          flexShrink: 0,
          userSelect: 'none',
          cursor: 'grab',
        }}
      >
        {/* Icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
          <path d="M13 2L4.5 13.5H11L9 22L20 9.5H13.5L16 2H13Z" fill={A.cpu} />
        </svg>

        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-ink)',
            letterSpacing: '-0.01em',
          }}
        >
          System Monitor
        </span>

        <div
          style={{ width: 1, height: 14, background: 'var(--color-hairline)', marginLeft: 2 }}
        />

        <span
          style={{
            fontSize: 11,
            color: 'var(--color-ash)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          ↑ {formatUptime(metrics.uptimeSeconds)}
        </span>

        <div style={{ flex: 1 }} />

        <Btn onClick={() => { void handleExport(); }}>Export CSV</Btn>
        <Btn onClick={() => { void handleTaskManager(); }}>Task Manager</Btn>
        <Btn onClick={() => { void handleClose(); }} danger square>✕</Btn>
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 18px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* Kill error banner */}
        {killError && (
          <div
            role="alert"
            style={{
              padding: '8px 12px',
              background: 'var(--color-accent-red-soft)',
              border: '1px solid var(--color-accent-red)',
              color: 'var(--color-accent-red)',
              fontSize: 12,
              borderRadius: '6px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>{killError}</span>
            <button
              onClick={() => setKillError(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-accent-red)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 14,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Row 1: Hero metrics ────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 14 }}>
          <MetricHeroCard
            label="CPU"
            value={metrics.cpuUsage}
            color={A.cpu}
            detail={`${metrics.perCoreCpu.length} logical cores`}
            points={cpuPoints}
          />
          <MetricHeroCard
            label="Memory"
            value={metrics.memoryUsage}
            color={A.mem}
            detail={`${metrics.memoryUsedGb.toFixed(1)} / ${metrics.memoryTotalGb.toFixed(1)} GB  ·  ${(metrics.memoryTotalGb - metrics.memoryUsedGb).toFixed(1)} GB free`}
            points={memPoints}
          />
          <MetricHeroCard
            label="Disk"
            value={metrics.diskUsage}
            color={A.disk}
            detail={`${metrics.diskUsedGb.toFixed(0)} / ${metrics.diskTotalGb.toFixed(0)} GB  ·  ${(metrics.diskTotalGb - metrics.diskUsedGb).toFixed(0)} GB free`}
            points={diskPoints}
          />
        </div>

        {/* ── Row 2: CPU cores + Processes ──────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* CPU Cores */}
          <div style={panel}>
            <SectionLabel title="CPU Cores" />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                columnGap: 16,
              }}
            >
              {metrics.perCoreCpu.map((core) => (
                <CoreRow key={core.name} core={core} />
              ))}
            </div>
          </div>

          {/* Processes — tabbed */}
          <div
            style={{
              ...panel,
              padding: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Tab bar */}
            <div
              style={{
                display: 'flex',
                borderBottom: '1px solid var(--color-hairline)',
                padding: '0 16px',
                flexShrink: 0,
              }}
            >
              {(['cpu', 'memory'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setProcessTab(tab)}
                  style={{
                    padding: '10px 12px',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    background: 'transparent',
                    border: 'none',
                    borderBottom:
                      processTab === tab
                        ? `2px solid ${A.cpu}`
                        : '2px solid transparent',
                    color:
                      processTab === tab ? 'var(--color-ink)' : 'var(--color-ash)',
                    cursor: 'pointer',
                    transition: 'color 0.15s',
                    marginBottom: -1,
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {tab === 'cpu' ? 'Top CPU' : 'Top Memory'}
                </button>
              ))}
            </div>

            {/* Process list */}
            <div style={{ padding: '8px', overflowY: 'auto', flex: 1 }}>
              {processes.slice(0, 5).map((p) => (
                <ProcessRow
                  key={processTab === 'cpu' ? `cpu-${p.pid}` : `mem-${p.pid}`}
                  proc={p}
                  valueLabel={
                    processTab === 'cpu'
                      ? `${p.cpuUsagePercent.toFixed(1)}%`
                      : `${(p.memoryBytes / (1024 * 1024)).toFixed(0)} MB`
                  }
                  barPct={
                    processTab === 'cpu'
                      ? (p.cpuUsagePercent / maxCpuVal) * 100
                      : (p.memoryBytes / maxMemVal) * 100
                  }
                  onKill={(pid, name) => {
                    void handleKill(pid, name);
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ── Row 3: Network + Storage + Temperatures ────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          {/* Network */}
          <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SectionLabel title="Network" />
            <NetStat
              label="↓ Download"
              color={A.rx}
              value={metrics.network.receivedBytesPerSec}
              points={rxPoints}
            />
            <NetStat
              label="↑ Upload"
              color={A.tx}
              value={metrics.network.transmittedBytesPerSec}
              points={txPoints}
            />
            {metrics.network.interfaces.slice(0, 4).map((iface) => (
              <div
                key={iface.name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 6,
                  alignItems: 'center',
                  paddingTop: 6,
                  borderTop: '1px solid var(--color-hairline)',
                  fontSize: 10,
                }}
              >
                <span
                  style={{
                    color: 'var(--color-ash)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {iface.name}
                </span>
                <span style={{ color: A.rx, fontFamily: 'var(--font-mono)' }}>
                  ↓ {formatBytesPerSec(iface.receivedBytesPerSec)}
                </span>
                <span style={{ color: A.tx, fontFamily: 'var(--font-mono)' }}>
                  ↑ {formatBytesPerSec(iface.transmittedBytesPerSec)}
                </span>
              </div>
            ))}
          </div>

          {/* Storage */}
          <div style={panel}>
            <SectionLabel title="Storage" />
            {metrics.perDisk.map((disk) => (
              <DiskRow key={disk.mountPoint} disk={disk} />
            ))}
          </div>

          {/* Temperatures */}
          <div style={panel}>
            <SectionLabel title="Temperatures" />
            {metrics.components.filter((c) => c.temperatureC !== null).length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-ash)' }}>
                No sensor data available
              </div>
            ) : (
              metrics.components
                .filter((c) => c.temperatureC !== null)
                .map((c) => <TempRow key={c.label} comp={c} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
