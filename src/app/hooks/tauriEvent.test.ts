import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTauriEvent } from './tauriEvent';

const tauriMocks = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriMocks.listen,
}));

describe('useTauriEvent', () => {
  beforeEach(() => {
    tauriMocks.listen.mockReset();
  });

  it('disposes a subscription that resolves after unmount', async () => {
    let resolveListen: ((unlisten: () => void) => void) | undefined;
    const unlisten = vi.fn();
    tauriMocks.listen.mockReturnValue(
      new Promise<() => void>((resolve) => {
        resolveListen = resolve;
      })
    );

    const { unmount } = renderHook(() => useTauriEvent('volt:test', vi.fn()));
    unmount();

    await act(async () => {
      resolveListen?.(unlisten);
      await Promise.resolve();
    });

    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('uses the latest handler without resubscribing', () => {
    let listener: ((event: { payload: string }) => void) | undefined;
    const first = vi.fn();
    const latest = vi.fn();
    tauriMocks.listen.mockImplementation(
      (_eventName: string, callback: (event: { payload: string }) => void) => {
        listener = callback;
        return Promise.resolve(vi.fn());
      }
    );

    const { rerender } = renderHook(
      ({ handler }) => useTauriEvent('volt:test', handler),
      { initialProps: { handler: first } }
    );

    rerender({ handler: latest });
    act(() => listener?.({ payload: 'payload' }));

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith('payload');
    expect(tauriMocks.listen).toHaveBeenCalledOnce();
  });
});
