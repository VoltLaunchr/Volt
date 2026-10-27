import { expect, it } from 'vitest';
import { formatIndexDiagnostics, type IndexDiagnostics } from './indexDiagnostics';

it('exports at most 50 scans without paths or extra fields', () => {
  const scan = {
    kind: 'initial' as const,
    completedAt: 1,
    scanMs: 2,
    persistMs: 3,
    totalMs: 5,
    indexedCount: 10,
    rootCount: 1,
    added: 10,
    removed: 0,
    modified: 0,
    path: 'C:/private/user',
  };
  const stats: IndexDiagnostics & { folders: string[] } = {
    indexedCount: 10,
    dbSizeBytes: 20,
    lastFullScan: 1,
    isWatching: true,
    staleCatchupCount: 0,
    lastStaleCatchup: 0,
    scanHistory: Array(60).fill(scan),
    scanDurationMedianMs: 5,
    scanDurationRecentMs: 5,
    folders: ['C:/private/user'],
    watcherChurn: [
      { day: 1, root: 'Root 1', events: 7 },
      { day: 1, root: 'C:/private/user', events: 2 },
    ],
  };
  const report = formatIndexDiagnostics(stats);
  expect(JSON.parse(report).scans).toHaveLength(50);
  expect(report).not.toContain('private');
  expect(report).not.toContain('folders');
  expect(JSON.parse(report).scanDurationMedianMs).toBe(5);
  expect(JSON.parse(report).watcherChurn).toEqual([
    { day: 1, root: 'Root 1', events: 7 },
    { day: 1, root: 'Other roots', events: 2 },
  ]);
});
