import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCommandFrecency, recordCommandUsage, refreshCommandFrecency } from './commandFrecency';

const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriMocks.invoke }));

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('command frecency cache', () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
  });

  it('loads the Rust map and ignores malformed payloads', async () => {
    tauriMocks.invoke.mockResolvedValueOnce({ 'snippets:sig': 42, 'bad:entry': 'x' });
    await refreshCommandFrecency();
    expect(getCommandFrecency('snippets:sig')).toBe(42);
    expect(getCommandFrecency('bad:entry')).toBe(0);
    expect(getCommandFrecency(null)).toBe(0);

    tauriMocks.invoke.mockResolvedValueOnce([]);
    await refreshCommandFrecency();
    expect(getCommandFrecency('snippets:sig')).toBe(42);
  });

  it('records usage fire-and-forget and caches the returned date', async () => {
    tauriMocks.invoke.mockResolvedValueOnce(1_000);
    recordCommandUsage('systemcommands:syscmd-quit', 'Quit Volt');
    expect(tauriMocks.invoke).toHaveBeenCalledWith('record_command_usage', {
      identity: 'systemcommands:syscmd-quit',
      title: 'Quit Volt',
    });
    await flush();
    expect(getCommandFrecency('systemcommands:syscmd-quit')).toBe(1_000);
  });

  it('keeps a usage recorded while a refresh is in flight', async () => {
    let resolveRefresh: ((value: unknown) => void) | undefined;
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === 'get_command_frecency') {
        return new Promise((resolve) => {
          resolveRefresh = resolve;
        });
      }
      return Promise.resolve(5_000);
    });

    const refresh = refreshCommandFrecency();
    recordCommandUsage('quicklinks:ql-docs', 'Docs');
    await flush();
    resolveRefresh?.({ 'quicklinks:ql-docs': 4_000 });
    await refresh;

    expect(getCommandFrecency('quicklinks:ql-docs')).toBe(5_000);
  });

  it('never throws when the backend is unavailable', async () => {
    tauriMocks.invoke.mockRejectedValueOnce(new Error('offline'));
    await expect(refreshCommandFrecency()).resolves.toBeUndefined();
  });

  it('keeps the newest date when usage replies arrive out of order', async () => {
    let resolveOlder: ((date: number) => void) | undefined;
    tauriMocks.invoke
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            resolveOlder = resolve;
          })
      )
      .mockResolvedValueOnce(7_000);
    recordCommandUsage('quicklinks:out-of-order', 'Docs');
    recordCommandUsage('quicklinks:out-of-order', 'Docs');
    await flush();
    resolveOlder?.(6_000);
    await flush();
    expect(getCommandFrecency('quicklinks:out-of-order')).toBe(7_000);
  });

  it('rejects non-finite and negative dates without poisoning ranking', async () => {
    tauriMocks.invoke.mockResolvedValueOnce({ invalid: NaN, infinite: Infinity, negative: -1 });
    await refreshCommandFrecency();
    for (const identity of ['invalid', 'infinite', 'negative']) {
      expect(getCommandFrecency(identity)).toBe(0);
    }
    tauriMocks.invoke.mockResolvedValueOnce(Infinity);
    recordCommandUsage('invalid', 'Invalid');
    await flush();
    expect(getCommandFrecency('invalid')).toBe(0);
  });
});
