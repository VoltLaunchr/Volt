import type { PluginSettings } from '../types/settings.types';

export interface NumberRange {
  min: number;
  max: number;
}

/** Selectable System Monitor refresh periods, in milliseconds. */
export const MONITOR_REFRESH_OPTIONS_MS: readonly number[] = [1000, 2000, 5000, 10_000];
export const MONITOR_REFRESH_RANGE: NumberRange = { min: 1000, max: 60_000 };
export const MONITOR_REFRESH_DEFAULT_MS = 5000;

export const TIMER_WORK_RANGE: NumberRange = { min: 1, max: 180 };
export const TIMER_SHORT_BREAK_RANGE: NumberRange = { min: 1, max: 60 };
export const TIMER_LONG_BREAK_RANGE: NumberRange = { min: 1, max: 120 };

export const WINDOW_GAP_RANGE: NumberRange = { min: 0, max: 64 };

export interface TimerDurations {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
}

export const DEFAULT_TIMER_DURATIONS: TimerDurations = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
};

/** Rounds to an integer and clamps into `range`; anything not finite falls back to `fallback`. */
export function clampInt(value: unknown, range: NumberRange, fallback: number): number {
  const number = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(number)));
}

type PluginOptionFields = Partial<
  Pick<
    PluginSettings,
    | 'systemMonitorRefreshMs'
    | 'timerWorkMinutes'
    | 'timerShortBreakMinutes'
    | 'timerLongBreakMinutes'
    | 'windowManagementGapPx'
  >
>;

export function resolveMonitorRefreshMs(plugins: PluginOptionFields | null | undefined): number {
  return clampInt(
    plugins?.systemMonitorRefreshMs,
    MONITOR_REFRESH_RANGE,
    MONITOR_REFRESH_DEFAULT_MS
  );
}

export function resolveTimerDurations(
  plugins: PluginOptionFields | null | undefined
): TimerDurations {
  return {
    workMinutes: clampInt(
      plugins?.timerWorkMinutes,
      TIMER_WORK_RANGE,
      DEFAULT_TIMER_DURATIONS.workMinutes
    ),
    shortBreakMinutes: clampInt(
      plugins?.timerShortBreakMinutes,
      TIMER_SHORT_BREAK_RANGE,
      DEFAULT_TIMER_DURATIONS.shortBreakMinutes
    ),
    longBreakMinutes: clampInt(
      plugins?.timerLongBreakMinutes,
      TIMER_LONG_BREAK_RANGE,
      DEFAULT_TIMER_DURATIONS.longBreakMinutes
    ),
  };
}

export function resolveWindowGapPx(plugins: PluginOptionFields | null | undefined): number {
  return clampInt(plugins?.windowManagementGapPx, WINDOW_GAP_RANGE, 0);
}
