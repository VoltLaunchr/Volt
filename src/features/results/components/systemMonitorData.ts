interface MonitorData {
  type: 'cpu' | 'memory' | 'disk';
  value: number;
}

/** Search pipelines may pass either the plugin envelope or its inner payload. */
export function getSystemMonitorData(value: unknown): MonitorData | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    (record.type === 'cpu' || record.type === 'memory' || record.type === 'disk') &&
    typeof record.value === 'number' &&
    Number.isFinite(record.value)
  ) {
    return { type: record.type, value: Math.min(100, Math.max(0, record.value)) };
  }
  if (record.data && typeof record.data === 'object') {
    const inner = record.data as Record<string, unknown>;
    if (
      (inner.type === 'cpu' || inner.type === 'memory' || inner.type === 'disk') &&
      typeof inner.value === 'number' &&
      Number.isFinite(inner.value)
    ) {
      return { type: inner.type, value: Math.min(100, Math.max(0, inner.value)) };
    }
  }
  return null;
}
