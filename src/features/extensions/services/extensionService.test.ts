import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extensionService } from './extensionService';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../../shared/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

describe('extension registry availability', () => {
  beforeEach(() => vi.resetAllMocks());

  it('exposes total source failure to the store instead of claiming an empty catalog', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('offline'));
    await expect(extensionService.fetchRegistry({ throwOnFailure: true })).rejects.toThrow(
      'Extension registry unavailable'
    );
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('preserves the empty fallback for callers that did not opt in to errors', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('offline'));
    await expect(extensionService.fetchRegistry()).resolves.toMatchObject({
      version: '0.0.0',
      extensions: [],
    });
  });

  it('treats a successfully loaded empty catalog as a success', async () => {
    const empty = { version: '2', lastUpdated: '2026-10-25', extensions: [] };
    vi.mocked(invoke).mockResolvedValue(empty);
    await expect(extensionService.fetchRegistry({ throwOnFailure: true })).resolves.toEqual(empty);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('recovers through the fallback source when only the primary source fails', async () => {
    const fallback = { version: '3', lastUpdated: '2026-10-25', extensions: [] };
    vi.mocked(invoke)
      .mockRejectedValueOnce(new Error('primary unavailable'))
      .mockResolvedValueOnce(fallback);
    await expect(extensionService.fetchRegistry({ throwOnFailure: true })).resolves.toEqual(
      fallback
    );
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(vi.mocked(invoke).mock.calls[0][1]).not.toEqual(vi.mocked(invoke).mock.calls[1][1]);
  });
});
