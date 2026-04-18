import React from 'react';
import './Sparkline.css';

interface SparklineProps {
  data: number[];
  min?: number;
  max?: number;
  width?: number;
  height?: number;
  color?: string;
  label?: string;
  valueSuffix?: string;
}

/**
 * Minimal dependency-free SVG sparkline. `min`/`max` default to the data range
 * (always including 0) so the curve can't be visually clipped.
 */
export const Sparkline: React.FC<SparklineProps> = ({
  data,
  min,
  max,
  width = 180,
  height = 40,
  color = 'var(--color-primary, #3b82f6)',
  label,
  valueSuffix = '',
}) => {
  const latest = data.length > 0 ? data[data.length - 1] : 0;
  const ariaLabel = label
    ? `${label}: ${latest.toFixed(1)}${valueSuffix}`
    : `Sparkline current value ${latest.toFixed(1)}${valueSuffix}`;

  if (data.length < 2) {
    return (
      <svg
        className="volt-sparkline"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
      >
        <line
          className="volt-sparkline__empty"
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
        />
      </svg>
    );
  }

  const dataMin = Math.min(...data, 0);
  const dataMax = Math.max(...data, 0);
  const lo = min !== undefined ? min : dataMin;
  const hi = max !== undefined ? max : dataMax;
  const range = hi - lo || 1;

  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - lo) / range) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const linePoints = points.join(' ');
  const areaPoints = `0,${height} ${linePoints} ${width},${height}`;

  return (
    <svg
      className="volt-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="none"
    >
      <polyline className="volt-sparkline__area" points={areaPoints} fill={color} />
      <polyline className="volt-sparkline__line" points={linePoints} stroke={color} />
    </svg>
  );
};
