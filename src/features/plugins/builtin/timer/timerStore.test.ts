import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../shared/services/nativeNotificationService', () => ({
  notifyNative: vi.fn().mockResolvedValue(undefined),
}));

const savedTimer = {
  id: 'restored',
  label: 'Focus',
  duration: 60_000,
  startTime: 1_000_000,
  endTime: 1_060_000,
  isPaused: true,
  remainingWhenPaused: 30_000,
};

describe('timer persistence and clock recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_010_000);
    localStorage.clear();
    vi.resetModules();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ticks after resuming a timer restored in pause', async () => {
    localStorage.setItem('volt-timers', JSON.stringify([savedTimer]));
    const { timerStore } = await import('./timerStore');
    const listener = vi.fn();
    timerStore.subscribe(listener);
    timerStore.resumeTimer('restored');
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'tick' }));
    expect(timerStore.getRemainingTime('restored')).toBe(29_000);
  });

  it('keeps bounded completion receipts for session recovery after restart', async () => {
    localStorage.setItem(
      'volt-timers',
      JSON.stringify([{ ...savedTimer, isPaused: false, endTime: 1_009_000 }])
    );
    const { timerStore } = await import('./timerStore');
    expect(timerStore.getTimer('restored')).toBeUndefined();
    expect(timerStore.getCompletedTimer('restored')?.label).toBe('Focus');
    expect(JSON.parse(localStorage.getItem('volt-completed-timers')!)).toHaveLength(1);
  });

  it('rejects corrupted restored records individually', async () => {
    localStorage.setItem(
      'volt-timers',
      JSON.stringify([null, {}, { ...savedTimer, duration: -1 }, savedTimer])
    );
    const { timerStore } = await import('./timerStore');
    expect(timerStore.getActiveTimers().map((timer) => timer.id)).toEqual(['restored']);
  });

  it('does not treat a cancellation as completion', async () => {
    const { timerStore } = await import('./timerStore');
    const id = timerStore.startTimer(10_000, 'Focus');
    timerStore.cancelTimer(id);
    expect(timerStore.getCompletedTimer(id)).toBeUndefined();
  });

  it.each([NaN, Infinity, -1000, 0, 999, 86_400_001])(
    'rejects invalid start duration %s',
    async (duration) => {
      const { timerStore } = await import('./timerStore');
      expect(() => timerStore.startTimer(duration, 'Focus')).toThrow(RangeError);
      expect(timerStore.getActiveTimers()).toEqual([]);
    }
  );
});
