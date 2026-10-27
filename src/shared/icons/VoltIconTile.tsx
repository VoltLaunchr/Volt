import type { JSX } from 'react';
import { cn } from '@/lib/utils';
import { VoltIcon } from './VoltIcon';
import type { VoltIconName } from './glyphs';

export interface VoltIconTileProps {
  name: VoltIconName;
  /** Active tiles take the accent tint and an inner 0.5px edge. */
  active?: boolean;
  /** Tile edge in px (default 22). */
  size?: number;
  title?: string;
  className?: string;
}

/** Rounded-square tile hosting a glyph; the background is derived from theme tokens. */
export function VoltIconTile({
  name,
  active = false,
  size = 22,
  title,
  className,
}: VoltIconTileProps): JSX.Element {
  return (
    <span
      data-active={active ? 'true' : undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[6px]',
        active ? 'bg-primary/15 text-primary' : 'bg-foreground/[0.06] text-current',
        className
      )}
      style={{
        width: size,
        height: size,
        boxShadow: active
          ? 'inset 0 0 0 0.5px color-mix(in oklab, var(--primary) 45%, var(--border))'
          : undefined,
      }}
    >
      <VoltIcon
        name={name}
        size={Math.round(size * 0.68)}
        variant={active ? 'filled' : 'outline'}
        title={title}
      />
    </span>
  );
}
