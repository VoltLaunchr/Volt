import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('shared application icons', () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
  });

  it('reuses a pending extraction and its completed result', async () => {
    let resolve!: (value: string) => void;
    invoke.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done;
      })
    );
    const { loadAppIcon } = await import('./appIconService');
    const first = loadAppIcon('app.exe');
    const second = loadAppIcon('app.exe');
    expect(second).toBe(first);
    resolve('data:image/png;base64,icon');
    await first;
    expect(await loadAppIcon('app.exe')).toBe('data:image/png;base64,icon');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('caches failures briefly and retries after their deadline', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      invoke.mockRejectedValueOnce(new Error('missing')).mockResolvedValue('icon');
      const { loadAppIcon } = await import('./appIconService');
      expect(await loadAppIcon('missing.exe')).toBeNull();
      expect(await loadAppIcon('missing.exe')).toBeNull();
      expect(invoke).toHaveBeenCalledTimes(1);
      now.mockReturnValue(31_001);
      expect(await loadAppIcon('missing.exe')).toBe('icon');
      expect(invoke).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it('bounds pending IPC and evicts completed entries', async () => {
    invoke.mockReturnValue(new Promise(() => {}));
    const { loadAppIcon } = await import('./appIconService');
    for (let i = 0; i < 128; i++) void loadAppIcon(String(i));
    expect(await loadAppIcon('overflow')).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(128);
  });
});
