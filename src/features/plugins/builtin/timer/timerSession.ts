import { timerStore } from './timerStore';

export type TimerMode = 'focus' | 'short' | 'long' | 'custom';
export interface FocusSession {
  mode: TimerMode;
  sessionsDone: number;
  activeTimerId: string | null;
  customMs: number;
}
const KEY = 'volt-pomodoro-session';
const DEFAULTS: FocusSession = {
  mode: 'focus',
  sessionsDone: 0,
  activeTimerId: null,
  customMs: 600_000,
};
export function readFocusSession(): FocusSession {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!value || typeof value !== 'object') return { ...DEFAULTS };
    const s = value as Partial<FocusSession>;
    const result: FocusSession = {
      mode: ['focus', 'short', 'long', 'custom'].includes(s.mode ?? '') ? s.mode! : 'focus',
      sessionsDone:
        Number.isInteger(s.sessionsDone) && s.sessionsDone! >= 0 && s.sessionsDone! <= 4
          ? s.sessionsDone!
          : 0,
      activeTimerId:
        typeof s.activeTimerId === 'string' &&
        (timerStore.getTimer(s.activeTimerId) || timerStore.getCompletedTimer(s.activeTimerId))
          ? s.activeTimerId
          : null,
      customMs:
        typeof s.customMs === 'number' &&
        Number.isFinite(s.customMs) &&
        s.customMs >= 1000 &&
        s.customMs <= 86_400_000
          ? s.customMs
          : DEFAULTS.customMs,
    };
    return result.activeTimerId && timerStore.getCompletedTimer(result.activeTimerId)
      ? advanceFocusSession(result, true)
      : result;
  } catch {
    return { ...DEFAULTS };
  }
}
export function advanceFocusSession(s: FocusSession, completed: boolean): FocusSession {
  if (s.mode === 'custom') return { ...s, activeTimerId: null };
  if (s.mode === 'focus') {
    const sessionsDone = Math.min(4, s.sessionsDone + (completed ? 1 : 0));
    return { ...s, activeTimerId: null, sessionsDone, mode: sessionsDone >= 4 ? 'long' : 'short' };
  }
  return {
    ...s,
    activeTimerId: null,
    mode: 'focus',
    sessionsDone: s.mode === 'long' ? 0 : s.sessionsDone,
  };
}

// This subscription deliberately outlives the view: hiding Volt must not lose a completed phase.
let snapshot = readFocusSession();
const listeners = new Set<() => void>();
function update(next: FocusSession): void {
  snapshot = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage may be unavailable */
  }
  listeners.forEach((listener) => listener());
}
update(snapshot);
timerStore.subscribe((event) => {
  if (event.timer.id !== snapshot.activeTimerId) return;
  if (event.type === 'complete') update(advanceFocusSession(snapshot, true));
  else if (event.type === 'cancel') update({ ...snapshot, activeTimerId: null });
});
export const focusSession = {
  getSnapshot: () => snapshot,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  update,
};
