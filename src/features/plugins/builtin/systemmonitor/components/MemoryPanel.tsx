import React from 'react';
import { MemoryStick } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { capacityValues } from './resourceChartData';

export function MemoryPanel({
  used,
  total,
  historyChart,
}: {
  used: number;
  total: number;
  historyChart: React.ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation('systemmonitor');
  const capacity = capacityValues(used, total);
  const status = capacity.percent >= 90 ? 'critical' : capacity.percent >= 75 ? 'high' : 'normal';
  return (
    <section className="sm-panel sm-memory sm-memory-detail">
      <div className="sm-memory-capacity">
        <div className="sm-card-heading">
          <span className="sm-memory-caption">
            <MemoryStick size={15} />
            {t('dashboard.memoryUsageLabel')}
          </span>
          <span className={`sm-status sm-status-${status}`}>{t(`dashboard.status.${status}`)}</span>
        </div>
        <div className="sm-memory-percentage">
          <strong>
            {capacity.percent.toFixed(1)}
            <small>%</small>
          </strong>
          <span>{t('dashboard.occupied')}</span>
        </div>
        <p className="sm-memory-used">
          <strong>{capacity.used.toFixed(1)}</strong> / {capacity.total.toFixed(1)}{' '}
          {t('dashboard.gb')}
        </p>
        <div
          className="sm-memory-meter"
          role="meter"
          aria-label={t('memory')}
          aria-valuenow={capacity.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${capacity.percent}%` }} />
        </div>
        <p className="sm-memory-available">
          <i />
          {t('dashboard.free', { value: capacity.free.toFixed(1) })}
        </p>
      </div>
      <div className="sm-memory-history">
        <span className="sm-memory-caption">{t('dashboard.sessionOnly')}</span>
        {historyChart}
      </div>
    </section>
  );
}
