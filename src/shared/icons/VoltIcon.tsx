import type { CSSProperties, JSX } from 'react';
import { VOLT_GLYPHS, type GlyphPath, type VoltIconName } from './glyphs';

export type VoltIconVariant = 'outline' | 'filled';

export interface VoltIconProps {
  name: VoltIconName;
  /** Rendered size in px (the glyph is authored on a 16x16 grid). */
  size?: number;
  variant?: VoltIconVariant;
  /** Accessible name. When omitted the icon is decorative (aria-hidden). */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function VoltIcon({
  name,
  size = 16,
  variant = 'outline',
  title,
  className,
  style,
}: VoltIconProps): JSX.Element {
  const paths: readonly GlyphPath[] = VOLT_GLYPHS[name].paths;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {paths.map((path) => {
        const filled = variant === 'filled' && path.fill === true;
        return (
          <path
            key={path.d}
            d={path.d}
            fill={filled ? 'currentColor' : 'none'}
            fillOpacity={filled ? 0.28 : undefined}
          />
        );
      })}
    </svg>
  );
}
