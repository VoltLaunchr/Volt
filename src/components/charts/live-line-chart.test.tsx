import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveLineChart } from './live-line-chart';
import { useChart } from './use-chart';

vi.mock('@visx/responsive', () => ({
  ParentSize: ({
    children,
  }: {
    children: (size: { width: number; height: number }) => React.ReactNode;
  }) => children({ width: 320, height: 140 }),
}));

function DomainProbe() {
  const { yScale } = useChart();
  return <text data-testid="domain">{yScale.domain().join(',')}</text>;
}
afterEach(() => vi.restoreAllMocks());

describe('Bklit system monitor chart behavior', () => {
  it('keeps the complete percent scale visible instead of centering a high value', () => {
    render(
      <LiveLineChart data={[{ time: 100, value: 100 }]} value={100} yDomain={[0, 100]} paused>
        <DomainProbe />
      </LiveLineChart>
    );
    expect(screen.getByTestId('domain')).toHaveTextContent('0,100');
  });
  it('does not schedule animation frames while paused', () => {
    const request = vi.spyOn(window, 'requestAnimationFrame');
    render(
      <LiveLineChart data={[]} value={42} paused>
        <DomainProbe />
      </LiveLineChart>
    );
    expect(request).not.toHaveBeenCalled();
  });
});
