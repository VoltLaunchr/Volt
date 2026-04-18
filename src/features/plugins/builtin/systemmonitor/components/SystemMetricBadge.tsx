import React from 'react';
import './SystemMetricBadge.css';

interface SystemMetricBadgeProps {
  value: number;
  status: 'normal' | 'moderate' | 'high' | 'critical';
}

export const SystemMetricBadge: React.FC<SystemMetricBadgeProps> = ({ value, status }) => {
  const rounded = Math.round(value);
  return (
    <div
      className={`system-metric-badge system-metric-badge--${status}`}
      role="progressbar"
      aria-valuenow={rounded}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${status}: ${rounded}%`}
    >
      <div className="system-metric-badge__fill" style={{ width: `${value}%` }} />
      <span className="system-metric-badge__text">{rounded}%</span>
    </div>
  );
};
