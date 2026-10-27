import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SystemMonitorResult } from './SystemMonitorResult';
import { getSystemMonitorData } from './systemMonitorData';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

describe('system monitor search result', () => {
  it('reads the actual nested plugin payload used by the search pipeline', () => {
    const data = { type: 'system-monitor', data: { type: 'memory', value: 86.3 } };
    render(<SystemMonitorResult data={data} title="Memory" subtitle="2 GiB available" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '86.3');
    expect(screen.getByText('2 GiB available')).toBeInTheDocument();
  });
  it('supports direct values and rejects invalid readings', () => {
    expect(getSystemMonitorData({ type: 'cpu', value: 100 })).toEqual({ type: 'cpu', value: 100 });
    expect(getSystemMonitorData({ data: { type: 'cpu', value: NaN } })).toBeNull();
    expect(getSystemMonitorData({ data: { type: 'cpu', value: 110 } })?.value).toBe(100);
  });
});
