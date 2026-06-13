import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileWatcherLifecycle } from './fileWatcherLifecycle';

describe('FileWatcherLifecycle', () => {
  const mockInvoke = vi.mocked(invoke);

  beforeEach(() => {
    mockInvoke.mockResolvedValue(undefined);
  });

  it('coalesces concurrent start requests', async () => {
    const lifecycle = new FileWatcherLifecycle();

    await Promise.all([lifecycle.start(), lifecycle.start()]);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('start_file_watcher');
  });

  it('stops a watcher whose start resolves after cleanup', async () => {
    let resolveStart: (() => void) | undefined;
    mockInvoke.mockImplementation((command) => {
      if (command === 'start_file_watcher') {
        return new Promise<void>((resolve) => {
          resolveStart = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    const lifecycle = new FileWatcherLifecycle();
    const startPromise = lifecycle.start();

    await vi.waitFor(() => expect(resolveStart).toBeDefined());
    const stopPromise = lifecycle.stop();
    resolveStart?.();
    await Promise.all([startPromise, stopPromise]);

    expect(mockInvoke.mock.calls.map(([command]) => command)).toEqual([
      'start_file_watcher',
      'stop_file_watcher',
    ]);
  });
});
