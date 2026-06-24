import { invoke } from '@tauri-apps/api/core';
import { logger } from '../../shared/utils/logger';

/**
 * Reconcile changes made while Volt (and its live watcher) were closed if the
 * persisted index is older than this many seconds. The live `notify` watcher
 * only sees changes while Volt runs; this is the cheap no-admin catch-up that
 * stands in for a USN-journal delta drain (see REFONTE-PILIER-D-SEARCH.md, D3).
 */
const STALE_INDEX_THRESHOLD_SECS = 3600;

export class FileWatcherLifecycle {
  private operationQueue: Promise<void> = Promise.resolve();
  private shouldBeRunning = false;
  private isRunning = false;
  private intentId = 0;

  start(): Promise<void> {
    const intentId = ++this.intentId;
    this.shouldBeRunning = true;

    return this.enqueue(async () => {
      if (intentId !== this.intentId || !this.shouldBeRunning || this.isRunning) return;

      await invoke<void>('start_file_watcher');
      this.isRunning = true;

      // A stop may have been requested while the backend command was pending.
      if (intentId !== this.intentId || !this.shouldBeRunning) {
        await invoke<void>('stop_file_watcher');
        this.isRunning = false;
        return;
      }

      // Catch up on changes made while Volt was closed (the watcher above only
      // sees live changes). Fire-and-forget: it returns immediately and the
      // reconcile runs detached in the backend, so it never blocks startup.
      void invoke<void>('refresh_index_if_stale', {
        staleSecs: STALE_INDEX_THRESHOLD_SECS,
      }).catch((err: unknown) => {
        logger.error('Failed to trigger stale-index catch-up:', err);
      });
    }, 'Failed to start file watcher:');
  }

  stop(): Promise<void> {
    this.intentId += 1;
    this.shouldBeRunning = false;

    return this.enqueue(async () => {
      if (!this.isRunning) return;

      await invoke<void>('stop_file_watcher');
      this.isRunning = false;
    }, 'Failed to stop file watcher:');
  }

  private enqueue(operation: () => Promise<void>, errorMessage: string): Promise<void> {
    this.operationQueue = this.operationQueue.then(operation).catch((err: unknown) => {
      logger.error(errorMessage, err);
    });

    return this.operationQueue;
  }
}
