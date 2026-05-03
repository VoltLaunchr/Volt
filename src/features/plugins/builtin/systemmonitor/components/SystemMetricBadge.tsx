import React from 'react';
import { cn } from '@/lib/utils';

interface SystemMetricBadgeProps {
  value: number;
  status: 'normal' | 'moderate' | 'high' | 'critical';
}

const fillColors: Record<SystemMetricBadgeProps['status'], string> = {
  normal: 'linear-gradient(90deg, rgba(16,185,129,0.3), rgba(16,185,129,0.5))',
  moderate: 'linear-gradient(90deg, rgba(245,158,11,0.3), rgba(245,158,11,0.5))',
  high: 'linear-gradient(90deg, rgba(249,115,22,0.3), rgba(249,115,22,0.5))',
  critical: 'linear-gradient(90deg, rgba(239,68,68,0.3), rgba(239,68,68,0.5))',
};

export function SystemMetricBadge({ value, status }: SystemMetricBadgeProps): React.JSX.Element {
  const rounded = Math.round(value);
  return (
    <div
      className={cn(
        'relative inline-flex items-center justify-center h-5 min-w-[50px] px-2 rounded-full bg-surface overflow-hidden text-xs font-medium tabular-nums',
        status === 'critical' && 'animate-pulse'
      )}
      role="progressbar"
      aria-valuenow={rounded}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${status}: ${rounded}%`}
    >
      <div
        className="absolute top-0 left-0 h-full rounded-full transition-all duration-300"
        style={{ width: `${value}%`, background: fillColors[status] }}
      />
      <span className="relative z-10 text-ink" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
        {rounded}%
      </span>
    </div>
  );
}
