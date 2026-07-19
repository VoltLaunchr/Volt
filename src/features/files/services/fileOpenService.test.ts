import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { openFilePath, openPath } from './fileOpenService';

describe('fileOpenService', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('opens files through open_path and records file access', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await openFilePath({ path: 'C:\\Users\\Volt\\Document.pdf', name: 'Document.pdf' });

    expect(invoke).toHaveBeenNthCalledWith(1, 'open_path', {
      path: 'C:\\Users\\Volt\\Document.pdf',
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'track_file_access', {
      path: 'C:\\Users\\Volt\\Document.pdf',
      name: 'Document.pdf',
    });
  });

  it('does not track access when opening the file fails', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('blocked'));

    await expect(openFilePath({ path: 'C:\\blocked.txt', name: 'blocked.txt' })).rejects.toThrow(
      'blocked',
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('open_path', { path: 'C:\\blocked.txt' });
  });

  it('opens folders and other paths through open_path', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await openPath('C:\\Users\\Volt\\Documents');

    expect(invoke).toHaveBeenCalledWith('open_path', { path: 'C:\\Users\\Volt\\Documents' });
  });
});
