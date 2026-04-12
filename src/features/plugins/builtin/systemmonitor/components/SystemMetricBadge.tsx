import React from 'react';
import './SystemMetricBadge.css';

interface SystemMetricBadgeProps {
  value: number;
  status: 'normal' | 'moderate' | 'high' | 'critical';
}

export const SystemMetricBadge: React.FC<SystemMetricBadgeProps> = ({ value, status }) => {
  return (
    <div className={`system-metric-badge system-metric-badge--${status}`}>
      <div className="system-metric-badge__fill" style={{ width: `${value}%` }} />
      <span className="system-metric-badge__text">{value.toFixed(0)}%</span>
    </div>
  );
};
