import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimerView } from './TimerView';
import { TimerDisplay } from './TimerDisplay';
import { timerStore } from './timerStore';
import { tasksStore } from './tasksStore';
import { advanceFocusSession, focusSession, readFocusSession } from './timerSession';
import en from './locales/en.json';

vi.mock('../../../../shared/services/nativeNotificationService', () => ({
  notifyNative: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, args?: Record<string, unknown>) => {
      const value = key
        .split('.')
        .reduce<unknown>((result, part) => (result as Record<string, unknown>)?.[part], en);
      return (typeof value === 'string' ? value : key).replace(/{{(\w+)}}/g, (_, name: string) =>
        typeof args?.[name] === 'number' || typeof args?.[name] === 'string' ? `${args[name]}` : ''
      );
    },
  }),
}));
const defaults = {
  mode: 'focus' as const,
  sessionsDone: 0,
  activeTimerId: null,
  customMs: 600_000,
};
beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no audio device; keep completion tests on the successful audio path.
  vi.stubGlobal(
    'AudioContext',
    class {
      currentTime = 0;
      destination = {};
      createOscillator() {
        return {
          connect: vi.fn(),
          frequency: { setValueAtTime: vi.fn() },
          start: vi.fn(),
          stop: vi.fn(),
          addEventListener: vi.fn(),
        };
      }
      createGain() {
        return { connect: vi.fn(), gain: { setValueAtTime: vi.fn() } };
      }
      close() {
        return Promise.resolve();
      }
    }
  );
  timerStore.getActiveTimers().forEach((timer) => timerStore.cancelTimer(timer.id));
  tasksStore.getTasks().forEach((task) => tasksStore.remove(task.id));
  localStorage.clear();
  focusSession.update({ ...defaults });
});
afterEach(() => {
  cleanup();
  timerStore.getActiveTimers().forEach((timer) => timerStore.cancelTimer(timer.id));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('Focus Timer session', () => {
  it('does not count skipped focus as completed work', () => {
    expect(advanceFocusSession(defaults, false)).toMatchObject({ mode: 'short', sessionsDone: 0 });
    expect(advanceFocusSession(defaults, true)).toMatchObject({ mode: 'short', sessionsDone: 1 });
  });
  it('preserves four completed sessions through the long break', () => {
    const long = advanceFocusSession({ ...defaults, sessionsDone: 3 }, true);
    expect(long).toMatchObject({ mode: 'long', sessionsDone: 4 });
    expect(advanceFocusSession(long, true)).toMatchObject({ mode: 'focus', sessionsDone: 0 });
  });
  it('validates persisted values and stale IDs', () => {
    localStorage.setItem(
      'volt-pomodoro-session',
      JSON.stringify({
        mode: 'bogus',
        customMs: 999999999,
        sessionsDone: -1,
        activeTimerId: 'missing',
      })
    );
    expect(readFocusSession()).toEqual(defaults);
  });
  it('advances after completion while the view is unmounted', () => {
    const id = timerStore.startTimer(1000, 'Focus');
    focusSession.update({ ...defaults, activeTimerId: id });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(focusSession.getSnapshot()).toMatchObject({
      mode: 'short',
      sessionsDone: 1,
      activeTimerId: null,
    });
  });
  it('recovers a completed receipt on a new session load', () => {
    const id = timerStore.startTimer(1000, 'Focus');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    localStorage.setItem(
      'volt-pomodoro-session',
      JSON.stringify({ ...defaults, activeTimerId: id })
    );
    expect(readFocusSession()).toMatchObject({
      mode: 'short',
      sessionsDone: 1,
      activeTimerId: null,
    });
  });
});
describe('Focus Timer interactions', () => {
  it('starts the typed custom duration without requiring Apply first', () => {
    render(<TimerView onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Custom duration'), { target: { value: '5s' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(timerStore.getActiveTimers()[0].duration).toBe(5000);
  });
  it('blocks invalid custom input and keeps Escape inside the editor', () => {
    const close = vi.fn();
    render(<TimerView onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const input = screen.getByLabelText('Custom duration');
    fireEvent.change(input, { target: { value: '-5m' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByRole('alert')).toHaveTextContent('1 second');
    expect(timerStore.getActiveTimers()).toHaveLength(0);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
  });
  it('responds to pause and resume from the global timer widget', () => {
    render(<TimerView onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const id = timerStore.getActiveTimers()[0].id;
    act(() => timerStore.pauseTimer(id));
    expect(screen.getByRole('button', { name: 'Resume' })).toBeVisible();
    act(() => timerStore.resumeTimer(id));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeVisible();
  });
  it('does not hijack Space on a focused button', () => {
    render(<TimerView onClose={vi.fn()} />);
    const mode = screen.getByRole('button', { name: 'Short break' });
    fireEvent.keyDown(mode, { key: ' ', code: 'Space' });
    expect(timerStore.getActiveTimers()).toHaveLength(0);
  });
  it('requires a deliberate confirmation before replacing an active timer', () => {
    render(<TimerView onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const original = timerStore.getActiveTimers()[0].id;
    fireEvent.click(screen.getByRole('button', { name: 'Short break' }));
    expect(timerStore.getTimer(original)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'End & switch' }));
    expect(timerStore.getTimer(original)).toBeUndefined();
    expect(focusSession.getSnapshot().mode).toBe('short');
  });
  it('adds and completes a task using labeled controls', () => {
    render(<TimerView onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('New task'), { target: { value: 'Finish the timer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Finish the timer' }));
    expect(tasksStore.getTasks()[0].done).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear completed' }));
    expect(tasksStore.getTasks()).toHaveLength(0);
  });
});

describe('mini timer integration', () => {
  it('opens the selected timer without canceling other timers', () => {
    const first = timerStore.startTimer(60_000, 'First task');
    const second = timerStore.startTimer(120_000, 'Second task');
    const open = vi.fn();
    render(<TimerDisplay onOpenView={open} />);
    fireEvent.click(screen.getAllByTitle('Open this timer')[1]);
    expect(open).toHaveBeenCalledOnce();
    expect(focusSession.getSnapshot()).toMatchObject({
      activeTimerId: second,
      mode: 'custom',
      customMs: 120_000,
    });
    expect(timerStore.getTimer(first)).toBeDefined();
  });
  it('exposes named pause, resume and cancel controls per timer', () => {
    const id = timerStore.startTimer(60_000, 'Current task');
    render(<TimerDisplay onOpenView={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause — Current task' }));
    expect(timerStore.getTimer(id)?.isPaused).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Resume — Current task' }));
    expect(timerStore.getTimer(id)?.isPaused).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel timer — Current task' }));
    expect(timerStore.getTimer(id)).toBeUndefined();
  });
});
