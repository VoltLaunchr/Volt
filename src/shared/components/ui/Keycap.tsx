import React from 'react';
import { cn } from '@/lib/utils';

interface KeycapProps {
  children: React.ReactNode;
  className?: string;
}

export function Keycap({ children, className }: KeycapProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center px-1.5 py-px',
        'rounded-xs text-[11px] font-medium text-mute leading-none',
        'bg-surface-card border border-hairline',
        'min-w-[18px] h-[18px]',
        className
      )}
    >
      {children}
    </span>
  );
}
