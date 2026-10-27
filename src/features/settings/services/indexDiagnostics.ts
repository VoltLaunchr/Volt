export interface ScanMeasurement {
  kind: 'initial' | 'rebuild' | 'catchup';
  completedAt: number;
  scanMs: number;
  persistMs: number;
  totalMs: number;
  indexedCount: number;
  rootCount: number;
  added: number;
  removed: number;
  modified: number;
}

export interface IndexDiagnostics {
  indexedCount: number;
  dbSizeBytes: number;
  lastFullScan: number;
  isWatching: boolean;
  staleCatchupCount: number;
  lastStaleCatchup: number;
  scanHistory: ScanMeasurement[];
  scanDurationMedianMs: number | null;
  scanDurationRecentMs: number | null;
  watcherChurn?: Array<{ day: number; root: string; events: number }>;
}

// Select fields explicitly: never copy settings, paths or arbitrary IPC fields.
export function formatIndexDiagnostics(stats: IndexDiagnostics): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      indexedCount: stats.indexedCount,
      dbSizeBytes: stats.dbSizeBytes,
      isWatching: stats.isWatching,
      staleCatchupCount: stats.staleCatchupCount,
      scanDurationMedianMs: stats.scanDurationMedianMs,
      scanDurationRecentMs: stats.scanDurationRecentMs,
      watcherChurn: (stats.watcherChurn ?? []).slice(-600).map((entry) => ({
        day: entry.day,
        // Only generic labels may leave the app, even with a legacy payload.
        root: /^Root [1-9]\d*$/.test(entry.root) ? entry.root : 'Other roots',
        events: entry.events,
      })),
      scans: (stats.scanHistory ?? []).slice(-50).map((scan) => ({
        kind: scan.kind,
        completedAt: scan.completedAt,
        scanMs: scan.scanMs,
        persistMs: scan.persistMs,
        totalMs: scan.totalMs,
        indexedCount: scan.indexedCount,
        rootCount: scan.rootCount,
        added: scan.added,
        removed: scan.removed,
        modified: scan.modified,
      })),
    },
    null,
    2
  );
}
