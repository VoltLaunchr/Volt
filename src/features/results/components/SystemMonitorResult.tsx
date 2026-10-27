import { Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './system-monitor-result.css';
import { getSystemMonitorData } from './systemMonitorData';

export function SystemMonitorResultIcon({ data }: { data: unknown }) {
  const type = getSystemMonitorData(data)?.type ?? 'cpu';
  const Icon = type === 'cpu' ? Cpu : type === 'memory' ? MemoryStick : HardDrive;
  return (
    <span className="sm-result-icon" data-resource={type}>
      <Icon size={19} aria-hidden="true" />
    </span>
  );
}

export function SystemMonitorResult({
  data,
  title,
  subtitle,
}: {
  data: unknown;
  title: string;
  subtitle?: string;
}) {
  const { t, i18n } = useTranslation('systemmonitor');
  const metric = getSystemMonitorData(data);
  if (!metric)
    return (
      <div className="sm-result-copy">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
    );
  const status =
    metric.value >= 90
      ? 'critical'
      : metric.value >= 75
        ? 'high'
        : metric.value >= 50
          ? 'moderate'
          : 'normal';
  return (
    <div className="sm-result" data-status={status} data-resource={metric.type}>
      <div className="sm-result-copy">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <div className="sm-result-reading">
        <span className="sm-result-value">
          {new Intl.NumberFormat(i18n.language || 'en', { maximumFractionDigits: 1 }).format(
            metric.value
          )}
          <small>%</small>
        </span>
        <div
          className="sm-result-track"
          role="meter"
          aria-label={t(metric.type)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={metric.value}
          aria-valuetext={`${metric.value.toFixed(1)}% · ${t(`usage.${status}`)}`}
        >
          <span style={{ width: `${metric.value}%` }} />
        </div>
      </div>
    </div>
  );
}
