import { invoke } from '@tauri-apps/api/core';
import { logger } from '../../shared/utils/logger';

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
      }
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
